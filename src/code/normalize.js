// Map Aircall's provider-specific payload onto our canonical call object.
// Everything downstream (CRM, AI, alerts) depends on THIS shape, not Aircall's,
// so swapping the telephony provider only touches this node.
const cfg = $('Config').first().json.config;
const { body, account, source, received_at } = $input.first().json;
const d = body.data ?? {};

const isTranscriptEvent = String(body.event ?? '').startsWith('transcription.');
const call = isTranscriptEvent ? (d.call ?? {}) : d;
const callId = String(isTranscriptEvent ? (d.call_id ?? d.call?.id ?? d.id) : d.id);

const num = (v) => (v === null || v === undefined || v === '' ? null : Number(v));
const startedAt = num(call.started_at);
const answeredAt = num(call.answered_at);
const endedAt = num(call.ended_at);

function toE164(raw) {
  if (!raw) return null;
  const cleaned = String(raw).replace(/[^\d+]/g, '');
  if (cleaned.replace('+', '').length < 6) return null; // "anonymous", extensions, junk
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`;
}
const phone = toE164(call.raw_digits);

// dispatch: process | skip (right event, nothing to analyse) | ignore (other events)
let dispatch = 'process';
let skipReason = null;
if (body.event !== cfg.processing_event) {
  dispatch = 'ignore';
  skipReason = `event "${body.event}" is not the processing event ("${cfg.processing_event}")`;
} else if (!isTranscriptEvent && !answeredAt) {
  dispatch = 'skip';
  skipReason = 'call was not answered : no conversation to analyse';
} else if (!phone) {
  dispatch = 'skip';
  skipReason = 'no usable caller number (anonymous / withheld / missing call details)';
}

return [{
  json: {
    call_id: callId,
    event: body.event,
    idempotency_key: `aircall:${body.event}:${callId}`,
    dispatch,
    skip_reason: skipReason,
    phone,
    direction: call.direction ?? null,
    started_at: startedAt,
    answered_at: answeredAt,
    ended_at: endedAt,
    duration_seconds: num(call.duration) ?? (startedAt && endedAt ? endedAt - startedAt : null),
    talk_seconds: answeredAt && endedAt ? endedAt - answeredAt : null,
    agent: {
      id: call.user?.id != null ? String(call.user.id) : null,
      name: call.user?.name ?? null,
      email: call.user?.email ?? null,
    },
    aircall_line: call.number?.name ?? null,
    account,
    source,
    event_timestamp: num(body.timestamp),
    received_at,
  },
}];
