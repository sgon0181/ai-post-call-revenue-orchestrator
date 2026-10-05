// GET /webhook/aircall-metrics → operational metrics from the audit log.
const store = $getWorkflowStaticData('global');
const audit = store.audit ?? [];
const n = audit.length;
const count = (fn) => audit.filter(fn).length;
const rate = (k) => (n ? Math.round((k / n) * 1000) / 10 : null);
const avg = (xs) => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 100) / 100 : null);
const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)];
};
const byKey = (k) => audit.reduce((acc, r) => ({ ...acc, [r[k]]: (acc[r[k]] ?? 0) + 1 }), {});
const decided = audit.filter((r) => ['approved', 'rejected'].includes(r.approval));

return [{
  json: {
    calls_processed: n,
    by_route: byKey('route'),
    by_intent: byKey('intent'),
    automation_rate_pct: rate(count((r) => r.automation_allowed)),
    human_review_rate_pct: rate(count((r) => !r.automation_allowed)),
    avg_ai_confidence: avg(audit.map((r) => r.ai_confidence)),
    median_end_to_end_seconds: median(audit.map((r) => r.end_to_end_seconds).filter((x) => x != null)),
    deals_created: count((r) => r.deal_id),
    tickets_created: count((r) => r.ticket_id),
    new_contacts_created: count((r) => r.is_new_contact),
    follow_up_approval_rate_pct: decided.length ? Math.round((decided.filter((r) => r.approval === 'approved').length / decided.length) * 1000) / 10 : null,
    follow_ups_pending: count((r) => r.approval === 'pending'),
    policy_corrections: count((r) => r.policy_corrections?.length),
    idempotency_keys_tracked: Object.keys(store.processed ?? {}).length,
    recent: audit.slice(0, 10),
  },
}];
