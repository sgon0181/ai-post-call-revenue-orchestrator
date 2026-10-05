// Builds the importable n8n workflow JSON files from src/code/*.js.
//
//   node src/build.mjs          → workflows/*.json   (what you drag into n8n)
//   node src/build.mjs --test   → test/.generated/*  (mock endpoints + test credentials)
//
// Code-node JavaScript lives in real .js files so it can be linted and reviewed;
// this script only wires nodes, positions and connections.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TEST = process.argv.includes('--test');
const CHECK = process.argv.includes('--check');
const MOCK = `http://${process.env.MOCK_HOST ?? 'host.docker.internal'}:4010`;
const OUT = TEST ? path.join(ROOT, 'test/.generated') : path.join(ROOT, 'workflows');

const read = (f) => {
  const source = fs.readFileSync(path.join(ROOT, 'src/code', f), 'utf8').trimEnd();
  try {
    // n8n Code nodes run each file as a function body. Compiling here catches
    // syntax errors before they are hidden inside a valid workflow JSON file.
    Function(source);
  } catch (error) {
    throw new SyntaxError(`Invalid Code node source: src/code/${f}\n${error.message}`);
  }
  return source;
};
const LIB_TASK = read('lib_task.js');
const uid = (seed) => {
  const h = crypto.createHash('md5').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
};

const TEST_CREDS = {
  hubspotAppToken: { id: 'testHubspotCred01', name: 'HubSpot (mock)' },
  openAiApi: { id: 'testOpenAiCred001', name: 'OpenAI (mock)' },
  httpBasicAuth: { id: 'testAircallCred01', name: 'Aircall (mock)' },
};

//  workflow builder
function workflow(name) {
  const nodes = [];
  const connections = {};
  const add = (node) => {
    nodes.push({ id: uid(`${name}/${node.name}`), ...node });
    return node.name;
  };
  const connect = (from, to, output = 0) => {
    connections[from] ??= { main: [] };
    while (connections[from].main.length <= output) connections[from].main.push([]);
    connections[from].main[output].push({ node: to, type: 'main', index: 0 });
  };
  const chain = (...names) => names.slice(1).forEach((n, i) => connect(names[i], n));
  return { name, nodes, connections, add, connect, chain };
}

const code = (name, file, position, { prependLib = false, transform = (s) => s } = {}) => ({
  name,
  type: 'n8n-nodes-base.code',
  typeVersion: 2,
  position,
  parameters: { jsCode: transform((prependLib ? `${LIB_TASK}\n\n` : '') + read(file)) },
});

const AUTH = {
  hubspot: { authentication: 'predefinedCredentialType', nodeCredentialType: 'hubspotAppToken' },
  openai: { authentication: 'predefinedCredentialType', nodeCredentialType: 'openAiApi' },
  aircall: { authentication: 'genericCredentialType', genericAuthType: 'httpBasicAuth' },
  none: {},
};
const CRED_KEY = { hubspot: 'hubspotAppToken', openai: 'openAiApi', aircall: 'httpBasicAuth' };

function http(name, position, { method = 'GET', url, auth = 'none', body, fullResponse = false, timeout, retry = true, onError, notes }) {
  const options = {};
  if (fullResponse) options.response = { response: { fullResponse: true, neverError: true } };
  if (timeout) options.timeout = timeout;
  const node = {
    name,
    type: 'n8n-nodes-base.httpRequest',
    typeVersion: 4.2,
    position,
    parameters: {
      method,
      url,
      ...AUTH[auth],
      ...(body ? { sendBody: true, specifyBody: 'json', jsonBody: body } : {}),
      options,
    },
  };
  if (retry) Object.assign(node, { retryOnFail: true, maxTries: 3, waitBetweenTries: 3000 });
  if (onError) node.onError = onError;
  if (notes) Object.assign(node, { notes, notesInFlow: true });
  if (TEST && CRED_KEY[auth]) node.credentials = { [CRED_KEY[auth]]: TEST_CREDS[CRED_KEY[auth]] };
  return node;
}

const condition = (leftValue, operator, rightValue) => ({
  id: uid(`cond/${leftValue}/${rightValue}`),
  leftValue,
  rightValue: rightValue ?? '',
  operator,
});
const IS_TRUE = { type: 'boolean', operation: 'true', singleValue: true };
const conditions = (list) => ({
  options: { caseSensitive: true, leftValue: '', typeValidation: 'loose', version: 2 },
  conditions: list,
  combinator: 'and',
});

const ifTrue = (name, position, expr, notes) => ({
  name,
  type: 'n8n-nodes-base.if',
  typeVersion: 2.2,
  position,
  parameters: { conditions: conditions([condition(expr, IS_TRUE)]), looseTypeValidation: true, options: {} },
  ...(notes ? { notes, notesInFlow: true } : {}),
});

const switchOn = (name, position, expr, outputs, fallbackName) => ({
  name,
  type: 'n8n-nodes-base.switch',
  typeVersion: 3.2,
  position,
  parameters: {
    mode: 'rules',
    rules: {
      values: outputs.map(([outputKey, ...values]) => ({
        conditions: {
          ...conditions(values.map((v) => condition(expr, { type: 'string', operation: 'equals' }, v))),
          combinator: 'or',
        },
        renameOutput: true,
        outputKey,
      })),
    },
    looseTypeValidation: true,
    options: { fallbackOutput: 'extra', renameFallbackOutput: fallbackName },
  },
});

const noop = (name, position, notes) => ({
  name,
  type: 'n8n-nodes-base.noOp',
  typeVersion: 1,
  position,
  parameters: {},
  ...(notes ? { notes, notesInFlow: true } : {}),
});

const sticky = (key, content, [x, y], [width, height], color = 7) => ({
  name: `Sticky · ${key}`,
  type: 'n8n-nodes-base.stickyNote',
  typeVersion: 1,
  position: [x, y],
  parameters: { content, width, height, color },
});

const serialize = (wf, settings = {}) => ({
  name: wf.name,
  nodes: wf.nodes,
  connections: wf.connections,
  pinData: {},
  active: false,
  settings: { executionOrder: 'v1', saveManualExecutions: true, callerPolicy: 'workflowsFromSameOwner', ...settings },
  meta: { templateCredsSetupCompleted: false },
  ...(TEST ? { id: testId(wf.name) } : {}),
});
const testId = (name) => uid(name).replace(/-/g, '').slice(0, 16);
const ERROR_WF_NAME = '02 · Aircall Automation : Error Handler';

//  expressions
const CFG = "$('Config').first().json.config";
const HUBSPOT = `{{ ${CFG}.endpoints.hubspot }}`;
const AIRCALL = `{{ ${CFG}.endpoints.aircall }}`;
const OPENAI = `{{ ${CFG}.endpoints.openai }}`;
const NOTE_CTX = "$('Attach Note ID').first().json";

const TEST_OVERRIDES = `// test build: point every integration at the local mock server
config.endpoints = { hubspot: '${MOCK}/hubspot', openai: '${MOCK}/openai', aircall: '${MOCK}/aircall' };
config.aircall_live = true;
config.slack_webhook_url = '${MOCK}/slack';
config.hubspot.portal_id = '1234567';
config.hubspot.allowed_deal_stages = ['appointmentscheduled', 'qualifiedtobuy']; // mock model suggests presentationscheduled → policy must override
config.idempotency_lock_minutes = 0.05; // 3s, so the e2e suite can test re-claim after a failure
config.aircall_tag_ids = { 'AI-QUALIFIED-LEAD': 101, 'AI-SUPPORT-ISSUE': 102, 'AI-CHURN-RISK': 103, 'AI-NEEDS-REVIEW': 104, 'AI-PROCESSED': null };`;

// ═════════════════════════════════════════════════════════════════════════════
// 01 · Aircall → HubSpot AI Call Intelligence
// ═════════════════════════════════════════════════════════════════════════════
function mainWorkflow() {
  const wf = workflow('01 · Aircall → HubSpot AI Call Intelligence');
  const { add, connect, chain } = wf;
  const X = (i) => i * 220;

  //  1. Intake
  add({
    name: 'Aircall Webhook',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [X(0), -100],
    webhookId: uid('aircall-events'),
    parameters: { httpMethod: 'POST', path: 'aircall-events', responseMode: 'onReceived', options: {} },
    notes: 'Aircall → Integrations → Webhooks: point call.ended (or transcription.created) here. Responds 200 immediately.',
    notesInFlow: true,
  });
  add({ name: 'Demo: Run Scenario', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [X(0), 140], parameters: {} });
  add(code('Demo Fixture: Aircall Event', 'demo_fixture.js', [X(1), 140]));
  add(code('Config', 'config.js', [X(2), 0], { transform: (s) => s.replace('// @@TEST_OVERRIDES@@', TEST ? TEST_OVERRIDES : '') }));
  add(code('Verify Webhook Token', 'verify_token.js', [X(3), 0]));
  add(ifTrue('Token Valid?', [X(4), 0], '={{ $json.valid }}'));
  add(noop('Reject: Unknown Token', [X(5), 220], 'Unknown / missing Aircall token → stop, no side effects'));
  add(code('Normalize Payload', 'normalize.js', [X(5), 0]));
  add(switchOn('Switch Event Type', [X(6), 0], '={{ $json.dispatch }}', [['Process', 'process'], ['Skip (unanswered / anonymous)', 'skip']], 'Ignore (other events)'));
  add(noop('Stop: Nothing To Process', [X(7), 240]));
  add(code('Idempotency Check', 'idempotency.js', [X(7), 0]));
  add(ifTrue('Already Processed?', [X(8), 0], '={{ $json.duplicate }}'));
  add(noop('Duplicate → Stop', [X(9), 220], 'Retry / redelivery of an event we already handled'));

  chain('Aircall Webhook', 'Config');
  chain('Demo: Run Scenario', 'Demo Fixture: Aircall Event', 'Config', 'Verify Webhook Token', 'Token Valid?');
  connect('Token Valid?', 'Normalize Payload', 0);
  connect('Token Valid?', 'Reject: Unknown Token', 1);
  chain('Normalize Payload', 'Switch Event Type');
  connect('Switch Event Type', 'Idempotency Check', 0);
  connect('Switch Event Type', 'Stop: Nothing To Process', 1);
  connect('Switch Event Type', 'Stop: Nothing To Process', 2);
  chain('Idempotency Check', 'Already Processed?');
  connect('Already Processed?', 'Duplicate → Stop', 0);

  //  2. HubSpot lookup
  add(http('HubSpot: Search Contact', [X(9), 0], {
    method: 'POST',
    url: `=${HUBSPOT}/crm/v3/objects/contacts/search`,
    auth: 'hubspot',
    body: `={{ JSON.stringify({
  filterGroups: [
    { filters: [{ propertyName: 'phone', operator: 'EQ', value: $json.phone }] },
    { filters: [{ propertyName: 'mobilephone', operator: 'EQ', value: $json.phone }] }
  ],
  properties: ['firstname', 'lastname', 'email', 'phone', 'company', 'lifecyclestage', 'hubspot_owner_id'],
  limit: 1
}) }}`,
  }));
  add(ifTrue('Contact Exists?', [X(10), 0], '={{ $json.total > 0 }}'));
  add(http('HubSpot: Get Contact', [X(11), -110], {
    url: `=${HUBSPOT}/crm/v3/objects/contacts/{{ $json.results[0].id }}?properties=firstname,lastname,email,phone,company,jobtitle,lifecyclestage,hubspot_owner_id,notes_last_contacted,aircall_churn_risk&associations=companies,deals,tickets`,
    auth: 'hubspot',
  }));
  add(http('HubSpot: Create Contact', [X(11), 110], {
    method: 'POST',
    url: `=${HUBSPOT}/crm/v3/objects/contacts`,
    auth: 'hubspot',
    body: `={{ JSON.stringify({
  properties: {
    firstname: 'Unknown',
    lastname: 'Caller',
    phone: $('Idempotency Check').first().json.phone,
    lifecyclestage: 'lead',
    hs_lead_status: 'NEW'
  }
}) }}`,
  }));
  add(code('Build Customer Context', 'customer_context.js', [X(12), 0]));
  connect('Already Processed?', 'HubSpot: Search Contact', 1);
  chain('HubSpot: Search Contact', 'Contact Exists?');
  connect('Contact Exists?', 'HubSpot: Get Contact', 0);
  connect('Contact Exists?', 'HubSpot: Create Contact', 1);
  connect('HubSpot: Get Contact', 'Build Customer Context');
  connect('HubSpot: Create Contact', 'Build Customer Context');

  //  3. Transcript
  add(ifTrue('Aircall Live?', [X(13), 0], `={{ ${CFG}.aircall_live }}`));
  add(http('Aircall: Get Transcript', [X(14), -110], {
    url: `=${AIRCALL}/calls/{{ $json.call_id }}/transcription`,
    auth: 'aircall',
    fullResponse: true,
  }));
  add(code('Transcript Fixture', 'transcript_fixture.js', [X(14), 110]));
  add(code('Prepare Transcript', 'prepare_transcript.js', [X(15), 0]));
  chain('Build Customer Context', 'Aircall Live?');
  connect('Aircall Live?', 'Aircall: Get Transcript', 0);
  connect('Aircall Live?', 'Transcript Fixture', 1);
  connect('Aircall: Get Transcript', 'Prepare Transcript');
  connect('Transcript Fixture', 'Prepare Transcript');

  //  4. AI analysis + guardrails
  add(code('Build AI Request', 'build_ai_request.js', [X(16), 0]));
  add(http('OpenAI: Analyze Call', [X(17), 0], {
    method: 'POST',
    url: `=${OPENAI}/chat/completions`,
    auth: 'openai',
    body: '={{ JSON.stringify($json.ai_request) }}',
    timeout: 90000,
    notes: 'Strict JSON-schema structured output',
  }));
  add(code('Validate AI Output', 'validate_ai.js', [X(18), 0]));
  add(code('Guardrail Policy', 'guardrail_policy.js', [X(19), 0]));
  add(code('Build CRM Payloads', 'build_crm_payloads.js', [X(20), 0]));
  add(http('HubSpot: Log AI Call Note', [X(21), 0], {
    method: 'POST',
    url: `=${HUBSPOT}/crm/v3/objects/notes`,
    auth: 'hubspot',
    body: '={{ JSON.stringify($json.requests.note) }}',
  }));
  add(code('Attach Note ID', 'attach_note.js', [X(22), 0]));
  add(ifTrue('Confidence Gate', [X(23), 0], '={{ $json.policy.automation_allowed }}', 'confidence ≥ threshold AND valid AND no commitments requested'));
  chain('Prepare Transcript', 'Build AI Request', 'OpenAI: Analyze Call', 'Validate AI Output', 'Guardrail Policy',
    'Build CRM Payloads', 'HubSpot: Log AI Call Note', 'Attach Note ID', 'Confidence Gate');

  //  5. Routes
  const BX = 24;
  add(http('HubSpot: Update Contact', [X(BX), -300], {
    method: 'PATCH',
    url: `=${HUBSPOT}/crm/v3/objects/contacts/{{ $json.customer.contact_id }}`,
    auth: 'hubspot',
    body: '={{ JSON.stringify($json.contact_update) }}',
  }));
  add(switchOn('Switch Intent', [X(BX + 1), -300], `={{ ${NOTE_CTX}.policy.route }}`, [['Sales', 'sales'], ['Support', 'support'], ['Cancellation', 'cancellation']], 'General'));
  connect('Confidence Gate', 'HubSpot: Update Contact', 0);
  chain('HubSpot: Update Contact', 'Switch Intent');

  // Sales
  const SY = -900;
  add(http('HubSpot: Search Company', [X(BX + 2), SY], {
    method: 'POST',
    url: `=${HUBSPOT}/crm/v3/objects/companies/search`,
    auth: 'hubspot',
    body: `={{ JSON.stringify({
  filterGroups: [{ filters: [{ propertyName: 'name', operator: 'EQ', value: ${NOTE_CTX}.lookup.company_name || '__no_company__' }] }],
  properties: ['name', 'domain', 'hubspot_owner_id'],
  limit: 1
}) }}`,
  }));
  add(code('Resolve Company', 'resolve_company.js', [X(BX + 3), SY]));
  add(ifTrue('Create Company?', [X(BX + 4), SY], '={{ $json.company.needs_create }}'));
  add(http('HubSpot: Create Company', [X(BX + 5), SY - 110], {
    method: 'POST',
    url: `=${HUBSPOT}/crm/v3/objects/companies`,
    auth: 'hubspot',
    body: `={{ JSON.stringify({
  properties: { name: $json.company.name },
  associations: [{ to: { id: $json.customer.contact_id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 280 }] }]
}) }}`,
  }));
  add(code('Attach Company ID', 'attach_company.js', [X(BX + 6), SY - 110]));
  add(code('Build Deal', 'build_deal.js', [X(BX + 7), SY]));
  add(http('HubSpot: Create Deal', [X(BX + 8), SY], {
    method: 'POST',
    url: `=${HUBSPOT}/crm/v3/objects/deals`,
    auth: 'hubspot',
    body: '={{ JSON.stringify($json.deal_request) }}',
    notes: 'Early stages only : AI can never close a deal',
  }));
  add(code('Build Sales Task', 'build_sales_task.js', [X(BX + 9), SY], { prependLib: true }));
  connect('Switch Intent', 'HubSpot: Search Company', 0);
  chain('HubSpot: Search Company', 'Resolve Company', 'Create Company?');
  connect('Create Company?', 'HubSpot: Create Company', 0);
  connect('Create Company?', 'Build Deal', 1);
  chain('HubSpot: Create Company', 'Attach Company ID', 'Build Deal', 'HubSpot: Create Deal', 'Build Sales Task');

  // Support
  const TY = -620;
  add(code('Build Ticket', 'build_ticket.js', [X(BX + 2), TY]));
  add(http('HubSpot: Create Ticket', [X(BX + 3), TY], {
    method: 'POST',
    url: `=${HUBSPOT}/crm/v3/objects/tickets`,
    auth: 'hubspot',
    body: '={{ JSON.stringify($json.ticket_request) }}',
  }));
  add(code('Build Support Task', 'build_support_task.js', [X(BX + 4), TY], { prependLib: true }));
  connect('Switch Intent', 'Build Ticket', 1);
  chain('Build Ticket', 'HubSpot: Create Ticket', 'Build Support Task');

  // Cancellation
  const CY = -420;
  add(code('Build CSM Task', 'build_csm_task.js', [X(BX + 2), CY], { prependLib: true }));
  connect('Switch Intent', 'Build CSM Task', 2);

  // Shared task creation
  add(http('HubSpot: Create Task', [X(BX + 10), -620], {
    method: 'POST',
    url: `=${HUBSPOT}/crm/v3/objects/tasks`,
    auth: 'hubspot',
    body: '={{ JSON.stringify($json.task_request) }}',
    notes: 'One reusable task node for every route',
  }));
  connect('Build Sales Task', 'HubSpot: Create Task');
  connect('Build Support Task', 'HubSpot: Create Task');
  connect('Build CSM Task', 'HubSpot: Create Task');

  //  6. Notify + write back
  const NX = BX + 11;
  add(code('Compose Notification', 'compose_notification.js', [X(NX), 0]));
  connect('HubSpot: Create Task', 'Compose Notification');
  connect('Switch Intent', 'Compose Notification', 3); // General
  connect('Confidence Gate', 'Compose Notification', 1); // Review
  add(ifTrue('Slack Configured?', [X(NX + 1), 0], `={{ !!${CFG}.slack_webhook_url }}`));
  add(http('Slack: Send Alert', [X(NX + 2), -110], {
    method: 'POST',
    url: `={{ ${CFG}.slack_webhook_url }}`,
    body: '={{ JSON.stringify($json.notification.slack_payload) }}',
    onError: 'continueRegularOutput',
  }));
  add(noop('Slack: Dry Run', [X(NX + 2), 110], 'Payload is in "Compose Notification" output'));
  add(ifTrue('Aircall Write-back Live?', [X(NX + 3), 0], `={{ ${CFG}.aircall_live }}`));
  add(http('Aircall: Tag Call', [X(NX + 4), -110], {
    method: 'POST',
    url: `=${AIRCALL}/calls/{{ $('Compose Notification').first().json.call_id }}/tags`,
    auth: 'aircall',
    body: "={{ JSON.stringify({ tags: $('Compose Notification').first().json.aircall_writeback.tag_ids }) }}",
    fullResponse: true,
  }));
  add(http('Aircall: Comment Call', [X(NX + 5), -110], {
    method: 'POST',
    url: `=${AIRCALL}/calls/{{ $('Compose Notification').first().json.call_id }}/comments`,
    auth: 'aircall',
    body: "={{ JSON.stringify({ content: $('Compose Notification').first().json.aircall_writeback.comment }) }}",
    fullResponse: true,
  }));
  add(noop('Aircall: Dry Run', [X(NX + 4), 110], 'Tags + comment are in "Compose Notification" output'));
  add(code('Write Audit Log', 'write_audit.js', [X(NX + 6), 0]));
  chain('Compose Notification', 'Slack Configured?');
  connect('Slack Configured?', 'Slack: Send Alert', 0);
  connect('Slack Configured?', 'Slack: Dry Run', 1);
  connect('Slack: Send Alert', 'Aircall Write-back Live?');
  connect('Slack: Dry Run', 'Aircall Write-back Live?');
  connect('Aircall Write-back Live?', 'Aircall: Tag Call', 0);
  connect('Aircall Write-back Live?', 'Aircall: Dry Run', 1);
  chain('Aircall: Tag Call', 'Aircall: Comment Call', 'Write Audit Log');
  connect('Aircall: Dry Run', 'Write Audit Log');

  //  7. Human approval of the AI follow-up
  const AX = NX + 7;
  add(ifTrue('Needs Approval?', [X(AX), 0], '={{ $json.notification.needs_approval }}'));
  add({
    name: 'Wait for Rep Approval',
    type: 'n8n-nodes-base.wait',
    typeVersion: 1.1,
    position: [X(AX + 1), -110],
    webhookId: uid('approval-wait'),
    parameters: { resume: 'webhook', limitWaitTime: true, limitType: 'afterTimeInterval', resumeAmount: 24, resumeUnit: 'hours', options: {} },
    notes: 'Resumed by the Approve / Reject buttons in Slack',
    notesInFlow: true,
  });
  add(noop('Done', [X(AX + 1), 110]));
  add(code('Approval Decision', 'approval_decision.js', [X(AX + 2), -110]));
  add(ifTrue('Approved?', [X(AX + 3), -110], "={{ $json.decision === 'approved' }}"));
  add(http('HubSpot: Log Approved Follow-up', [X(AX + 4), -220], {
    method: 'POST',
    url: `=${HUBSPOT}/crm/v3/objects/notes`,
    auth: 'hubspot',
    body: '={{ JSON.stringify($json.approved_note) }}',
  }));
  add(code('Record Approval Outcome', 'record_approval.js', [X(AX + 5), -110]));
  chain('Write Audit Log', 'Needs Approval?');
  connect('Needs Approval?', 'Wait for Rep Approval', 0);
  connect('Needs Approval?', 'Done', 1);
  chain('Wait for Rep Approval', 'Approval Decision', 'Approved?');
  connect('Approved?', 'HubSpot: Log Approved Follow-up', 0);
  connect('Approved?', 'Record Approval Outcome', 1);
  connect('HubSpot: Log Approved Follow-up', 'Record Approval Outcome');

  //  8. Metrics endpoint
  add({
    name: 'Metrics Webhook',
    type: 'n8n-nodes-base.webhook',
    typeVersion: 2,
    position: [X(0), 560],
    webhookId: uid('aircall-metrics'),
    parameters: { path: 'aircall-metrics', responseMode: 'lastNode', options: {} },
  });
  add(code('Compute Metrics', 'compute_metrics.js', [X(1), 560]));
  chain('Metrics Webhook', 'Compute Metrics');

  //  Sticky notes
  add(sticky('Intake', '## ① Intake : verify, normalize, dedupe\nAircall `call.ended` → verify webhook `token` → map to a canonical call object → idempotency key `aircall:<event>:<call_id>`.\n\n**Demo:** edit `SCENARIO` in *Demo Fixture* and click *Test workflow*.', [-80, -340], [2100, 760], 5));
  add(sticky('HubSpot', '## ② Resolve the customer in HubSpot\nSearch by phone → existing: pull lifecycle, owner, company/deal/ticket associations · new: create *Unknown Caller* lead.', [1900, -340], [860, 760], 4));
  add(sticky('Transcript', '## ③ Transcript\nLive: `GET /v1/calls/:id/transcription` · Demo: fixture transcripts.', [2780, -340], [700, 760], 6));
  add(sticky('AI', '## ④ AI analysis + guardrails\nStrict JSON schema → validation → **deterministic policy**.\nAI proposes; business rules decide. Low confidence, unknown intent or requested commitments (discounts, refunds, contract changes) → human review, no CRM side effects.\nThe summary note is always logged.', [3500, -340], [1760, 760], 3));
  add(sticky('Routes', '## ⑤ Route-specific CRM actions\n**Sales** → company + deal (early stage only) + task · **Support** → ticket + task · **Cancellation** → churn risk + CSM task (4h SLA) · **General** → note only · **Review** → skips straight to ⑥', [5260, -1140], [2340, 960], 2));
  add(sticky('Notify', '## ⑥ Alert + Aircall write-back + audit\nSlack Block Kit alert (dry run if no URL) → Aircall tag + comment on the call (dry run unless `aircall_live`) → audit record + idempotency key marked completed.', [7640, -340], [1700, 760], 4));
  add(sticky('Approval', '## ⑦ Human-in-the-loop follow-up\nAI drafts the email; it is **never sent automatically**. Rep clicks Approve/Reject in Slack → execution resumes. 24h timeout → expires.', [9360, -460], [1480, 880], 5));
  add(sticky('Metrics', '## ⑧ Metrics\n`GET /webhook/aircall-metrics` → automation rate, review rate, confidence, latency, approvals.', [-80, 460], [680, 320], 7));

  return serialize(wf, TEST ? { errorWorkflow: testId(ERROR_WF_NAME) } : {});
}

// ═════════════════════════════════════════════════════════════════════════════
// 02 · Error handler (dead-letter + engineering alert)
// ═════════════════════════════════════════════════════════════════════════════
function errorWorkflow() {
  const wf = workflow(ERROR_WF_NAME);
  const { add, connect, chain } = wf;
  add({ name: 'Error Trigger', type: 'n8n-nodes-base.errorTrigger', typeVersion: 1, position: [0, 0], parameters: {} });
  add(code('Build Dead Letter', 'error/dead_letter.js', [220, 0], {
    transform: (s) => (TEST ? s.replace("const SLACK_WEBHOOK_URL = '';", `const SLACK_WEBHOOK_URL = '${MOCK}/slack';`) : s),
  }));
  add(ifTrue('Slack Configured?', [440, 0], '={{ !!$json.slack_webhook_url }}'));
  add(http('Slack: Engineering Alert', [660, -110], {
    method: 'POST',
    url: '={{ $json.slack_webhook_url }}',
    body: '={{ JSON.stringify($json.slack_payload) }}',
    onError: 'continueRegularOutput',
  }));
  add(noop('Slack: Dry Run', [660, 110]));
  chain('Error Trigger', 'Build Dead Letter', 'Slack Configured?');
  connect('Slack Configured?', 'Slack: Engineering Alert', 0);
  connect('Slack Configured?', 'Slack: Dry Run', 1);
  add(sticky('About', '## Error handler\nSet as **Error Workflow** in *01 · Aircall → HubSpot* → Settings.\n\nEvery HTTP node already retries 3× with backoff (429 / 5xx). Anything that still fails lands here: classified (auth / rate-limited / upstream / bad request / bug), stored as a dead letter, and alerted.\n\nThe idempotency key was never marked *completed*, so replaying the execution is safe.', [-60, -300], [920, 560], 3));
  return serialize(wf);
}

// ═════════════════════════════════════════════════════════════════════════════
// 00 · Setup (HubSpot properties + demo customers, Aircall tags)
// ═════════════════════════════════════════════════════════════════════════════
function setupWorkflow() {
  const wf = workflow('00 · Setup : HubSpot properties, demo customers, Aircall tags');
  const { add, connect, chain } = wf;
  const HS = TEST ? `${MOCK}/hubspot` : 'https://api.hubapi.com';
  const AC = TEST ? `${MOCK}/aircall` : 'https://api.aircall.io/v1';

  add({ name: 'Run Setup', type: 'n8n-nodes-base.manualTrigger', typeVersion: 1, position: [0, 0], parameters: {} });

  add(code('Define Contact Properties', 'setup/properties.js', [220, -220]));
  add(http('HubSpot: Create Property', [440, -220], {
    method: 'POST', url: `${HS}/crm/v3/properties/contacts`, auth: 'hubspot', body: '={{ JSON.stringify($json) }}', fullResponse: true, retry: false,
  }));

  add(code('Define Demo Customers', 'setup/seed_customers.js', [220, 0]));
  add(http('HubSpot: Create Contact', [440, 0], {
    method: 'POST', url: `${HS}/crm/v3/objects/contacts`, auth: 'hubspot', body: '={{ JSON.stringify({ properties: $json.contact }) }}', fullResponse: true, retry: false,
  }));
  add(ifTrue('Contact Created?', [660, 0], '={{ $json.statusCode === 201 }}', '409 = already seeded → skip'));
  add(http('HubSpot: Create Company', [880, -60], {
    method: 'POST',
    url: `${HS}/crm/v3/objects/companies`,
    auth: 'hubspot',
    body: `={{ JSON.stringify({
  properties: $('Define Demo Customers').item.json.company,
  associations: [{ to: { id: $json.body.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 280 }] }]
}) }}`,
    fullResponse: true,
    retry: false,
  }));

  add(code('Define Aircall Tags', 'setup/aircall_tags.js', [220, 240]));
  const tagNode = http('Aircall: Create Tag', [440, 240], {
    method: 'POST', url: `${AC}/tags`, auth: 'aircall', body: '={{ JSON.stringify($json) }}', fullResponse: true, retry: false,
  });
  if (!TEST) tagNode.disabled = true;
  add(tagNode);

  chain('Run Setup', 'Define Contact Properties', 'HubSpot: Create Property');
  chain('Run Setup', 'Define Demo Customers', 'HubSpot: Create Contact', 'Contact Created?');
  connect('Contact Created?', 'HubSpot: Create Company', 0);
  chain('Run Setup', 'Define Aircall Tags', 'Aircall: Create Tag');

  add(sticky('About', '## One-time setup : run once, then use 01\n1. **HubSpot properties** used by the workflow (`aircall_churn_risk`, `aircall_last_intent`, `aircall_last_call_id`).\n2. **Demo customers** for the support + cancellation scenarios (existing customers).\n3. **Aircall tags** *(disabled : enable once you have Aircall API credentials, then copy tag IDs into Config)*.\n\nSafe to re-run: existing records return 409.', [-60, -520], [1180, 300], 5));
  return serialize(wf);
}

//  write
const files = {
  '00-setup-hubspot-and-aircall.json': setupWorkflow(),
  '01-aircall-hubspot-ai-call-intelligence.json': mainWorkflow(),
  '02-error-handler.json': errorWorkflow(),
};
const generated = new Map();
for (const [file, wf] of Object.entries(files)) {
  generated.set(file, `${JSON.stringify(wf, null, 2)}\n`);
}
if (TEST) {
  generated.set('credentials.json', `${JSON.stringify([
    { ...TEST_CREDS.hubspotAppToken, type: 'hubspotAppToken', data: { appToken: 'mock-hubspot-token' } },
    { ...TEST_CREDS.openAiApi, type: 'openAiApi', data: { apiKey: 'mock-openai-key', url: 'https://api.openai.com/v1' } },
    { ...TEST_CREDS.httpBasicAuth, type: 'httpBasicAuth', data: { user: 'mock-api-id', password: 'mock-api-token' } },
  ], null, 2)}\n`);
}

let mismatches = 0;
if (!CHECK) fs.mkdirSync(OUT, { recursive: true });
for (const [file, content] of generated) {
  const destination = path.join(OUT, file);
  if (CHECK) {
    const current = fs.existsSync(destination) ? fs.readFileSync(destination, 'utf8') : null;
    if (current !== content) {
      console.error(`${path.relative(ROOT, destination)} is missing or stale; run node src/build.mjs${TEST ? ' --test' : ''}`);
      mismatches += 1;
    }
    continue;
  }
  fs.writeFileSync(destination, content);
  const wf = files[file];
  if (!wf) continue;
  console.log(`${path.relative(ROOT, path.join(OUT, file))}  (${wf.nodes.filter((n) => n.type !== 'n8n-nodes-base.stickyNote').length} nodes)`);
}
if (CHECK) {
  if (mismatches) process.exitCode = 1;
  else console.log(`${TEST ? 'Test' : 'Public'} workflow JSON matches the Code-node source (${generated.size} files checked).`);
}
