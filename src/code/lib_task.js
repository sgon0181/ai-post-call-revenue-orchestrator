//  shared task builder (injected by the build script into every task node)
const TASK_PRIORITY = { high: 'HIGH', medium: 'MEDIUM', low: 'LOW' };
const ASSOC_TYPE = { contact: 204, company: 192, deal: 216, ticket: 230 }; // task → object
function buildTask(ctx, { subject, body, type = 'TODO', priority = ctx.analysis.priority, links = {} }) {
  const due = new Date(Date.now() + ctx.policy.sla_hours * 3600 * 1000);
  const associations = Object.entries({ contact: ctx.customer.contact_id, ...links })
    .filter(([, id]) => id)
    .map(([kind, id]) => ({ to: { id: String(id) }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: ASSOC_TYPE[kind] }] }));
  const properties = {
    hs_timestamp: due.toISOString(),
    hs_task_subject: subject,
    hs_task_body: body,
    hs_task_status: 'NOT_STARTED',
    hs_task_priority: TASK_PRIORITY[priority] ?? 'MEDIUM',
    hs_task_type: type,
  };
  if (ctx.policy.owner_id) properties.hubspot_owner_id = ctx.policy.owner_id;
  return { properties, associations };
}
const draftNote = (a) => (a.follow_up_required ? '<p>📝 Follow-up email drafted by AI : awaiting rep approval in Slack.</p>' : '');
//  end shared
