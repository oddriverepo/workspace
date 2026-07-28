import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentEvidenceDriverFolderName } from './agent-evidence-drive.js';

test('monta pasta do motorista com nome telefone e id', () => {
  assert.equal(
    buildAgentEvidenceDriverFolderName({
      id: 'driver-123',
      name: 'Joao da Silva',
      phone: '+55 (48) 9630-9676',
    }),
    'Joao da Silva - 554896309676 - driver-123',
  );
});

test('mantem pasta util mesmo sem telefone disponivel', () => {
  assert.equal(
    buildAgentEvidenceDriverFolderName({
      id: 'driver-123',
      name: 'Maria Souza',
    }),
    'Maria Souza - driver-123',
  );
});
