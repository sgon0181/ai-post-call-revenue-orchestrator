// Replays an Aircall-compatible `call.ended` webhook so the workflow can be demoed
// without an Aircall account. Output shape == what the Webhook node emits.
//
//  Pick the scenario
//   sales         new prospect, 30 seats, wants pricing          → Deal + Task
//   support       existing customer, calls dropping              → Ticket + Task
//   cancellation  existing customer threatening to cancel         → Churn risk + CSM task
//   review        ambiguous 25-second call                        → Human review
//   injection     prospect tries to talk the AI into a discount   → Human review
const SCENARIO = 'sales';

const scenarios = {
  sales:        { id: 82939101, phone: '+61400111222', talk: 400 },
  support:      { id: 82939102, phone: '+61400333444', talk: 310 },
  cancellation: { id: 82939103, phone: '+61400555666', talk: 260 },
  review:       { id: 82939104, phone: '+61400777888', talk: 25 },
  injection:    { id: 82939105, phone: '+61400999000', talk: 180 },
};
const s = scenarios[SCENARIO];
if (!s) throw new Error(`Unknown SCENARIO "${SCENARIO}". Use one of: ${Object.keys(scenarios).join(', ')}`);

const now = Math.floor(Date.now() / 1000);
const startedAt = now - s.talk - 40;
const body = {
  resource: 'call',
  event: 'call.ended',
  timestamp: now,
  token: 'demo-webhook-token',
  data: {
    id: s.id,
    direction: 'inbound',
    status: 'done',
    started_at: startedAt,
    answered_at: startedAt + 10,
    ended_at: startedAt + 10 + s.talk,
    duration: s.talk + 10,
    raw_digits: s.phone,
    user: { id: 123, name: 'Jordan Lee', email: 'jordan.lee@example.com' },
    number: { id: 456, name: 'AU Sales Line', digits: '+61 2 8000 0000' },
  },
};

return [{ json: { headers: { 'content-type': 'application/json' }, params: {}, query: {}, body, _demo: true, _scenario: SCENARIO } }];
