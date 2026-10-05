// Close the loop in the audit log. The actual send is intentionally left to the
// rep's mailbox / HubSpot (plug a Gmail, Outlook or HubSpot single-send node here).
const d = $('Approval Decision').first().json;
const note = $('HubSpot: Log Approved Follow-up').isExecuted ? $('HubSpot: Log Approved Follow-up').first().json : null;
const store = $getWorkflowStaticData('global');

const entry = (store.audit ?? []).find((r) => r.execution_id === d.execution_id);
if (entry) {
  entry.approval = d.decision;
  entry.approval_decided_at = d.decided_at;
  entry.status = 'completed';
  if (note) entry.approved_note_id = String(note.id);
}

return [{ json: { call_id: d.call_id, decision: d.decision, approved_note_id: note ? String(note.id) : null, audit_updated: Boolean(entry) } }];
