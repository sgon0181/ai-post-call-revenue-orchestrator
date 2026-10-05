const ctx = $('Build Deal').first().json;
const deal = $input.first().json;
const { deal_request, ...rest } = ctx;
const a = ctx.analysis;
const dealId = String(deal.id);

const subject = a.next_action === 'send_pricing' && a.seat_count
  ? `Send ${a.seat_count}-seat pricing proposal`
  : a.next_action_detail;

const task_request = buildTask(ctx, {
  subject: `[Aircall] ${subject}`,
  type: 'EMAIL',
  body: `<p>${a.summary}</p><p><b>Next action:</b> ${a.next_action_detail}</p>${draftNote(a)}`,
  links: { deal: dealId, company: ctx.crm.company_id },
});

return [{ json: { ...rest, crm: { ...ctx.crm, deal_id: dealId }, task_request } }];
