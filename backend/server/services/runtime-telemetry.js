import { monitorEventLoopDelay, performance } from 'node:perf_hooks';

const SAMPLE_INTERVAL_MS = Math.max(2000, Number.parseInt(process.env.RUNTIME_METRICS_INTERVAL_MS || '5000', 10) || 5000);
const HISTORY_LIMIT = Math.max(24, Math.min(360, Number.parseInt(process.env.RUNTIME_METRICS_HISTORY || '120', 10) || 120));
const MEMORY_LIMIT_MB = Math.max(128, Number.parseInt(process.env.RENDER_MEMORY_LIMIT_MB || process.env.MEMORY_LIMIT_MB || '512', 10) || 512);
const SOFT_MEMORY_MB = Math.max(64, Number.parseInt(process.env.MEMORY_SOFT_LIMIT_MB || String(Math.round(MEMORY_LIMIT_MB * 0.74)), 10) || Math.round(MEMORY_LIMIT_MB * 0.74));
const HARD_MEMORY_MB = Math.max(SOFT_MEMORY_MB + 16, Number.parseInt(process.env.MEMORY_HARD_LIMIT_MB || String(Math.round(MEMORY_LIMIT_MB * 0.86)), 10) || Math.round(MEMORY_LIMIT_MB * 0.86));

const eventLoopDelay = monitorEventLoopDelay({ resolution: 20 });
eventLoopDelay.enable();

const startedAt = Date.now();
const history = [];
const requestStats = {
  total: 0,
  errors: 0,
  active: 0,
  byModule: new Map(),
};
const externalStats = new Map();
const cacheStats = new Map();
let previousCpuUsage = process.cpuUsage();
let previousCpuAt = performance.now();
let lastCpuPercent = 0;

function round(value, digits = 1) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function bytesToMb(value) {
  return round((Number(value) || 0) / 1024 / 1024, 1);
}

function classifyModule(path = '') {
  if (path.startsWith('/api/meta-ads')) return 'Meta Ads';
  if (path.startsWith('/api/crm')) return 'CRM';
  if (path.startsWith('/api/drivers')) return 'Motoristas';
  if (path.startsWith('/api/campaigns')) return 'Campanhas';
  if (path.startsWith('/api/slides') || path.startsWith('/api/proposals')) return 'Gerador';
  if (path.startsWith('/api/disparador')) return 'OD Flow';
  return 'Outros';
}

function moduleEntry(name) {
  if (!requestStats.byModule.has(name)) {
    requestStats.byModule.set(name, { total: 0, errors: 0, active: 0, durationMs: 0, maxDurationMs: 0 });
  }
  return requestStats.byModule.get(name);
}

function memoryState(rssMb) {
  if (rssMb >= HARD_MEMORY_MB) return 'critical';
  if (rssMb >= SOFT_MEMORY_MB) return 'warning';
  return 'healthy';
}

function sampleCpu() {
  const now = performance.now();
  const elapsedMicros = Math.max(1, (now - previousCpuAt) * 1000);
  const delta = process.cpuUsage(previousCpuUsage);
  previousCpuUsage = process.cpuUsage();
  previousCpuAt = now;
  lastCpuPercent = round(((delta.user + delta.system) / elapsedMicros) * 100, 1);
  return lastCpuPercent;
}

function currentMemory() {
  const usage = process.memoryUsage();
  const rssMb = bytesToMb(usage.rss);
  return {
    rssMb,
    heapUsedMb: bytesToMb(usage.heapUsed),
    heapTotalMb: bytesToMb(usage.heapTotal),
    externalMb: bytesToMb(usage.external),
    arrayBuffersMb: bytesToMb(usage.arrayBuffers),
    limitMb: MEMORY_LIMIT_MB,
    softLimitMb: SOFT_MEMORY_MB,
    hardLimitMb: HARD_MEMORY_MB,
    utilizationPercent: round((rssMb / MEMORY_LIMIT_MB) * 100, 1),
    state: memoryState(rssMb),
  };
}

function addHistorySample() {
  const memory = currentMemory();
  const sample = {
    at: new Date().toISOString(),
    rssMb: memory.rssMb,
    heapUsedMb: memory.heapUsedMb,
    externalMb: memory.externalMb,
    cpuPercent: sampleCpu(),
    eventLoopP95Ms: round(eventLoopDelay.percentile(95) / 1e6, 1),
    activeRequests: requestStats.active,
  };
  history.push(sample);
  if (history.length > HISTORY_LIMIT) history.splice(0, history.length - HISTORY_LIMIT);
  eventLoopDelay.reset();
}

const sampleTimer = setInterval(addHistorySample, SAMPLE_INTERVAL_MS);
sampleTimer.unref?.();
addHistorySample();

export function requestTelemetryMiddleware(req, res, next) {
  if (!String(req.path || '').startsWith('/api')) return next();
  // A própria tela de telemetria não deve alterar os números que está exibindo.
  if (String(req.path || '').startsWith('/api/admin/runtime')) return next();
  const started = performance.now();
  const moduleName = classifyModule(req.path);
  const entry = moduleEntry(moduleName);
  requestStats.total += 1;
  requestStats.active += 1;
  entry.total += 1;
  entry.active += 1;
  let finished = false;

  const finish = () => {
    if (finished) return;
    finished = true;
    const durationMs = Math.max(0, performance.now() - started);
    requestStats.active = Math.max(0, requestStats.active - 1);
    entry.active = Math.max(0, entry.active - 1);
    entry.durationMs += durationMs;
    entry.maxDurationMs = Math.max(entry.maxDurationMs, durationMs);
    if (res.statusCode >= 500) {
      requestStats.errors += 1;
      entry.errors += 1;
    }
  };

  res.once('finish', finish);
  res.once('close', finish);
  next();
}

export function recordExternalCall(name, { durationMs = 0, ok = true } = {}) {
  const key = String(name || 'unknown');
  const entry = externalStats.get(key) || { calls: 0, errors: 0, durationMs: 0, maxDurationMs: 0, lastAt: null };
  entry.calls += 1;
  entry.errors += ok ? 0 : 1;
  entry.durationMs += Math.max(0, Number(durationMs) || 0);
  entry.maxDurationMs = Math.max(entry.maxDurationMs, Number(durationMs) || 0);
  entry.lastAt = new Date().toISOString();
  externalStats.set(key, entry);
}

export function recordCacheEvent(name, hit) {
  const key = String(name || 'unknown');
  const entry = cacheStats.get(key) || { hits: 0, misses: 0 };
  if (hit) entry.hits += 1;
  else entry.misses += 1;
  cacheStats.set(key, entry);
}

export function getMemoryPressure() {
  return currentMemory();
}

export function getRuntimeTelemetrySnapshot({ includeHistory = true } = {}) {
  const moduleRows = Array.from(requestStats.byModule.entries()).map(([name, entry]) => ({
    name,
    total: entry.total,
    errors: entry.errors,
    active: entry.active,
    averageDurationMs: entry.total ? round(entry.durationMs / entry.total, 1) : 0,
    maxDurationMs: round(entry.maxDurationMs, 1),
  }));
  const integrations = Array.from(externalStats.entries()).map(([name, entry]) => ({
    name,
    calls: entry.calls,
    errors: entry.errors,
    averageDurationMs: entry.calls ? round(entry.durationMs / entry.calls, 1) : 0,
    maxDurationMs: round(entry.maxDurationMs, 1),
    lastAt: entry.lastAt,
  }));
  const caches = Array.from(cacheStats.entries()).map(([name, entry]) => ({
    name,
    ...entry,
    hitRatePercent: entry.hits + entry.misses ? round((entry.hits / (entry.hits + entry.misses)) * 100, 1) : 0,
  }));

  return {
    generatedAt: new Date().toISOString(),
    startedAt: new Date(startedAt).toISOString(),
    uptimeSeconds: Math.round(process.uptime()),
    pid: process.pid,
    nodeVersion: process.version,
    memory: currentMemory(),
    cpu: { processPercent: lastCpuPercent },
    eventLoop: {
      p50Ms: round(eventLoopDelay.percentile(50) / 1e6, 1),
      p95Ms: round(eventLoopDelay.percentile(95) / 1e6, 1),
      maxMs: round(eventLoopDelay.max / 1e6, 1),
    },
    requests: {
      total: requestStats.total,
      errors: requestStats.errors,
      active: requestStats.active,
      modules: moduleRows,
    },
    integrations,
    caches,
    history: includeHistory ? history.slice() : undefined,
  };
}
