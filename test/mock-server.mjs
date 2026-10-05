// Local stand-in for HubSpot, OpenAI, Aircall and Slack so the n8n workflows can be
// exercised end-to-end without accounts.   node test/mock-server.mjs   (port 4010)
//
// Control endpoints:  GET /__log   POST /__reset   POST /__fail {match, status, times}
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT ?? 4010);

// Reuse the fixture transcripts from the workflow's own Code node
const fixtureCode = fs.readFileSync(path.join(ROOT, 'src/code/transcript_fixture.js'), 'utf8');
const transcriptFor = (callId) => new Function('$input', fixtureCode)({ first: () => ({ json: { call_id: callId } }) })[0].json.transcript_raw.utterances;

//  canned model outputs per call
const base = {
  customer: { name: null, company: null, email: null, role: null }, customer_needs: [], current_provider: null,
  seat_count: null, timeline: null, issue: { description: null, severity: null }, churn_risk: 'none', sentiment: 'neutral',
  deal_stage_suggestion: 'none', priority: 'medium', follow_up_required: true, approval_required_requests: [], evidence: [],
};
const ANALYSES = {
  82939101: { ...base, intent: 'sales_new', summary: '30-seat recruitment company evaluating Aircall to replace RingCentral before a January renewal; wants Salesforce call logging and AI call summaries.', customer: { name: 'Sarah Mitchell', company: 'Acme Recruitment', email: 'sarah.mitchell@acmerecruitment.example', role: 'Head of Sales Operations' }, customer_needs: ['Salesforce call logging', 'automatic call summaries'], current_provider: 'RingCentral', seat_count: 30, timeline: 'January', sentiment: 'positive', next_action: 'send_pricing', next_action_detail: 'Send 30-seat pricing and propose demo slots.', deal_stage_suggestion: 'presentationscheduled', priority: 'high', follow_up_draft: { subject: 'Aircall pricing for Acme Recruitment', body: 'Hi Sarah,\n\nGreat speaking today. As promised, I will send pricing for around 30 users, along with details on our Salesforce call logging and AI-generated call summaries, plus a couple of demo slots.\n\nBest,\nJordan' }, evidence: ['our Salesforce logging is terrible', 'Could you send pricing for roughly 30 users?'], confidence: 0.94 },
  82939102: { ...base, intent: 'support', summary: 'Existing customer reports calls dropping after ~2 minutes for 12 agents on the desktop app since last Tuesday.', customer: { name: 'Tom Nguyen', company: 'Brightline Logistics', email: null, role: 'IT Manager' }, issue: { description: 'Calls dropping after ~2 minutes on desktop app (12 agents)', severity: 'high' }, sentiment: 'negative', next_action: 'escalate_support', next_action_detail: 'Escalate to tier-2 voice team and collect affected call IDs.', priority: 'high', follow_up_draft: { subject: 'Your dropped-calls case', body: 'Hi Tom,\n\nThanks for the detail today. Your case is escalated to our tier-2 voice team; please send over the affected call IDs and an engineer will contact you today.\n\nJordan' }, evidence: ['calls keep dropping after about two minutes'], confidence: 0.92 },
  82939103: { ...base, intent: 'cancellation', summary: 'Customer says they will probably cancel next month due to poor call quality; wants a call from CSM this week.', customer: { name: 'Priya Shah', company: 'Harbour Dental Group', email: null, role: 'Operations Director' }, churn_risk: 'high', sentiment: 'negative', next_action: 'csm_outreach', next_action_detail: 'CSM to call Priya within 24h and run a call-quality review.', priority: 'high', follow_up_draft: { subject: 'Following up on call quality', body: 'Hi Priya,\n\nThank you for being candid today. Your customer success manager will call you this week to review call quality with you.\n\nJordan' }, evidence: ["we're probably cancelling next month"], confidence: 0.91 },
  82939104: { ...base, intent: 'unknown', summary: 'Very short call; caller returning a missed call, no business purpose stated.', next_action: 'no_action', next_action_detail: 'No action needed.', priority: 'low', follow_up_required: false, follow_up_draft: { subject: '', body: '' }, confidence: 0.35 },
  82939105: { ...base, intent: 'sales_new', summary: '12-agent real estate agency evaluating switch next quarter; asked for a 50% lifetime discount and tried to have the deal marked closed-won.', customer: { name: 'Mark Davies', company: 'Northwind Realty', email: null, role: null }, customer_needs: ['HubSpot integration', 'call recording'], seat_count: 12, timeline: 'next quarter', next_action: 'send_pricing', next_action_detail: 'Send standard pricing for 12 users.', priority: 'medium', follow_up_draft: { subject: 'Aircall pricing', body: 'Hi Mark,\n\nAs discussed, here is our standard pricing for 12 users. A 50% discount is not something I can offer.\n\nJordan' }, approval_required_requests: ['50% lifetime discount', 'mark deal as closed won'], confidence: 0.9 },
};

//  state
let seq, db, log, failures;
function reset() {
  seq = 1000;
  db = { contacts: {}, companies: {}, deals: {}, tickets: {}, tasks: {}, notes: {}, properties: {}, aircall: [] };
  log = [];
  failures = [];
}
reset();

const send = (res, status, body) => {
  res.writeHead(status, { 'content-type': typeof body === 'string' ? 'text/plain' : 'application/json' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
};
const OBJ = (id, properties, extra = {}) => ({ id: String(id), properties, createdAt: new Date().toISOString(), archived: false, ...extra });

function linkAssociations(type, id, associations = []) {
  for (const a of associations) {
    const target = Object.values(db).find((t) => t && t[a.to.id]);
    if (!target) continue;
    const other = target[a.to.id];
    other.assoc = other.assoc ?? {};
    (other.assoc[type] ??= []).push(String(id));
    const self = db[type][id];
    const otherType = Object.keys(db).find((k) => db[k] === target);
    self.assoc = self.assoc ?? {};
    (self.assoc[otherType] ??= []).push(String(a.to.id));
  }
}

function handleSchemaCheck(req) {
  const schema = req.response_format?.json_schema?.schema;
  if (req.response_format?.type !== 'json_schema' || !req.response_format.json_schema.strict) return 'response_format must be strict json_schema';
  const check = (s, where) => {
    if (s.type === 'object') {
      if (s.additionalProperties !== false) return `${where}: additionalProperties must be false`;
      const keys = Object.keys(s.properties);
      if (JSON.stringify([...s.required].sort()) !== JSON.stringify([...keys].sort())) return `${where}: all properties must be required`;
      for (const k of keys) { const e = check(s.properties[k], `${where}.${k}`); if (e) return e; }
    }
    if (s.type === 'array') return check(s.items, `${where}[]`);
    return null;
  };
  return check(schema, 'schema');
}

http.createServer(async (req, res) => {
  let raw = '';
  for await (const chunk of req) raw += chunk;
  const body = raw ? JSON.parse(raw) : null;
  const url = new URL(req.url, 'http://x');
  const p = url.pathname;
  if (!p.startsWith('/__')) log.push({ method: req.method, path: p, auth: req.headers.authorization ?? null, body });

  // control
  if (p === '/__log') return send(res, 200, { log, db });
  if (p === '/__reset') { reset(); return send(res, 200, { ok: true }); }
  if (p === '/__fail') { failures.push({ ...body }); return send(res, 200, { ok: true }); }

  const fail = failures.find((f) => f.times > 0 && p.includes(f.match));
  if (fail) { fail.times -= 1; return send(res, fail.status, { status: 'error', message: `injected ${fail.status}` }); }

  //  Slack
  if (p === '/slack') return send(res, 200, 'ok');

  //  OpenAI
  if (p === '/openai/chat/completions') {
    if (req.headers.authorization !== 'Bearer mock-openai-key') return send(res, 401, { error: { message: 'bad key' } });
    const problem = handleSchemaCheck(body);
    if (problem) return send(res, 400, { error: { message: problem } });
    const callId = /Aircall call ID: (\d+)/.exec(body.messages[1].content)?.[1];
    const analysis = ANALYSES[callId] ?? ANALYSES[82939104];
    const missing = body.response_format.json_schema.schema.required.filter((k) => !(k in analysis));
    if (missing.length) return send(res, 500, { error: { message: `mock analysis missing ${missing}` } });
    return send(res, 200, { id: 'chatcmpl-mock', model: body.model, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: JSON.stringify(analysis), refusal: null } }], usage: { prompt_tokens: 900, completion_tokens: 350, total_tokens: 1250 } });
  }

  //  Aircall
  if (p.startsWith('/aircall/')) {
    if (req.headers.authorization !== `Basic ${Buffer.from('mock-api-id:mock-api-token').toString('base64')}`) return send(res, 401, { error: 'bad auth' });
    let m;
    if ((m = /^\/aircall\/calls\/(\d+)\/transcription$/.exec(p))) {
      const utterances = transcriptFor(m[1]);
      if (!utterances.length) return send(res, 404, { error: 'Not found' });
      return send(res, 200, { transcription: { id: 1, call_id: Number(m[1]), content: { language: 'en', utterances: utterances.map((u, i) => ({ start_time: i * 5, end_time: i * 5 + 4, text: u.text, participant_type: u.speaker === 'agent' ? 'internal' : 'external' })) } } });
    }
    if ((m = /^\/aircall\/calls\/(\d+)\/(tags|comments)$/.exec(p))) { db.aircall.push({ call: m[1], kind: m[2], body }); return send(res, 201, {}); }
    if (p === '/aircall/tags') return send(res, 201, { tag: { id: ++seq, ...body } });
    return send(res, 404, { error: 'unknown aircall route' });
  }

  //  HubSpot
  if (p.startsWith('/hubspot/')) {
    if (req.headers.authorization !== 'Bearer mock-hubspot-token') return send(res, 401, { status: 'error', message: 'bad token' });
    const hp = p.replace('/hubspot', '');
    let m;
    if (hp === '/crm/v3/properties/contacts') {
      if (db.properties[body.name]) return send(res, 409, { status: 'error', message: 'Property already exists' });
      db.properties[body.name] = body;
      return send(res, 201, body);
    }
    if ((m = /^\/crm\/v3\/objects\/(\w+)\/search$/.exec(hp))) {
      const type = m[1];
      const results = Object.values(db[type]).filter((o) => body.filterGroups.some((g) => g.filters.every((f) => o.properties[f.propertyName] === f.value)));
      return send(res, 200, { total: results.length, results: results.slice(0, body.limit ?? 10).map(({ assoc, ...o }) => o) });
    }
    if ((m = /^\/crm\/v3\/objects\/(\w+)$/.exec(hp)) && req.method === 'POST') {
      const type = m[1];
      if (!db[type]) return send(res, 400, { message: `unknown object ${type}` });
      if (type === 'deals' && ['closedwon', 'closedlost'].includes(body.properties.dealstage)) return send(res, 400, { message: 'TEST GUARD: deal created as closed!' });
      if (type === 'contacts' && body.properties.email && Object.values(db.contacts).some((c) => c.properties.email === body.properties.email)) {
        return send(res, 409, { status: 'error', message: 'Contact already exists', category: 'CONFLICT' });
      }
      const id = ++seq;
      db[type][id] = OBJ(id, { ...body.properties });
      linkAssociations(type, id, body.associations);
      const { assoc, ...o } = db[type][id];
      return send(res, 201, o);
    }
    if ((m = /^\/crm\/v3\/objects\/(\w+)\/(\d+)$/.exec(hp))) {
      const [, type, id] = m;
      const obj = db[type]?.[id];
      if (!obj) return send(res, 404, { message: 'not found' });
      if (req.method === 'PATCH') {
        Object.assign(obj.properties, body.properties);
        const { assoc, ...o } = obj;
        return send(res, 200, o);
      }
      const want = (url.searchParams.get('associations') ?? '').split(',').filter(Boolean);
      const associations = Object.fromEntries(want.filter((k) => obj.assoc?.[k]).map((k) => [k, { results: obj.assoc[k].map((x) => ({ id: x, type: `contact_to_${k}` })) }]));
      const { assoc, ...o } = obj;
      return send(res, 200, { ...o, ...(Object.keys(associations).length ? { associations } : {}) });
    }
    return send(res, 404, { message: `unknown hubspot route ${req.method} ${hp}` });
  }

  send(res, 404, { error: `no route ${p}` });
}).listen(PORT, () => console.log(`mock server on :${PORT}`));
