// Converge fixture + live Aircall transcripts into one plain-text transcript.
const ctx = $('Build Customer Context').first().json;
const input = $input.first().json;
const MAX_CHARS = 24000; // keep prompts bounded; long calls are truncated from the middle

let utterances = [];
let source;
let status = 'ok';

if (input.transcript_raw) {
  ({ utterances, source } = input.transcript_raw);
} else {
  // Live: Aircall GET /v1/calls/:id/transcription (full response, never errors)
  source = 'aircall_api';
  if (input.statusCode && input.statusCode !== 200) {
    status = input.statusCode === 404 ? 'not_ready_or_missing' : `http_${input.statusCode}`;
  }
  const t = input.body?.transcription ?? input.body ?? {};
  const raw = t.content?.utterances ?? t.utterances ?? [];
  utterances = raw.map((u) => ({
    speaker: ['internal', 'agent', 'user'].includes(u.participant_type ?? u.speaker) ? 'agent' : 'customer',
    text: u.text ?? '',
  }));
}

if (status === 'ok' && utterances.length === 0) status = 'empty';

let text = utterances.map((u) => `${u.speaker === 'agent' ? 'Agent' : 'Customer'}: ${u.text}`).join('\n');
let truncated = false;
if (text.length > MAX_CHARS) {
  text = `${text.slice(0, MAX_CHARS / 2)}\n[... middle of call truncated ...]\n${text.slice(-MAX_CHARS / 2)}`;
  truncated = true;
}

return [{ json: { ...ctx, transcript: { source, status, utterance_count: utterances.length, truncated, text } } }];
