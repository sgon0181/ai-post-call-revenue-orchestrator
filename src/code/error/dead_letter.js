// Runs whenever the main workflow fails after its node-level retries (3 tries, backoff).
// Classifies the failure, stores it in a dead-letter list and alerts engineering.
const SLACK_WEBHOOK_URL = ''; // engineering alerts channel; empty → dry run

const e = $input.first().json;
const message = e.execution?.error?.message ?? e.trigger?.error?.message ?? 'unknown error';
const description = e.execution?.error?.description ?? '';
const text = `${message} ${description}`;

const retryable = /\b429\b|rate limit|\b5\d\d\b|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED|socket hang up/i.test(text);
const category = /\b401\b|\b403\b|unauthori[sz]ed|forbidden|credential/i.test(text) ? 'auth'
  : /\b429\b|rate limit/i.test(text) ? 'rate_limited'
  : /\b5\d\d\b|timeout|ETIMEDOUT|ECONNRESET|ECONNREFUSED/i.test(text) ? 'upstream_unavailable'
  : /\b4\d\d\b/.test(text) ? 'bad_request'
  : 'workflow_bug';

const record = {
  failed_at: new Date().toISOString(),
  workflow: e.workflow?.name ?? null,
  execution_id: e.execution?.id ?? null,
  execution_url: e.execution?.url ?? null,
  mode: e.execution?.mode ?? null,
  failed_node: e.execution?.lastNodeExecuted ?? null,
  error: message.slice(0, 500),
  category,
  retryable,
  // The idempotency key is never marked "completed" for a failed run. n8n "Retry"
  // resumes at the failed node; a redelivered webhook re-claims after the lock expires.
  replay_hint: retryable ? 'Retry the execution in n8n once the upstream recovers (resumes at the failed node).' : 'Fix the root cause, then retry the execution in n8n.',
};

const store = $getWorkflowStaticData('global');
store.dead_letters = [record, ...(store.dead_letters ?? [])].slice(0, 200);

const slack_payload = {
  text: `🧯 Aircall automation failure : ${record.failed_node}`,
  blocks: [
    { type: 'header', text: { type: 'plain_text', text: '🧯 Aircall → HubSpot automation failed', emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*Node:* ${record.failed_node}\n*Category:* ${category}${retryable ? ' (retryable)' : ''}\n*Error:* \`${record.error}\`\n*Next step:* ${record.replay_hint}` } },
    ...(record.execution_url ? [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open execution' }, url: record.execution_url }] }] : []),
  ],
};

return [{ json: { dead_letter: record, slack_webhook_url: SLACK_WEBHOOK_URL, slack_payload, dead_letter_count: store.dead_letters.length } }];
