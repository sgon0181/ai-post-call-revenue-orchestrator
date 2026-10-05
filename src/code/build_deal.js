// Deal creation is fully deterministic: stage comes from policy (early stages only),
// amount is an explicit estimate, and the deal can never be created as won/lost.
const cfg = $('Config').first().json.config;
const ctx = $input.first().json;
const { analysis: a, policy, customer: c, company } = ctx;

const label = company.name || [c.firstname, c.lastname].filter(Boolean).join(' ') || ctx.phone;
const seats = a.seat_count;
const amount = seats ? seats * cfg.hubspot.price_per_seat_monthly * 12 : null;

const properties = {
  dealname: `${label} : ${seats ? `${seats} seats` : 'new opportunity'} (Aircall)`,
  pipeline: cfg.hubspot.deal_pipeline,
  dealstage: policy.deal_stage,
  description: [
    a.summary,
    `Needs: ${a.customer_needs.join(', ') || ':'}`,
    a.current_provider ? `Current provider: ${a.current_provider}` : null,
    a.timeline ? `Timeline: ${a.timeline}` : null,
    amount ? `Amount is an ESTIMATE: ${seats} seats × ${cfg.hubspot.price_per_seat_monthly}/mo × 12. Not a quote.` : null,
    `Source: Aircall call #${ctx.call_id}`,
  ].filter(Boolean).join('\n'),
};
if (amount) properties.amount = String(amount);
if (policy.owner_id) properties.hubspot_owner_id = policy.owner_id;

const associations = [
  { to: { id: c.contact_id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 3 }] },
];
if (company.id) {
  associations.push({ to: { id: company.id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 5 }] });
}

return [{ json: { ...ctx, crm: { ...ctx.crm, company_id: company.id }, deal_request: { properties, associations } } }];
