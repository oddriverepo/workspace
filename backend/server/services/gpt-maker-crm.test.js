import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractGptMakerProfileName,
  hasCombinedCoverage,
  isForceRefreshAllowed,
  isInstagramChat,
  mergeCoverageStart,
  normalizeChannelValue,
  normalizeProfileName,
  parseGptMakerTimestamp,
  resolveIncrementalSyncStart,
} from './gpt-maker-crm.js';

test('normaliza os tipos de canal do GPT Maker', () => {
  assert.equal(normalizeChannelValue('Instagram_Business'), 'instagram business');
  assert.equal(normalizeChannelValue('  INSTAGRAM-DIRECT '), 'instagram direct');
});

test('identifica chats do Instagram sem classificar WhatsApp', () => {
  assert.equal(isInstagramChat({ type: 'instagram_business' }), true);
  assert.equal(isInstagramChat({ conversationType: 'Instagram Direct' }), true);
  assert.equal(isInstagramChat({ type: 'whatsapp_oficial' }), false);
});

test('aceita tipo de canal configurado explicitamente', () => {
  assert.equal(isInstagramChat({ type: 'custom-ig-channel' }, ['custom-ig-channel']), true);
});

test('normaliza somente a identidade minima do perfil', () => {
  assert.equal(normalizeProfileName('  @Jo\u00e3o.Silva_87  '), 'joao silva 87');
  assert.equal(normalizeProfileName('Instagram User'), '');
  assert.equal(normalizeProfileName('(11) 99999-9999'), '');
});

test('prioriza o nome de usuario do contato retornado pelo GPT Maker', () => {
  assert.deepEqual(extractGptMakerProfileName({
    userName: 'Maria Oliveira',
    name: 'Nome secundario',
  }), {
    name: 'maria oliveira',
    source: 'userName',
    aliases: ['maria oliveira', 'nome secundario'],
  });
  assert.deepEqual(extractGptMakerProfileName({ metadata: { name: 'Carlos Souza' } }), {
    name: 'carlos souza',
    source: 'metadata.name',
    aliases: ['carlos souza'],
  });
});

test('converte timestamps em segundos, milissegundos e ISO', () => {
  assert.equal(parseGptMakerTimestamp(1_700_000_000)?.getTime(), 1_700_000_000_000);
  assert.equal(parseGptMakerTimestamp(1_700_000_000_000)?.getTime(), 1_700_000_000_000);
  assert.equal(parseGptMakerTimestamp('2026-07-17T12:00:00Z')?.toISOString(), '2026-07-17T12:00:00.000Z');
  assert.equal(parseGptMakerTimestamp('invalid'), null);
});

test('so considera o periodo coberto quando chats e atendimentos chegam ao inicio', () => {
  const requestedFrom = new Date('2026-07-01T00:00:00-03:00');
  assert.equal(hasCombinedCoverage(
    new Date('2026-06-20T00:00:00-03:00'),
    new Date('2026-07-05T00:00:00-03:00'),
    requestedFrom,
  ), false);
  assert.equal(hasCombinedCoverage(
    new Date('2026-06-20T00:00:00-03:00'),
    new Date('2026-06-25T00:00:00-03:00'),
    requestedFrom,
  ), true);
});

test('marca como coberto um recurso esgotado mesmo sem registros antigos', () => {
  const requestedFrom = new Date('2026-07-01T00:00:00-03:00');
  const coverage = mergeCoverageStart({
    previous: null,
    oldest: new Date('2026-07-10T00:00:00-03:00'),
    exhausted: true,
    requestedFrom,
  });
  assert.equal(coverage.toISOString(), requestedFrom.toISOString());
});

test('refresh de período coberto busca somente a sobreposição recente', () => {
  const requestedFrom = new Date('2026-01-01T00:00:00-03:00');
  const previousSyncAt = new Date('2026-07-17T15:00:00-03:00');
  const start = resolveIncrementalSyncStart({
    covered: true,
    identityBackfillPending: false,
    previousSyncAt,
    requestedFrom,
    overlapMs: 5 * 60 * 1000,
  });
  assert.equal(start.toISOString(), '2026-07-17T17:55:00.000Z');
});

test('período sem cobertura continua sincronizando desde o início solicitado', () => {
  const requestedFrom = new Date('2026-01-01T00:00:00-03:00');
  const start = resolveIncrementalSyncStart({
    covered: false,
    identityBackfillPending: false,
    previousSyncAt: new Date('2026-07-17T15:00:00-03:00'),
    requestedFrom,
  });
  assert.equal(start.toISOString(), requestedFrom.toISOString());
});

test('cooldown aceita o primeiro refresh e bloqueia repetição imediata', () => {
  assert.equal(isForceRefreshAllowed({
    requested: true,
    lastForcedAt: 0,
    now: 1_000_000,
    cooldownMs: 30_000,
  }), true);
  assert.equal(isForceRefreshAllowed({
    requested: true,
    lastForcedAt: 990_000,
    now: 1_000_000,
    cooldownMs: 30_000,
  }), false);
  assert.equal(isForceRefreshAllowed({
    requested: true,
    lastForcedAt: 960_000,
    now: 1_000_000,
    cooldownMs: 30_000,
  }), true);
});
