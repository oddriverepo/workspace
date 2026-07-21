import test from 'node:test';
import assert from 'node:assert/strict';
import { MetaAdsError, validateDashboardRequest } from './meta-ads.js';

const originalEnv = {
  accessToken: process.env.META_ADS_ACCESS_TOKEN,
  accountIds: process.env.META_ADS_ACCOUNT_IDS,
  defaultAccountId: process.env.META_ADS_DEFAULT_ACCOUNT_ID,
};

test.before(() => {
  process.env.META_ADS_ACCESS_TOKEN = 'test-token';
  process.env.META_ADS_ACCOUNT_IDS = 'act_2604221799864447';
  process.env.META_ADS_DEFAULT_ACCOUNT_ID = 'act_2604221799864447';
});

test.after(() => {
  for (const [key, value] of Object.entries({
    META_ADS_ACCESS_TOKEN: originalEnv.accessToken,
    META_ADS_ACCOUNT_IDS: originalEnv.accountIds,
    META_ADS_DEFAULT_ACCOUNT_ID: originalEnv.defaultAccountId,
  })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

test('aceita conta autorizada e periodo historico valido', () => {
  const request = validateDashboardRequest({
    accountId: 'act_2604221799864447',
    from: '2026-06-01',
    to: '2026-06-30',
  });
  assert.equal(request.accountId, 'act_2604221799864447');
  assert.equal(request.rangeDays, 30);
});

test('rejeita conta fora da lista autorizada', () => {
  assert.throws(
    () => validateDashboardRequest({ accountId: 'act_1', from: '2026-06-01', to: '2026-06-30' }),
    (error) => error instanceof MetaAdsError && error.code === 'META_ADS_INVALID_ACCOUNT',
  );
});

test('rejeita periodos maiores que um ano', () => {
  assert.throws(
    () => validateDashboardRequest({
      accountId: 'act_2604221799864447',
      from: '2025-01-01',
      to: '2026-06-30',
    }),
    (error) => error instanceof MetaAdsError && error.code === 'META_ADS_PERIOD_TOO_LARGE',
  );
});

test('rejeita periodos futuros', () => {
  assert.throws(
    () => validateDashboardRequest({
      accountId: 'act_2604221799864447',
      from: '2099-01-01',
      to: '2099-01-02',
    }),
    (error) => error instanceof MetaAdsError && error.code === 'META_ADS_FUTURE_PERIOD',
  );
});
