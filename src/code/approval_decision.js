// The Wait node resumes when the rep clicks Approve/Reject in Slack
// (GET <resumeUrl>?decision=approve|reject) or after the timeout.
const c = $('Write Audit Log').first().json;
const resumed = $input.first().json;
const decisionParam = resumed.query?.decision;
const decision = decisionParam === 'approve' ? 'approved' : decisionParam === 'reject' ? 'rejected' : resumed.query ? 'invalid_link' : 'expired';
const a = c.analysis;

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const approved_note = {
  properties: {
    hs_timestamp: new Date().toISOString(),
    hs_note_body: `<p><b>✅ AI follow-up approved by rep</b> (Aircall call #${esc(c.call_id)})</p><p><b>Subject:</b> ${esc(a.follow_up_draft.subject)}</p><p>${esc(a.follow_up_draft.body).replace(/\n/g, '<br>')}</p>`,
  },
  associations: [{ to: { id: c.crm.contact_id }, types: [{ associationCategory: 'HUBSPOT_DEFINED', associationTypeId: 202 }] }],
};

return [{ json: { call_id: c.call_id, execution_id: $execution.id, decision, decided_at: new Date().toISOString(), approved_note } }];
