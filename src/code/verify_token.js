// Aircall includes a per-webhook `token` in every payload. We use it to verify the
// event is genuine and to identify which Aircall account it belongs to.
// The token itself is NOT passed downstream.
const { config, request } = $input.first().json;
const body = request.body ?? {};
const account = config.accounts[body.token];

return [{
  json: {
    valid: Boolean(account),
    account: account?.name ?? null,
    reason: account ? null : body.token ? 'unknown_token' : 'missing_token',
    source: request._demo ? `demo_fixture:${request._scenario}` : 'aircall_webhook',
    received_at: new Date().toISOString(),
    body: { ...body, token: undefined },
  },
}];
