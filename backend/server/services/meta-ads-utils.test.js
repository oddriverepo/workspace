import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDateList,
  deriveMetrics,
  groupContiguousDates,
  inferCampaignCity,
  isFreshForDate,
  normalizeInsightRow,
  toMoneyCents,
} from './meta-ads-utils.js';

test('buildDateList inclui as duas pontas do periodo', () => {
  assert.deepEqual(buildDateList('2026-07-07', '2026-07-10'), [
    '2026-07-07', '2026-07-08', '2026-07-09', '2026-07-10',
  ]);
});

test('groupContiguousDates cria somente os intervalos ausentes', () => {
  assert.deepEqual(groupContiguousDates(['2026-07-03', '2026-07-01', '2026-07-02', '2026-07-06']), [
    { from: '2026-07-01', to: '2026-07-03' },
    { from: '2026-07-06', to: '2026-07-06' },
  ]);
});

test('dados historicos permanecem validos e dados atuais expiram', () => {
  const now = new Date('2026-07-17T15:00:00.000Z');
  assert.equal(isFreshForDate('2026-05-01', '2026-05-02T00:00:00.000Z', now, '2026-07-17'), true);
  assert.equal(isFreshForDate('2026-07-17', '2026-07-17T14:50:00.000Z', now, '2026-07-17'), false);
  assert.equal(isFreshForDate('2026-07-17', '2026-07-17T14:58:00.000Z', now, '2026-07-17'), true);
});

test('normaliza dinheiro e calcula taxas a partir dos valores-base', () => {
  assert.equal(toMoneyCents('91.15'), 9115);
  const metrics = deriveMetrics({
    spendCents: 9115,
    reach: 2880,
    impressions: 4000,
    clicks: 72,
    leadsStarted: 21,
    conversationsReplied: 19,
  });
  assert.equal(metrics.spend, 91.15);
  assert.equal(metrics.cpl.toFixed(2), '4.34');
  assert.equal(metrics.ctr, 1.8);
  assert.equal(metrics.frequency.toFixed(4), '1.3889');
});

test('extrai leads e conversas da resposta da Meta', () => {
  const row = normalizeInsightRow({
    account_id: '1',
    account_name: 'OD Drive',
    account_currency: 'BRL',
    campaign_id: 'cmp_1',
    campaign_name: 'Campanha - Direct - (uber) Campinas - 16/06',
    spend: '91.15',
    reach: '2880',
    impressions: '4000',
    clicks: '72',
    date_start: '2026-07-07',
    date_stop: '2026-07-14',
    actions: [
      { action_type: 'onsite_conversion.messaging_conversation_started_7d', value: '21' },
      { action_type: 'onsite_conversion.messaging_conversation_replied_7d', value: '19' },
    ],
  }, { accountId: 'act_1', level: 'campaign' });
  assert.equal(row.accountId, 'act_1');
  assert.equal(row.city, 'Campinas');
  assert.equal(row.spendCents, 9115);
  assert.equal(row.leadsStarted, 21);
  assert.equal(row.conversationsReplied, 19);
});

test('identifica cidades conhecidas no nome da campanha', () => {
  assert.equal(inferCampaignCity('Campanha Conversao Direct Sao Paulo'), 'Sao Paulo');
  assert.equal(inferCampaignCity('Campanha - Dourados - Uber'), 'Dourados');
  assert.equal(inferCampaignCity('Campanha sem local'), 'Nao identificada');
});
