import { getMemoryPressure } from './runtime-telemetry.js';

export class WorkloadRejectedError extends Error {
  constructor(message, { code = 'WORKLOAD_BUSY', status = 503 } = {}) {
    super(message);
    this.name = 'WorkloadRejectedError';
    this.code = code;
    this.status = status;
    this.expose = true;
  }
}

class WorkloadLane {
  constructor(name, { concurrency, maxQueue, waitTimeoutMs, guardMemory = false }) {
    this.name = name;
    this.concurrency = concurrency;
    this.maxQueue = maxQueue;
    this.waitTimeoutMs = waitTimeoutMs;
    this.guardMemory = guardMemory;
    this.active = 0;
    this.queue = [];
    this.completed = 0;
    this.rejected = 0;
    this.totalWaitMs = 0;
    this.totalDurationMs = 0;
    this.operationSequence = 0;
    this.activeOperations = new Map();
  }

  checkMemory() {
    if (!this.guardMemory) return;
    const memory = getMemoryPressure();
    if (memory.state === 'critical') {
      this.rejected += 1;
      throw new WorkloadRejectedError('O servidor esta processando outras operacoes pesadas. Aguarde alguns segundos.', {
        code: 'MEMORY_PRESSURE',
      });
    }
  }

  acquire(operation = this.name) {
    this.checkMemory();
    if (this.active < this.concurrency) {
      this.active += 1;
      return Promise.resolve(this.createRelease(operation, 0));
    }
    if (this.queue.length >= this.maxQueue) {
      this.rejected += 1;
      throw new WorkloadRejectedError('A fila de processamento esta cheia. Tente novamente em instantes.', {
        code: 'WORKLOAD_QUEUE_FULL',
      });
    }

    return new Promise((resolve, reject) => {
      const queuedAt = Date.now();
      const item = { operation, queuedAt, resolve, reject, timer: null };
      item.timer = setTimeout(() => {
        const index = this.queue.indexOf(item);
        if (index >= 0) this.queue.splice(index, 1);
        this.rejected += 1;
        reject(new WorkloadRejectedError('A operacao aguardou tempo demais na fila. Tente novamente.', {
          code: 'WORKLOAD_QUEUE_TIMEOUT',
          status: 429,
        }));
      }, this.waitTimeoutMs);
      item.timer.unref?.();
      this.queue.push(item);
    });
  }

  createRelease(operation, waitedMs) {
    const startedAt = Date.now();
    const operationId = ++this.operationSequence;
    this.activeOperations.set(operationId, { name: operation, startedAt });
    this.totalWaitMs += waitedMs;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.activeOperations.delete(operationId);
      this.active = Math.max(0, this.active - 1);
      this.completed += 1;
      this.totalDurationMs += Date.now() - startedAt;
      this.drain();
    };
  }

  drain() {
    while (this.active < this.concurrency && this.queue.length) {
      const item = this.queue.shift();
      clearTimeout(item.timer);
      try {
        this.checkMemory();
        this.active += 1;
        item.resolve(this.createRelease(item.operation, Date.now() - item.queuedAt));
      } catch (error) {
        item.reject(error);
      }
    }
  }

  stats() {
    return {
      name: this.name,
      concurrency: this.concurrency,
      active: this.active,
      queued: this.queue.length,
      maxQueue: this.maxQueue,
      completed: this.completed,
      rejected: this.rejected,
      averageWaitMs: this.completed ? Math.round(this.totalWaitMs / this.completed) : 0,
      averageDurationMs: this.completed ? Math.round(this.totalDurationMs / this.completed) : 0,
      currentOperations: Array.from(this.activeOperations.values()).map((item) => ({
        name: item.name,
        durationMs: Date.now() - item.startedAt,
      })),
      queuedOperations: this.queue.map((item) => item.operation),
    };
  }
}

function positiveInt(value, fallback, maximum = 100) {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, maximum);
}

const lanes = {
  heavy: new WorkloadLane('heavy', {
    concurrency: positiveInt(process.env.WORKLOAD_HEAVY_CONCURRENCY, 1, 3),
    maxQueue: positiveInt(process.env.WORKLOAD_HEAVY_MAX_QUEUE, 6, 30),
    waitTimeoutMs: positiveInt(process.env.WORKLOAD_HEAVY_WAIT_MS, 60000, 180000),
    guardMemory: true,
  }),
  external: new WorkloadLane('external', {
    concurrency: positiveInt(process.env.WORKLOAD_EXTERNAL_CONCURRENCY, 2, 6),
    maxQueue: positiveInt(process.env.WORKLOAD_EXTERNAL_MAX_QUEUE, 12, 60),
    waitTimeoutMs: positiveInt(process.env.WORKLOAD_EXTERNAL_WAIT_MS, 30000, 120000),
  }),
};

export async function runWorkload(laneName, operation, task) {
  const lane = lanes[laneName];
  if (!lane) throw new Error(`Fila desconhecida: ${laneName}`);
  const release = await lane.acquire(operation);
  try {
    return await task();
  } finally {
    release();
  }
}

export function workloadGate(laneName, operation) {
  return async function workloadGateMiddleware(req, res, next) {
    const lane = lanes[laneName];
    if (!lane) return next(new Error(`Fila desconhecida: ${laneName}`));
    try {
      const release = await lane.acquire(operation);
      let released = false;
      const done = () => {
        if (released) return;
        released = true;
        release();
      };
      res.once('finish', done);
      res.once('close', done);
      next();
    } catch (error) {
      next(error);
    }
  };
}

export function getWorkloadStats() {
  return Object.values(lanes).map((lane) => lane.stats());
}
