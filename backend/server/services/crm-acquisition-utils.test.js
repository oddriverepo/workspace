import test from 'node:test';
import assert from 'node:assert/strict';
import { reconcileAcquisitionSources } from './crm-acquisition-utils.js';

test('separa chats atribuídos e sem atribuição publicitária', () => {
  const result = reconcileAcquisitionSources({
    attributedConversations: 448,
    observedChats: 515,
    spend: 1704.54,
  });

  assert.equal(result.available, true);
  assert.equal(result.status, 'reconciled');
  assert.equal(result.unattributedChats, 67);
  assert.equal(result.attributedShare, 86.99);
  assert.equal(result.unattributedShare, 13.01);
  assert.equal(result.costPerAttributedConversation.toFixed(2), '3.80');
});

test('não cria quantidade negativa quando a Meta supera os chats observados', () => {
  const result = reconcileAcquisitionSources({
    attributedConversations: 120,
    observedChats: 100,
    spend: 600,
  });

  assert.equal(result.status, 'sources-not-reconciled');
  assert.equal(result.unattributedChats, 0);
  assert.equal(result.excessAttributedConversations, 20);
  assert.equal(result.attributedWithinObservedChats, 100);
  assert.equal(result.attributedShare, 100);
});

test('mantém a conciliação indisponível quando uma fonte não respondeu', () => {
  const result = reconcileAcquisitionSources({
    attributedConversations: 12,
    observedChats: null,
    spend: 100,
  });

  assert.equal(result.available, false);
  assert.equal(result.unattributedChats, null);
  assert.equal(result.costPerAttributedConversation.toFixed(2), '8.33');
});

test('não inventa percentual quando não houve chat no período', () => {
  const result = reconcileAcquisitionSources({
    attributedConversations: 0,
    observedChats: 0,
    spend: 0,
  });

  assert.equal(result.available, true);
  assert.equal(result.unattributedChats, 0);
  assert.equal(result.attributedShare, null);
  assert.equal(result.unattributedShare, null);
});
