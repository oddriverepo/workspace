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

test('seleciona motorista cadastrado com nono digito quando o agente envia sem nono', () => {
  const drivers = [
    { id: 'pedro', phoneDigits: '48996309676' },
  ];

  assert.equal(selectDriverByExactPhone(drivers, '554896309676')?.id, 'pedro');
  assert.equal(selectDriverByExactPhone(drivers, '4896309676')?.id, 'pedro');
  assert.equal(selectDriverByExactPhone(drivers, '+55 (48) 9630-9676')?.id, 'pedro');
});

test('seleciona motorista armazenado com DDI ao aplicar variante do nono digito', () => {
  const drivers = [
    { id: 'pedro', phoneDigits: '5548996309676' },
  ];

  assert.equal(selectDriverByExactPhone(drivers, '554896309676')?.id, 'pedro');
});

test('rejeita variante com nono digito quando existe mais de uma correspondencia possivel', () => {
  const drivers = [
    { id: 'old-format', phoneDigits: '4896309676' },
    { id: 'new-format', phoneDigits: '48996309676' },
  ];

  assert.equal(selectDriverByExactPhone(drivers, '554896309676'), null);
});

test('rejeita telefone sem DDD', () => {
  const drivers = [{ id: 'one', phoneDigits: '11999999999' }];
  assert.equal(selectDriverByExactPhone(drivers, '999999999'), null);
});
