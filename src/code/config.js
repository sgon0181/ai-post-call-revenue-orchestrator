//
// DEPLOYMENT CONFIG : the only node you edit per customer.
// Everything downstream reads from here, so the same workflow is reusable
// across accounts, CRMs pipelines and alert channels.
//
const config = {
  workflow_version: '1.0.0',

  // Aircall sends `token` in every webhook payload. Map each token to the account
  // it belongs to; unknown tokens are rejected. (Multi-account ready.)
  accounts: {
    'demo-webhook-token': { name: 'Demo Aircall Account' },
  },

  // Which Aircall event drives processing.
  //  - 'call.ended'            → demo / fixture transcripts (fires ~30s after hang-up)
  //  - 'transcription.created' → production with Conversation Intelligence enabled
  //                              (transcript guaranteed to exist when the event fires)
  processing_event: 'call.ended',

  // Live vs dry-run switches. Dry run = the exact request is built and logged
  // in the execution, but not sent.
  aircall_live: false,   // true → fetch transcript from Aircall + tag/comment the call
  slack_webhook_url: '', // Slack incoming-webhook URL; empty → dry run

  // AI configuration
  openai_model: 'gpt-4.1-mini',
  openai_temperature: 0,        // set to null for models that only accept the default
  confidence_threshold: 0.85,   // below this: human review; intake and audit notes may already exist

  hubspot: {
    portal_id: '',              // optional: enables "Open in HubSpot" links in Slack
    deal_pipeline: 'default',
    // AI may *suggest* a stage; policy only lets it use these early stages.
    allowed_deal_stages: ['appointmentscheduled', 'qualifiedtobuy', 'presentationscheduled'],
    default_deal_stage: 'qualifiedtobuy',
    price_per_seat_monthly: 40, // pipeline amount estimate only (seats × price × 12)
    ticket_pipeline: '0',
    ticket_stage: '1',
    // HubSpot owner IDs per team. Empty → contact owner, else unassigned.
    owners: { sales: '', support: '', customer_success: '' },
    // Created by the "00 · Setup" workflow: aircall_last_intent, aircall_last_call_id,
    // aircall_churn_risk. Set false if you skipped setup.
    custom_properties_enabled: true,
  },

  // Task due dates (hours from now) per route
  sla_hours: { sales: 24, support: 4, cancellation: 4, general: 48, review: 8 },

  // Aircall tag IDs (GET /v1/tags). null → tag skipped, comment still posted.
  aircall_tag_ids: {
    'AI-QUALIFIED-LEAD': null,
    'AI-SUPPORT-ISSUE': null,
    'AI-CHURN-RISK': null,
    'AI-NEEDS-REVIEW': null,
    'AI-PROCESSED': null,
  },

  idempotency_ttl_days: 14,
  // A failed/crashed run keeps its lock this long before a redelivery may re-claim it.
  // (n8n "Retry" on the failed execution bypasses this : it resumes at the failed node.)
  idempotency_lock_minutes: 15,

  // API base URLs (overridable for sandboxes / mock servers)
  endpoints: {
    hubspot: 'https://api.hubapi.com',
    openai: 'https://api.openai.com/v1',
    aircall: 'https://api.aircall.io/v1',
  },
};
// @@TEST_OVERRIDES@@

return $input.all().map((item) => ({ json: { config, request: item.json } }));
