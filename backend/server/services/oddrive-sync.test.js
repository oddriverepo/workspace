import test from 'node:test';
import assert from 'node:assert/strict';
import { selectDriverByExactPhone } from './oddrive-sync.js';

test('seleciona motorista pelo telefone completo mesmo com numero local repetido', () => {
  const drivers = [
    { id: 'sp', phoneDigits: '11999999999' },
    { id: 'rs', phoneDigits: '55999999999' },
  ];

  assert.equal(selectDriverByExactPhone(drivers, '5511999999999')?.id, 'sp');
  assert.equal(selectDriverByExactPhone(drivers, '5555999999999')?.id, 'rs');
});

test('aceita telefone armazenado com DDI e rejeita correspondencia ambigua', () => {
  const unique = [{ id: 'one', phoneDigits: '5511999999999' }];
  assert.equal(selectDriverByExactPhone(unique, '5511999999999')?.id, 'one');

  const duplicate = [
    { id: 'one', phoneDigits: '11999999999' },
    { id: 'two', phoneDigits: '5511999999999' },
  ];
  assert.equal(selectDriverByExactPhone(duplicate, '5511999999999'), null);
});

test('rejeita telefone sem DDD', () => {
  const drivers = [{ id: 'one', phoneDigits: '11999999999' }];
  assert.equal(selectDriverByExactPhone(drivers, '999999999'), null);
});
