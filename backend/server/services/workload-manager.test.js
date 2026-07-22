import assert from 'node:assert/strict';
import test from 'node:test';

process.env.WORKLOAD_HEAVY_CONCURRENCY = '1';
process.env.WORKLOAD_HEAVY_MAX_QUEUE = '6';

const { getWorkloadStats, runWorkload } = await import('./workload-manager.js');

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

test('fila pesada executa uma tarefa por vez', async () => {
  let active = 0;
  let maximumActive = 0;
  const order = [];

  const first = runWorkload('heavy', 'test:first', async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    order.push('first:start');
    await wait(30);
    order.push('first:end');
    active -= 1;
  });
  const second = runWorkload('heavy', 'test:second', async () => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    order.push('second:start');
    await wait(5);
    order.push('second:end');
    active -= 1;
  });

  await Promise.all([first, second]);
  assert.equal(maximumActive, 1);
  assert.deepEqual(order, ['first:start', 'first:end', 'second:start', 'second:end']);
  const heavy = getWorkloadStats().find((lane) => lane.name === 'heavy');
  assert.equal(heavy.active, 0);
  assert.equal(heavy.queued, 0);
  assert.ok(heavy.completed >= 2);
});
