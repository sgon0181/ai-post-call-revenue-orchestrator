// Webhook providers retry delivery, so CRM side effects must be idempotent.
// Key: aircall:<event>:<call_id>
//
//  completed            → duplicate, stop
//  in_progress < lock   → another execution is handling it (or just failed), stop
//  in_progress ≥ lock   → previous attempt died, allow reprocessing
//
// Stored in n8n workflow static data (persists for production executions only :
// manual test runs always process, which is handy for demos). Swap for the
// Postgres table in sql/idempotency_postgres.sql for multi-worker deployments.
const cfg = $('Config').first().json.config;
const evt = $input.first().json;
const store = $getWorkflowStaticData('global');
store.processed = store.processed ?? {};

const now = Date.now();
const ttlMs = cfg.idempotency_ttl_days * 24 * 3600 * 1000;
for (const [key, rec] of Object.entries(store.processed)) {
  if (now - rec.at > ttlMs) delete store.processed[key];
}

const STALE_MS = cfg.idempotency_lock_minutes * 60 * 1000;
const prior = store.processed[evt.idempotency_key];
let duplicate = false;
let duplicateReason = null;
if (prior?.status === 'completed') {
  duplicate = true;
  duplicateReason = `already processed by execution ${prior.execution_id}`;
} else if (prior?.status === 'in_progress' && now - prior.at < STALE_MS) {
  duplicate = true;
  duplicateReason = `in flight in execution ${prior.execution_id}`;
}

if (!duplicate) {
  store.processed[evt.idempotency_key] = { status: 'in_progress', at: now, execution_id: $execution.id };
}

return [{ json: { ...evt, duplicate, duplicate_reason: duplicateReason } }];
