// One audit record per processed call + mark the idempotency key completed.
// This is what answers "what did the automation do, and why?".
const cfg = $('Config').first().json.config;
const c = $('Compose Notification').first().json;
const store = $getWorkflowStaticData('global');
const pick = (name) => ($(name).isExecuted ? $(name).first().json : null);

const slackResult = pick('Slack: Send Alert');
const slack = !cfg.slack_webhook_url ? 'dry_run' : slackResult?.error ? `failed: ${slackResult.error.message ?? slackResult.error}` : 'sent';

const tag = pick('Aircall: Tag Call');
const comment = pick('Aircall: Comment Call');
const aircall = !cfg.aircall_live
  ? { mode: 'dry_run', would_send: { tags: c.aircall_writeback.tag_ids, comment: c.aircall_writeback.comment } }
  : {
    mode: 'live',
    tag: c.aircall_writeback.tag_ids.length ? tag?.statusCode ?? 'not_sent' : 'skipped_no_tag_id',
    comment: comment?.statusCode ?? 'not_sent',
  };

const nowMs = Date.now();
const record = {
  call_id: c.call_id,
  idempotency_key: c.idempotency_key,
  workflow_version: cfg.workflow_version,
  execution_id: $execution.id,
  source: c.source,
  status: c.notification.needs_approval ? 'completed_awaiting_approval' : 'completed',
  route: c.policy.route,
  intent: c.analysis.intent,
  intent_from_model: c.analysis.intent_from_model,
  ai_confidence: c.analysis.confidence,
  automation_allowed: c.policy.automation_allowed,
  review_reasons: c.policy.review_reasons,
  policy_corrections: c.policy.corrections,
  draft_flags: c.policy.draft_flags,
  hubspot_contact_id: c.crm.contact_id,
  is_new_contact: c.customer.is_new_contact,
  hubspot_note_id: c.crm.note_id ?? null,
  hubspot_company_id: c.crm.company_id ?? null,
  deal_id: c.crm.deal_id ?? null,
  ticket_id: c.crm.ticket_id ?? null,
  task_id: c.crm.task_id ?? null,
  slack,
  aircall_writeback: aircall,
  ai_model: c.ai_meta.model,
  ai_tokens: c.ai_meta.usage?.total_tokens ?? null,
  prompt_version: c.ai_meta.prompt_version,
  end_to_end_seconds: c.ended_at ? Math.round(nowMs / 1000 - c.ended_at) : null,
  processed_at: new Date(nowMs).toISOString(),
  approval: c.notification.needs_approval ? 'pending' : 'not_required',
};

store.audit = [record, ...(store.audit ?? [])].slice(0, 500);
store.processed = store.processed ?? {};
store.processed[c.idempotency_key] = { status: 'completed', at: nowMs, execution_id: $execution.id };

return [{ json: { ...c, audit: record } }];
