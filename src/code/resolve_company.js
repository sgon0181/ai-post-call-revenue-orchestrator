// Company resolution order: existing contact association → name match → create.
const ctx = $('Attach Note ID').first().json;
const match = $input.first().json.results?.[0];
const associated = ctx.customer.company_ids[0];

const company = {
  id: associated ?? match?.id ?? null,
  source: associated ? 'contact_association' : match ? 'name_match' : null,
  name: ctx.lookup.company_name,
};
company.needs_create = !company.id && Boolean(company.name);

return [{ json: { ...ctx, company } }];
