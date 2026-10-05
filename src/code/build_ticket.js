const cfg = $('Config').first().json.config;
const ctx = $('Attach Note ID').first().json;
const { analysis: a, policy, customer: c } = ctx;

const severity = a.issue?.severity ?? a.priority;
const priority = ['high', 'critical'].includes(severity) ? 'HIGH' : severity === 'medium' ? 'MEDIUM' : 'LOW';

const properties = {
  subject: `[Aircall] ${a.issue?.description || a.next_action_detail}`.slice(0, 250),
  content: [
    a.summary,
    a.evidence.length ? `Caller said: ${a.evidence.map((q) => `"${q}"`).join(' · ')}` : null,
    `Severity (AI): ${severity} · Aircall call #${ctx.call_id}`,
  ].filter(Boolean).join('\n\n'),
  hs_pipeline: cfg.hubspot.ticket_pipeline,
  hs_pipeline_stage: cfg.hubspot.ticket_stage,
  hs_ticket_priority: priority,
};
if (policy.owner_id) properties.hubspot_owner_id = policy.owner_id;

const ticket_request = {
  properties,
  associations: [{ to: { id: c.contact_id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 16 }] }],
};

return [{ json: { ...ctx, ticket_request } }];
