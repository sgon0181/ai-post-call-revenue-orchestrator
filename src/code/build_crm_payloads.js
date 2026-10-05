// Builds the always-safe CRM writes:
//  - an AI call note (logged for every call, clearly marked when held for review)
//  - contact enrichment (only applied if the Confidence Gate passes)
const cfg = $('Config').first().json.config;
const ctx = $input.first().json;
const { analysis: a, policy, customer: c } = ctx;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const pct = (n) => `${Math.round(n * 100)}%`;
const list = (xs) => (xs?.length ? xs.map(esc).join(', ') : ':');

//  Note
const status = policy.automation_allowed
  ? `✅ Automation applied (route: <b>${policy.route}</b>)`
  : `⚠️ <b>Held for human review</b>: ${policy.review_reasons.map(esc).join(' · ')}`;
const noteHtml = [
  `<p><b>🤖 Aircall AI call analysis</b> : call #${esc(ctx.call_id)} · ${esc(ctx.direction)} · ${ctx.talk_seconds ?? '?'}s talk · agent ${esc(ctx.agent.name)}</p>`,
  `<p><b>Intent:</b> ${esc(a.intent)} · <b>Priority:</b> ${esc(a.priority)} · <b>Sentiment:</b> ${esc(a.sentiment)} · <b>AI confidence:</b> ${pct(a.confidence)}</p>`,
  `<p><b>Summary:</b> ${esc(a.summary)}</p>`,
  `<p><b>Needs:</b> ${list(a.customer_needs)}${a.current_provider ? ` · <b>Current provider:</b> ${esc(a.current_provider)}` : ''}${a.seat_count ? ` · <b>Seats:</b> ${a.seat_count}` : ''}${a.timeline ? ` · <b>Timeline:</b> ${esc(a.timeline)}` : ''}</p>`,
  a.issue?.description ? `<p><b>Issue:</b> ${esc(a.issue.description)} (${esc(a.issue.severity)})</p>` : '',
  `<p><b>Next action:</b> ${esc(a.next_action)} : ${esc(a.next_action_detail)}</p>`,
  `<p>${status}</p>`,
  policy.corrections.length ? `<p><b>Policy corrections:</b> ${list(policy.corrections)}</p>` : '',
  `<p><i>Source: Aircall ${esc(ctx.event)} · ${esc(ctx.ai_meta.model)} · ${esc(ctx.ai_meta.prompt_version)} · workflow v${cfg.workflow_version}</i></p>`,
].filter(Boolean).join('');

const noteTimestamp = new Date((ctx.ended_at ?? Math.floor(Date.now() / 1000)) * 1000).toISOString();
const note = {
  properties: { hs_timestamp: noteTimestamp, hs_note_body: noteHtml },
  associations: [{ to: { id: c.contact_id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }],
};

//  Contact enrichment: fill gaps only, never overwrite what a human entered
const props = {};
if (c.is_placeholder_name && a.customer.name) {
  const [first, ...rest] = a.customer.name.trim().split(/\s+/);
  props.firstname = first;
  props.lastname = rest.join(' ');
}
if (!c.company && a.customer.company) props.company = a.customer.company;
if (!c.email && a.customer.email) props.email = a.customer.email.toLowerCase();
if (!c.jobtitle && a.customer.role) props.jobtitle = a.customer.role;
if (policy.route === 'sales' && [null, '', 'subscriber', 'lead', 'marketingqualifiedlead'].includes(c.lifecyclestage)) {
  props.lifecyclestage = 'salesqualifiedlead';
}
if (cfg.hubspot.custom_properties_enabled) {
  props.aircall_last_intent = a.intent;
  props.aircall_last_call_id = ctx.call_id;
  if (policy.route === 'cancellation' || ['medium', 'high'].includes(a.churn_risk)) {
    props.aircall_churn_risk = a.churn_risk === 'none' ? 'low' : a.churn_risk;
  }
}

return [{
  json: {
    ...ctx,
    lookup: { company_name: a.customer.company || c.company || null },
    requests: { note, contact_update: { properties: props } },
  },
}];
