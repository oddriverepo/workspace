import test from 'node:test';
import assert from 'node:assert/strict';
import { authenticateAgent } from './agent-webhooks.js';

const SECRET = 'segredo-de-teste-com-mais-de-16-caracteres';

function runAuth({
  path = '/evidences/on-new-message',
  query = {},
  authorization = '',
  extraHeaders = {},
} = {}) {
  const queryString = new URLSearchParams(query).toString();
  const suffix = queryString ? `?${queryString}` : '';
  const req = {
    path,
    query: { ...query },
    url: `${path}${suffix}`,
    originalUrl: `/api/agent${path}${suffix}`,
    headers: {
      authorization,
      ...extraHeaders,
    },
  };
  const result = { status: null, body: null, nextCalled: false, req };
  const res = {
    status(value) {
      result.status = value;
      return this;
    },
    json(value) {
      result.body = value;
      return this;
    },
  };
  authenticateAgent(req, res, () => {
    result.nextCalled = true;
  });
  return result;
}

test('aceita Bearer token nas rotas do agente', () => {
  const previous = process.env.AGENT_WEBHOOK_SECRET;
  process.env.AGENT_WEBHOOK_SECRET = SECRET;
  try {
    const result = runAuth({ authorization: `Bearer ${SECRET}` });
    assert.equal(result.nextCalled, true);
    assert.equal(result.status, null);
  } finally {
    if (previous === undefined) delete process.env.AGENT_WEBHOOK_SECRET;
    else process.env.AGENT_WEBHOOK_SECRET = previous;
  }
});

test('aceita secret e remove o valor da URL antes de continuar', () => {
  const previous = process.env.AGENT_WEBHOOK_SECRET;
  process.env.AGENT_WEBHOOK_SECRET = SECRET;
  try {
    const result = runAuth({
      query: { secret: SECRET, source: 'gptmaker' },
    });
    assert.equal(result.nextCalled, true);
    assert.equal(result.req.query.secret, undefined);
    assert.equal(result.req.query.source, 'gptmaker');
    assert.equal(result.req.url, '/evidences/on-new-message?source=gptmaker');
    assert.equal(
      result.req.originalUrl,
      '/api/agent/evidences/on-new-message?source=gptmaker',
    );
  } finally {
    if (previous === undefined) delete process.env.AGENT_WEBHOOK_SECRET;
    else process.env.AGENT_WEBHOOK_SECRET = previous;
  }
});

test('aceita webhook_secret na rota de diagnostico', () => {
  const previous = process.env.AGENT_WEBHOOK_SECRET;
  process.env.AGENT_WEBHOOK_SECRET = SECRET;
  try {
    const result = runAuth({
      path: '/evidences/on-new-message-debug',
      query: { webhook_secret: SECRET },
    });
    assert.equal(result.nextCalled, true);
    assert.equal(result.req.query.webhook_secret, undefined);
    assert.equal(result.req.url, '/evidences/on-new-message-debug');
  } finally {
    if (previous === undefined) delete process.env.AGENT_WEBHOOK_SECRET;
    else process.env.AGENT_WEBHOOK_SECRET = previous;
  }
});

test('nao permite segredo por query string nas demais rotas do agente', () => {
  const previous = process.env.AGENT_WEBHOOK_SECRET;
  process.env.AGENT_WEBHOOK_SECRET = SECRET;
  try {
    const result = runAuth({
      path: '/search-campaign-status-by-contact',
      query: { secret: SECRET },
    });
    assert.equal(result.nextCalled, false);
    assert.equal(result.status, 401);
  } finally {
    if (previous === undefined) delete process.env.AGENT_WEBHOOK_SECRET;
    else process.env.AGENT_WEBHOOK_SECRET = previous;
  }
});

test('aceita uma credencial valida mesmo quando outra opcao e invalida', () => {
  const previous = process.env.AGENT_WEBHOOK_SECRET;
  process.env.AGENT_WEBHOOK_SECRET = SECRET;
  try {
    const result = runAuth({
      authorization: 'Bearer credencial-invalida',
      query: { secret: SECRET },
    });
    assert.equal(result.nextCalled, true);
  } finally {
    if (previous === undefined) delete process.env.AGENT_WEBHOOK_SECRET;
    else process.env.AGENT_WEBHOOK_SECRET = previous;
  }
});
