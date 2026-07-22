import assert from 'node:assert/strict';
import test from 'node:test';

const {
  getRuntimeTelemetrySnapshot,
  recordCacheEvent,
  recordExternalCall,
} = await import('./runtime-telemetry.js');

test('snapshot operacional nao expoe credenciais e inclui metricas essenciais', () => {
  recordCacheEvent('teste-cache', true);
  recordCacheEvent('teste-cache', false);
  recordExternalCall('teste-api', { durationMs: 25, ok: true });

  const snapshot = getRuntimeTelemetrySnapshot();
  assert.ok(snapshot.memory.rssMb > 0);
  assert.ok(snapshot.memory.limitMb >= 128);
  assert.ok(Array.isArray(snapshot.history));
  assert.equal(snapshot.caches.find((item) => item.name === 'teste-cache').hitRatePercent, 50);
  assert.equal(snapshot.integrations.find((item) => item.name === 'teste-api').calls, 1);
  assert.equal(JSON.stringify(snapshot).includes('MONGO_URI'), false);
  assert.equal(JSON.stringify(snapshot).includes('ACCESS_TOKEN'), false);
});
