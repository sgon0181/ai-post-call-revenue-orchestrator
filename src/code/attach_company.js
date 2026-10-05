const ctx = $('Resolve Company').first().json;
const created = $input.first().json;

return [{ json: { ...ctx, company: { ...ctx.company, id: String(created.id), source: 'created', needs_create: false } } }];
