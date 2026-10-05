// Never trust model output blindly : even with strict structured outputs.
// Any failure produces a safe fallback analysis that the guardrail routes to review.
const ctx = $('Build AI Request').first().json;
const res = $input.first().json;
const { ai_request, ...rest } = ctx;

const ENUMS = {
  intent: ['sales_new', 'sales_existing', 'support', 'billing', 'cancellation', 'general', 'unknown'],
  next_action: ['send_pricing', 'schedule_demo', 'send_information', 'create_support_ticket', 'escalate_support', 'csm_outreach', 'billing_review', 'no_action'],
  priority: ['low', 'medium', 'high'],
  churn_risk: ['none', 'low', 'medium', 'high'],
  sentiment: ['positive', 'neutral', 'negative'],
  deal_stage_suggestion: ['none', 'appointmentscheduled', 'qualifiedtobuy', 'presentationscheduled'],
};

const errors = [];
const warnings = [];
let a = null;

const message = res.choices?.[0]?.message;
if (!message) errors.push('no choices in model response');
if (message?.refusal) errors.push(`model refused: ${message.refusal}`);
if (res.choices?.[0]?.finish_reason === 'length') errors.push('model output truncated (finish_reason=length)');

if (message?.content && !message.refusal) {
  try {
    a = JSON.parse(message.content);
  } catch (e) {
    errors.push(`invalid JSON: ${e.message}`);
  }
}

if (a) {
  for (const [field, allowed] of Object.entries(ENUMS)) {
    if (!allowed.includes(a[field])) errors.push(`${field}="${a[field]}" not in allowed values`);
  }
  if (typeof a.summary !== 'string' || !a.summary.trim()) errors.push('summary missing');
  if (typeof a.follow_up_draft?.body !== 'string') errors.push('follow_up_draft.body missing');
  if (!Array.isArray(a.approval_required_requests)) errors.push('approval_required_requests must be an array');
  if (typeof a.confidence !== 'number' || Number.isNaN(a.confidence)) {
    errors.push('confidence must be a number');
  } else if (a.confidence < 0 || a.confidence > 1) {
    warnings.push(`confidence ${a.confidence} clamped to [0,1]`);
    a.confidence = Math.min(1, Math.max(0, a.confidence));
  }
  if (a.seat_count !== null && !(Number.isInteger(a.seat_count) && a.seat_count > 0 && a.seat_count <= 100000)) {
    warnings.push(`implausible seat_count ${a.seat_count} dropped`);
    a.seat_count = null;
  }
  if (a.customer?.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.customer.email)) {
    warnings.push(`invalid email "${a.customer.email}" dropped`);
    a.customer.email = null;
  }
  a.evidence = (a.evidence ?? []).slice(0, 3);
}

const FALLBACK = {
  intent: 'unknown', summary: 'AI analysis unavailable : see validation errors.',
  customer: { name: null, company: null, email: null, role: null }, customer_needs: [],
  current_provider: null, seat_count: null, timeline: null, issue: { description: null, severity: null },
  churn_risk: 'none', sentiment: 'neutral', next_action: 'no_action', next_action_detail: 'Review the call manually.',
  deal_stage_suggestion: 'none', priority: 'medium', follow_up_required: false,
  follow_up_draft: { subject: '', body: '' }, approval_required_requests: [], evidence: [], confidence: 0,
};

const valid = errors.length === 0;
return [{
  json: {
    ...rest,
    analysis: valid ? a : FALLBACK,
    validation: { valid, errors, warnings },
    ai_meta: { model: res.model ?? null, usage: res.usage ?? null, prompt_version: ctx.prompt_version },
  },
}];
