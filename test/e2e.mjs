// End-to-end test against a running n8n (with the test build imported + active)
// and test/mock-server.mjs.   node test/e2e.mjs
import fs from 'node:fs';

const N8N = process.env.N8N_URL ?? 'http://localhost:5678';
const MOCK = 'http://localhost:4010';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Fixtures carry fixed timestamps; shift them so the call "ended 30s ago" (realistic latency metrics)
const fixture = (n) => {
  const f = JSON.parse(fs.readFileSync(new URL(`../fixtures/webhooks/${n}.json`, import.meta.url)));
  const shift = Math.floor(Date.now() / 1000) - 30 - (f.data.ended_at ?? f.timestamp);
  for (const k of ['started_at', 'answered_at', 'ended_at']) if (f.data[k]) f.data[k] += shift;
  f.timestamp += shift;
  return f;
};
const mock = async () => (await fetch(`${MOCK}/__log`)).json();
const post = (body) => fetch(`${N8N}/webhook/aircall-events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

let failures = 0;
const check = (label, ok, detail = '') => {
  console.log(`${ok ? '  ✓' : '  ✗'} ${label}${ok ? '' : `  ${detail}`}`);
  if (!ok) failures += 1;
};
const count = (db, type) => Object.keys(db[type]).length;
async function waitFor(fn, label, timeoutMs = 20000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await fn();
    if (v) return v;
    await sleep(500);
  }
  throw new Error(`timeout waiting for ${label}`);
}
const commentsFor = async (id) => (await mock()).db.aircall.filter((x) => x.call === String(id) && x.kind === 'comments');

async function send(name, { expectProcessed = true } = {}) {
  const body = fixture(name);
  const res = await post(body);
  check(`${name}: webhook acknowledged (HTTP ${res.status})`, res.status === 200);
  if (expectProcessed) await waitFor(async () => (await commentsFor(body.data.id)).length > 0, `${name} write-back`);
  else await sleep(2500);
  return { body, state: await mock() };
}

console.log('\n▶ reset mock + seed');
await fetch(`${MOCK}/__reset`, { method: 'POST' });
// Mirror the demo records defined by "00 · Setup". The setup workflow is imported
// during test boot but is not executed by this suite.
for (const [first, last, email, phone, company] of [
  ['Tom', 'Nguyen', 'tom.nguyen@brightline-logistics.example', '+61400333444', 'Brightline Logistics'],
  ['Priya', 'Shah', 'priya.shah@harbourdental.example', '+61400555666', 'Harbour Dental Group'],
]) {
  const r = await fetch(`${MOCK}/hubspot/crm/v3/objects/contacts`, { method: 'POST', headers: { authorization: 'Bearer mock-hubspot-token', 'content-type': 'application/json' }, body: JSON.stringify({ properties: { firstname: first, lastname: last, email, phone, company, lifecyclestage: 'customer' } }) });
  const c = await r.json();
  await fetch(`${MOCK}/hubspot/crm/v3/objects/companies`, { method: 'POST', headers: { authorization: 'Bearer mock-hubspot-token', 'content-type': 'application/json' }, body: JSON.stringify({ properties: { name: company }, associations: [{ to: { id: c.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 280 }] }] }) });
}

//  SALES
console.log('\n▶ sales: new prospect');
let { body, state } = await send('call-ended-sales');
const deals = Object.values(state.db.deals);
const sarah = Object.values(state.db.contacts).find((c) => c.properties.phone === '+61400111222');
check('contact created from unknown number, then enriched with name/email', sarah?.properties.firstname === 'Sarah' && sarah?.properties.email === 'sarah.mitchell@acmerecruitment.example', JSON.stringify(sarah?.properties));
check('lifecycle → salesqualifiedlead', sarah?.properties.lifecyclestage === 'salesqualifiedlead');
check('company "Acme Recruitment" created', Object.values(state.db.companies).some((c) => c.properties.name === 'Acme Recruitment'));
check('exactly 1 deal created', deals.length === 1);
check('policy overrode AI-suggested stage (not allow-listed) → qualifiedtobuy', deals[0]?.properties.dealstage === 'qualifiedtobuy', deals[0]?.properties.dealstage);
check('deal amount = 30 × 40 × 12 estimate', deals[0]?.properties.amount === '14400');
check('task "Send 30-seat pricing proposal" linked to deal', Object.values(state.db.tasks).some((t) => t.properties.hs_task_subject.includes('30-seat pricing') && t.assoc?.deals?.length));
check('AI note logged on contact', Object.values(state.db.notes).some((n) => n.assoc?.contacts?.includes(sarah?.id)));
check('Aircall tagged AI-QUALIFIED-LEAD (101)', state.db.aircall.some((x) => x.call === '82939101' && x.kind === 'tags' && x.body.tags[0] === 101));
const salesSlack = state.log.filter((l) => l.path === '/slack').at(-1)?.body;
check('Slack alert: high-intent lead with approve-draft button', salesSlack?.blocks?.[0]?.text?.text === '🔥 High-intent Aircall lead' && JSON.stringify(salesSlack).includes('decision=approve'));
const approveUrl = salesSlack.blocks.find((b) => b.type === 'actions').elements.find((e) => e.text.text.includes('Approve')).url;

//  DUPLICATE
console.log('\n▶ duplicate delivery of the same event');
({ state } = await send('call-ended-sales', { expectProcessed: false }));
check('no second deal (idempotent)', count(state.db, 'deals') === 1);
check('no second Aircall comment', (await commentsFor(82939101)).length === 1);

//  APPROVAL
console.log('\n▶ rep approves AI follow-up from Slack');
const notesBefore = count(state.db, 'notes');
const approveRes = await fetch(approveUrl.replace('http://localhost:5678', N8N));
check(`resume URL accepted (HTTP ${approveRes.status})`, approveRes.status === 200);
state = await waitFor(async () => { const s = await mock(); return count(s.db, 'notes') > notesBefore && s; }, 'approval note');
check('approved follow-up logged as HubSpot note', Object.values(state.db.notes).some((n) => n.properties.hs_note_body.includes('approved by rep')));

//  SUPPORT
console.log('\n▶ support: existing customer');
({ state } = await send('call-ended-support'));
const tickets = Object.values(state.db.tickets);
check('ticket created, priority HIGH', tickets.length === 1 && tickets[0].properties.hs_ticket_priority === 'HIGH');
check('ticket associated with existing contact (no new contact)', Object.values(state.db.contacts).filter((c) => c.properties.phone === '+61400333444').length === 1 && tickets[0].assoc?.contacts?.length === 1);
check('support task linked to ticket', Object.values(state.db.tasks).some((t) => t.assoc?.tickets?.includes(tickets[0].id)));
check('still only 1 deal', count(state.db, 'deals') === 1);

//  CANCELLATION
console.log('\n▶ cancellation: churn risk');
({ state } = await send('call-ended-cancellation'));
const priya = Object.values(state.db.contacts).find((c) => c.properties.phone === '+61400555666');
check('contact aircall_churn_risk = high', priya?.properties.aircall_churn_risk === 'high');
check('CSM task, HIGH priority, due ≤ 4h', Object.values(state.db.tasks).some((t) => t.properties.hs_task_subject.includes('Churn risk') && t.properties.hs_task_priority === 'HIGH' && new Date(t.properties.hs_timestamp) - Date.now() <= 4 * 3600e3 + 60e3));
check('Aircall tagged AI-CHURN-RISK (103)', state.db.aircall.some((x) => x.call === '82939103' && x.kind === 'tags' && x.body.tags[0] === 103));

//  REVIEW (low confidence)
console.log('\n▶ review: ambiguous call');
const before = { deals: count(state.db, 'deals'), tickets: count(state.db, 'tickets'), tasks: count(state.db, 'tasks') };
({ state } = await send('call-ended-review'));
check('no deal / ticket / task created', count(state.db, 'deals') === before.deals && count(state.db, 'tickets') === before.tickets && count(state.db, 'tasks') === before.tasks);
check('note says held for human review', Object.values(state.db.notes).some((n) => n.properties.hs_note_body.includes('Held for human review') && n.properties.hs_note_body.includes('82939104')));
check('Aircall tagged AI-NEEDS-REVIEW (104)', state.db.aircall.some((x) => x.call === '82939104' && x.kind === 'tags' && x.body.tags[0] === 104));
check('review Slack alert has no approve button', !JSON.stringify(state.log.filter((l) => l.path === '/slack').at(-1).body).includes('decision=approve'));

//  INJECTION
console.log('\n▶ injection: caller asks the AI for a discount + closed-won');
({ state } = await send('call-ended-injection'));
check('no deal created despite 0.90 confidence + sales intent', count(state.db, 'deals') === before.deals);
const injComment = (await commentsFor(82939105))[0]?.body.content ?? '';
check('held for review because of requested commitments', injComment.includes('commitments only a human can grant'), injComment);

//  EDGE EVENTS
console.log('\n▶ edge events: invalid token, unanswered, anonymous, other event');
const snapshot = JSON.stringify((await mock()).db);
for (const n of ['edge-invalid-token', 'edge-unanswered-call', 'edge-anonymous-caller', 'edge-other-event']) await send(n, { expectProcessed: false });
check('no HubSpot / Aircall side effects from any edge event', JSON.stringify((await mock()).db) === snapshot);

//  FAILURE → ERROR WORKFLOW
console.log('\n▶ HubSpot 503 on note creation (outlasts 3 retries) → error workflow');
await fetch(`${MOCK}/__fail`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ match: '/objects/notes', status: 503, times: 3 }) });
const failing = { ...fixture('call-ended-sales'), data: { ...fixture('call-ended-sales').data, id: 82939199, raw_digits: '+61400123123' } };
await post(failing);
const alert = await waitFor(async () => (await mock()).log.find((l) => l.path === '/slack' && l.body?.text?.includes('automation failure')), 'engineering alert', 40000);
check('engineering alert sent, classified upstream_unavailable', alert.body.blocks[1].text.text.includes('upstream_unavailable'), alert.body.blocks[1].text.text);
await sleep(4000); // test build sets idempotency_lock_minutes = 3s
await post(failing);
state = await waitFor(async () => { const s = await mock(); return (await commentsFor(82939199)).length > 0 && s; }, 'replay after recovery', 40000);
check('re-delivered event is processed after the lock expires (key was not burned)', true);
check('replay reused the contact created by the failed run (no duplicate contact)', Object.values(state.db.contacts).filter((c) => c.properties.phone === '+61400123123').length === 1);

//  METRICS
console.log('\n▶ metrics endpoint');
const metrics = await (await fetch(`${N8N}/webhook/aircall-metrics`)).json();
check(`calls_processed = 6 (got ${metrics.calls_processed})`, metrics.calls_processed === 6);
check('by_route has sales/support/cancellation/review', ['sales', 'support', 'cancellation', 'review'].every((r) => metrics.by_route[r]));
check('approval recorded', metrics.follow_up_approval_rate_pct === 100, JSON.stringify(metrics.follow_up_approval_rate_pct));
console.log(JSON.stringify({ ...metrics, recent: `[${metrics.recent.length} records]` }, null, 2));

console.log(failures ? `\n✗ ${failures} check(s) failed` : '\n✓ all checks passed');
process.exit(failures ? 1 : 0);
