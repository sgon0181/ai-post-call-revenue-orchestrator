// All routes converge here. Builds: Slack alert (Block Kit), the approval links for
// the AI-drafted follow-up, and the Aircall write-back (tags + comment).
const cfg = $('Config').first().json.config;
const pick = (name) => ($(name).isExecuted ? $(name).first().json : null);

// Latest context object from whichever branch ran
const ctx = pick('Build Sales Task') ?? pick('Build Support Task') ?? pick('Build CSM Task') ?? pick('Attach Note ID');
const task = pick('HubSpot: Create Task');
const { task_request, contact_update, ...base } = ctx;
const crm = { ...base.crm, task_id: task ? String(task.id) : null };
const { analysis: a, policy, customer: c } = base;
const pct = (n) => `${Math.round(n * 100)}%`;
const crmName = [c.firstname, c.lastname].filter(Boolean).join(' ');
const name = a.customer.name || (c.is_placeholder_name ? null : crmName) || base.phone;
const company = a.customer.company ?? c.company ?? base.company?.name ?? null;

//  Route presentation
const HEADERS = {
  sales: a.priority === 'high' ? '🔥 High-intent Aircall lead' : '💼 New Aircall sales opportunity',
  support: '🛠️ Support issue from an Aircall call',
  cancellation: '🚨 Churn risk detected on an Aircall call',
  general: '📞 Aircall call processed',
  review: '👀 AI call analysis needs human review',
};
const TAGS = {
  sales: 'AI-QUALIFIED-LEAD',
  support: 'AI-SUPPORT-ISSUE',
  cancellation: 'AI-CHURN-RISK',
  general: 'AI-PROCESSED',
  review: 'AI-NEEDS-REVIEW',
};

const facts = [
  company ? `*${company}* · ${name}` : `*${name}*`,
  a.seat_count ? `${a.seat_count} potential seats` : null,
  a.current_provider ? `Current provider: ${a.current_provider}` : null,
  a.timeline ? `Timeline: ${a.timeline}` : null,
  a.customer_needs.length ? `Wants: ${a.customer_needs.join(' + ')}` : null,
  a.issue?.description ? `Issue: ${a.issue.description} (${a.issue.severity})` : null,
  policy.route === 'cancellation' ? `Churn risk: *${a.churn_risk.toUpperCase()}*` : null,
  `Next action: ${a.next_action_detail}`,
  `AI confidence: ${pct(a.confidence)}`,
].filter(Boolean);

const hubspotUrl = (type, id) => (cfg.hubspot.portal_id && id ? `https://app.hubspot.com/contacts/${cfg.hubspot.portal_id}/record/${type}/${id}` : null);
const crmLine = [
  `Contact #${crm.contact_id}${c.is_new_contact ? ' (new)' : ''}`,
  crm.deal_id ? `Deal #${crm.deal_id}` : null,
  crm.ticket_id ? `Ticket #${crm.ticket_id}` : null,
  crm.task_id ? `Task #${crm.task_id} (due ${policy.sla_hours}h)` : null,
].filter(Boolean).join(' · ');

//  Human-in-the-loop for the AI-drafted follow-up
const needsApproval = policy.route !== 'review' && a.follow_up_required && Boolean(a.follow_up_draft.body?.trim());
const resumeUrl = String($execution.resumeUrl ?? '');
const withDecision = (d) => `${resumeUrl}${resumeUrl.includes('?') ? '&' : '?'}decision=${d}`;
const approveUrl = needsApproval ? withDecision('approve') : null;
const rejectUrl = needsApproval ? withDecision('reject') : null;

const blocks = [
  { type: 'header', text: { type: 'plain_text', text: HEADERS[policy.route], emoji: true } },
  { type: 'section', text: { type: 'mrkdwn', text: facts.map((f, i) => (i === 0 ? f : `• ${f}`)).join('\n') } },
];
if (policy.route === 'review') {
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*Why it's held:*\n${policy.review_reasons.map((r) => `• ${r}`).join('\n')}\n\n_No deals, tickets or tasks were created. Summary note logged on the contact._` } });
}
if (needsApproval) {
  const flags = policy.draft_flags.length ? `\n:warning: _Draft ${policy.draft_flags.join(', ')} : check before sending._` : '';
  blocks.push({ type: 'section', text: { type: 'mrkdwn', text: `*📝 Follow-up draft* : _${a.follow_up_draft.subject}_\n>${a.follow_up_draft.body.slice(0, 2500).replace(/\n/g, '\n>')}${flags}` } });
}
blocks.push({ type: 'context', elements: [{ type: 'mrkdwn', text: `HubSpot: ${crmLine} · Aircall call #${base.call_id} · agent ${base.agent.name ?? ':'}` }] });
const buttons = [];
if (needsApproval) {
  buttons.push({ type: 'button', style: 'primary', text: { type: 'plain_text', text: '✅ Approve draft' }, url: approveUrl });
  buttons.push({ type: 'button', style: 'danger', text: { type: 'plain_text', text: '✖ Reject' }, url: rejectUrl });
}
const contactUrl = hubspotUrl('0-1', crm.contact_id);
if (contactUrl) buttons.push({ type: 'button', text: { type: 'plain_text', text: 'Open in HubSpot' }, url: contactUrl });
if (buttons.length) blocks.push({ type: 'actions', elements: buttons });

const slack_payload = { text: `${HEADERS[policy.route]} : ${company ?? name}`, blocks };

//  Aircall write-back
const tagName = TAGS[policy.route];
const tagId = cfg.aircall_tag_ids[tagName];
const comment = [
  `🤖 ${tagName}`,
  a.summary,
  a.seat_count ? `Seats: ${a.seat_count}` : null,
  a.current_provider ? `Current provider: ${a.current_provider}` : null,
  a.timeline ? `Timeline: ${a.timeline}` : null,
  `Next action: ${a.next_action_detail}`,
  policy.route === 'review' ? `Held for review: ${policy.review_reasons.join('; ')}` : null,
  `HubSpot: ${crmLine}`,
  `AI confidence: ${pct(a.confidence)}`,
].filter(Boolean).join('\n').slice(0, 1500);

return [{
  json: {
    ...base,
    crm,
    notification: { slack_payload, needs_approval: needsApproval, approve_url: approveUrl, reject_url: rejectUrl },
    aircall_writeback: {
      tag_name: tagName,
      tag_ids: tagId ? [tagId] : [],
      tag_skipped_reason: tagId ? null : `no Aircall tag ID configured for ${tagName}`,
      comment,
    },
  },
}];
