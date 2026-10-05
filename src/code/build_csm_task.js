// Churn risk: the contact's aircall_churn_risk was already set by "HubSpot: Update
// Contact". Here we make sure a human reaches out inside the SLA.
const ctx = $('Attach Note ID').first().json;
const a = ctx.analysis;

const task_request = buildTask(ctx, {
  subject: `[Aircall] 🚨 Churn risk (${a.churn_risk}) : call ${[ctx.customer.firstname, ctx.customer.lastname].filter(Boolean).join(' ') || 'customer'} within ${ctx.policy.sla_hours}h`,
  type: 'CALL',
  priority: 'high',
  body: `<p>${a.summary}</p><p><b>Evidence:</b> ${a.evidence.map((q) => `"${q}"`).join(' · ') || ':'}</p><p><b>Next action:</b> ${a.next_action_detail}</p>${draftNote(a)}`,
  links: { company: ctx.customer.company_ids[0] },
});

return [{ json: { ...ctx, task_request } }];
