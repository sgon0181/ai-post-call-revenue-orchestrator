// AI proposes; deterministic business logic decides.
// This node is the single place where "what is automation allowed to do" lives.
const cfg = $('Config').first().json.config;
const ctx = $input.first().json;
const a = ctx.analysis;
const threshold = cfg.confidence_threshold;
const pct = (n) => `${Math.round(n * 100)}%`;

const reviewReasons = [];
const corrections = [];

// 1. CRM is the source of truth for "existing customer", not the model.
let intent = a.intent;
if (intent === 'sales_new' && ctx.customer.is_existing_customer) {
  intent = 'sales_existing';
  corrections.push('sales_new → sales_existing (HubSpot lifecycle stage is "customer")');
}

// 2. Hard gates → human review, no consequential CRM changes.
if (!ctx.validation.valid) reviewReasons.push(`AI output failed validation: ${ctx.validation.errors.join('; ')}`);
if (ctx.transcript.status !== 'ok') reviewReasons.push(`Transcript ${ctx.transcript.status}`);
if (intent === 'unknown') reviewReasons.push('Intent could not be determined');
if (a.confidence < threshold) reviewReasons.push(`Confidence ${pct(a.confidence)} is below the ${pct(threshold)} threshold`);
if (a.approval_required_requests.length) {
  reviewReasons.push(`Caller asked for commitments only a human can grant: ${a.approval_required_requests.join('; ')}`);
}
if (intent === 'cancellation' && ctx.customer.is_new_contact) {
  reviewReasons.push('Cancellation intent from a number not linked to any HubSpot customer');
}

// 3. Sales qualification is a business rule, not a model opinion.
const isSales = intent === 'sales_new' || intent === 'sales_existing';
const qualified = isSales && (a.seat_count > 0 || ['send_pricing', 'schedule_demo'].includes(a.next_action));

const ROUTES = { sales_new: 'sales', sales_existing: 'sales', support: 'support', billing: 'support', cancellation: 'cancellation', general: 'general', unknown: 'review' };
let route = ROUTES[intent] ?? 'review';
if (route === 'sales' && !qualified) {
  route = 'general';
  corrections.push('Sales intent without a buying signal → logged only, no deal created');
}
const automationAllowed = reviewReasons.length === 0;
if (!automationAllowed) route = 'review';

// 4. Capability allow-list per route + actions automation may never take.
const PERMITTED = {
  sales: ['log_note', 'update_contact', 'find_or_create_company', 'create_deal(early stages only)', 'create_task', 'draft_follow_up'],
  support: ['log_note', 'update_contact', 'create_ticket', 'create_task', 'draft_follow_up'],
  cancellation: ['log_note', 'update_contact', 'set_churn_risk', 'create_task', 'draft_follow_up'],
  general: ['log_note', 'update_contact', 'draft_follow_up'],
  review: ['log_note'],
};
const NEVER_AUTOMATED = ['close_deal', 'change_contract', 'issue_refund_or_credit', 'apply_discount', 'send_pricing_commitment', 'send_email_without_approval'];

// 5. The model may suggest a deal stage; policy decides.
const dealStage = cfg.hubspot.allowed_deal_stages.includes(a.deal_stage_suggestion)
  ? a.deal_stage_suggestion
  : cfg.hubspot.default_deal_stage;

// 6. Scan the AI-written follow-up for anything that looks like a commitment.
const COMMITMENT_PATTERNS = [
  [/[$€£]\s?\d/, 'mentions a price'],
  [/\b\d{1,3}\s?%/, 'mentions a percentage'],
  [/\bdiscount/i, 'mentions a discount'],
  [/\brefund|\bcredit\b/i, 'mentions a refund or credit'],
  [/\bguarantee/i, 'makes a guarantee'],
  [/\bfree of charge\b|\bfor free\b/i, 'offers something free'],
];
const draftText = `${a.follow_up_draft.subject}\n${a.follow_up_draft.body}`;
const draftFlags = COMMITMENT_PATTERNS.filter(([re]) => re.test(draftText)).map(([, label]) => label);

// 7. Ownership: contact owner → team default → unassigned.
const team = route === 'cancellation' ? 'customer_success' : route === 'support' ? 'support' : 'sales';
const ownerId = ctx.customer.owner_id || cfg.hubspot.owners[team] || null;

return [{
  json: {
    ...ctx,
    analysis: { ...a, intent, intent_from_model: a.intent },
    policy: {
      route,
      automation_allowed: automationAllowed,
      review_reasons: reviewReasons,
      corrections,
      qualified,
      deal_stage: dealStage,
      draft_flags: draftFlags,
      sla_hours: cfg.sla_hours[route] ?? 24,
      owner_team: team,
      owner_id: ownerId,
      permitted_actions: PERMITTED[route],
      never_automated: NEVER_AUTOMATED,
      confidence_threshold: threshold,
    },
  },
}];
