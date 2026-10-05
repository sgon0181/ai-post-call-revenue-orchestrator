const ctx = $('Build Ticket').first().json;
const ticket = $input.first().json;
const { ticket_request, ...rest } = ctx;
const a = ctx.analysis;
const ticketId = String(ticket.id);

const task_request = buildTask(ctx, {
  subject: `[Aircall] Follow up support ticket #${ticketId}: ${a.issue?.description ?? a.next_action_detail}`.slice(0, 250),
  type: 'CALL',
  priority: ['high', 'critical'].includes(a.issue?.severity) ? 'high' : a.priority,
  body: `<p>${a.summary}</p><p><b>Next action:</b> ${a.next_action_detail}</p>${draftNote(a)}`,
  links: { ticket: ticketId },
});

return [{ json: { ...rest, crm: { ...ctx.crm, ticket_id: ticketId }, task_request } }];
