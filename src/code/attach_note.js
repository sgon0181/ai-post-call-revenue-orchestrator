// Carry the HubSpot note ID forward with the rest of the call context.
const ctx = $('Build CRM Payloads').first().json;
const note = $input.first().json;
const { requests, ...rest } = ctx;

return [{
  json: {
    ...rest,
    contact_update: requests.contact_update,
    crm: { contact_id: ctx.customer.contact_id, note_id: String(note.id) },
  },
}];
