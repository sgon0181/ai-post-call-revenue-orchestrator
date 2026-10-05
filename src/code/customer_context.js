// Merge the call with whatever HubSpot knows about the caller.
// Input is either "Get Contact" (existing) or "Create Contact" (new) : both return
// a HubSpot contact object, so one node handles both paths.
const evt = $('Idempotency Check').first().json;
const search = $('HubSpot: Search Contact').first().json;
const contact = $input.first().json;
const p = contact.properties ?? {};
const assoc = contact.associations ?? {};
const ids = (key) => [...new Set((assoc[key]?.results ?? []).map((r) => String(r.id)))];

const { duplicate, duplicate_reason, dispatch, skip_reason, ...call } = evt;

return [{
  json: {
    ...call,
    customer: {
      contact_id: String(contact.id),
      is_new_contact: !(search.total > 0),
      is_placeholder_name: !p.firstname || p.firstname === 'Unknown',
      firstname: p.firstname ?? null,
      lastname: p.lastname ?? null,
      email: p.email ?? null,
      company: p.company ?? null,
      jobtitle: p.jobtitle ?? null,
      lifecyclestage: p.lifecyclestage ?? null,
      is_existing_customer: p.lifecyclestage === 'customer',
      owner_id: p.hubspot_owner_id || null,
      last_contacted: p.notes_last_contacted ?? null,
      churn_risk: p.aircall_churn_risk ?? null,
      company_ids: ids('companies'),
      deal_ids: ids('deals'),
      ticket_ids: ids('tickets'),
    },
  },
}];
