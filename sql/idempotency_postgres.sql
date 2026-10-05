-- Production swap for the n8n static-data idempotency store + audit log.
-- Use when running n8n in queue mode (multiple workers) or when audit data must be
-- queryable / retained. Replace the "Idempotency Check" and "Write Audit Log" Code
-- nodes with Postgres nodes running the statements below.

CREATE TABLE IF NOT EXISTS aircall_event_ledger (
  idempotency_key  TEXT PRIMARY KEY,               -- aircall:<event>:<call_id>
  call_id          TEXT        NOT NULL,
  status           TEXT        NOT NULL CHECK (status IN ('in_progress', 'completed', 'failed')),
  execution_id     TEXT,
  attempts         INT         NOT NULL DEFAULT 1,
  first_seen_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Atomic claim. Returns a row → process it. Returns nothing → duplicate, stop.
-- Re-claims only if a previous attempt failed or has been stuck > 15 minutes.
INSERT INTO aircall_event_ledger (idempotency_key, call_id, status, execution_id)
VALUES ($1, $2, 'in_progress', $3)
ON CONFLICT (idempotency_key) DO UPDATE
   SET status = 'in_progress', execution_id = EXCLUDED.execution_id,
       attempts = aircall_event_ledger.attempts + 1, updated_at = now()
 WHERE aircall_event_ledger.status = 'failed'
    OR (aircall_event_ledger.status = 'in_progress' AND aircall_event_ledger.updated_at < now() - interval '15 minutes')
RETURNING idempotency_key;

-- Mark completed (end of workflow)
UPDATE aircall_event_ledger SET status = 'completed', updated_at = now() WHERE idempotency_key = $1;

-- Mark failed (error workflow) so a replay can re-claim immediately
UPDATE aircall_event_ledger SET status = 'failed', updated_at = now() WHERE execution_id = $1;


CREATE TABLE IF NOT EXISTS aircall_automation_audit (
  id                  BIGSERIAL PRIMARY KEY,
  call_id             TEXT        NOT NULL,
  idempotency_key     TEXT        NOT NULL REFERENCES aircall_event_ledger (idempotency_key),
  workflow_version    TEXT        NOT NULL,
  execution_id        TEXT        NOT NULL,
  status              TEXT        NOT NULL,
  route               TEXT        NOT NULL,          -- sales | support | cancellation | general | review
  intent              TEXT        NOT NULL,
  intent_from_model   TEXT,
  ai_confidence       NUMERIC(4,3),
  automation_allowed  BOOLEAN     NOT NULL,
  review_reasons      JSONB       NOT NULL DEFAULT '[]',
  hubspot_contact_id  TEXT,
  deal_id             TEXT,
  ticket_id           TEXT,
  task_id             TEXT,
  approval            TEXT,                          -- not_required | pending | approved | rejected | expired
  ai_model            TEXT,
  ai_tokens           INT,
  prompt_version      TEXT,
  end_to_end_seconds  INT,
  processed_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Metrics the FDE / customer reviews weekly
SELECT route,
       count(*)                                                   AS calls,
       round(avg(ai_confidence), 2)                               AS avg_confidence,
       round(100.0 * avg((automation_allowed)::int), 1)          AS automation_rate_pct,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY end_to_end_seconds) AS p50_latency_s,
       round(100.0 * count(*) FILTER (WHERE approval = 'approved')
             / NULLIF(count(*) FILTER (WHERE approval IN ('approved', 'rejected')), 0), 1) AS draft_approval_rate_pct
  FROM aircall_automation_audit
 WHERE processed_at > now() - interval '7 days'
 GROUP BY route
 ORDER BY calls DESC;
