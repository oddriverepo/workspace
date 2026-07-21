/**
 * partner-leads-sync.js
 * Sincroniza leads da API externa (Supabase Edge Function) no MongoDB.
 * Coleção: partner_leads
 * Config persistida: app_settings, _id = 'partnerLeadsSync'
 *
 * Proteções implementadas:
 *  - Mutex in-process: impede syncs concorrentes (manual + scheduler)
 *  - Circuit breaker: após MAX_CONSECUTIVE_FAILURES falhas, pausa com backoff exponencial
 *  - Auto-disable em 401: chave inválida desativa o scheduler automaticamente
 *  - BulkWrite: upserts em lote (sem loop serial de updateOne)
 *  - AbortSignal com timeout: fetch nunca fica pendurado indefinidamente
 */

import * as mongoClient from './mongoClient.js';

const LEADS_COLLECTION = 'partner_leads';
const SETTINGS_KEY = 'partnerLeadsSync';
const API_URL = 'https://iblhburofiqemhnvaluu.supabase.co/functions/v1/external-leads';
const API_KEY_ENV = 'LEADS_API_KEY';
const BATCH_LIMIT = 1000;

// ── Circuit breaker ──────────────────────────────────────────────
const MAX_CONSECUTIVE_FAILURES = 5;
// Backoff por número de falhas consecutivas (em ms): 5m, 15m, 30m, 1h, 2h
const BACKOFF_MS = [5, 15, 30, 60, 120].map(m => m * 60 * 1000);

// ── Estado in-process (não persiste entre restarts, mas protege o processo atual) ──
const _state = {
  running: false,          // mutex: true enquanto uma sync está em andamento
  consecutiveFailures: 0,  // contador de falhas seguidas
  coolingUntil: 0,         // timestamp epoch ms: sync bloqueada até esse momento
  lastTrigger: null,       // 'scheduler' | 'manual' | null
};

/** Retorna o estado atual para o endpoint /sync-status */
export function getSyncRuntimeState() {
  return {
    running: _state.running,
    consecutiveFailures: _state.consecutiveFailures,
    coolingUntil: _state.coolingUntil > Date.now() ? new Date(_state.coolingUntil).toISOString() : null,
    lastTrigger: _state.lastTrigger,
  };
}

// ─────────────────────────────────────────────────────────────────
//  Índices
// ─────────────────────────────────────────────────────────────────
export async function ensureLeadsIndexes() {
  const db = await mongoClient.getDb();
  const col = db.collection(LEADS_COLLECTION);
  await col.createIndex({ source: 1 }, { background: true });
  await col.createIndex({ ref_code: 1 }, { background: true });
  await col.createIndex({ created_at: 1 }, { background: true });
  await col.createIndex({ synced_at: 1 }, { background: true });
  await col.createIndex({ convertido: 1 }, { background: true });
}

// ─────────────────────────────────────────────────────────────────
//  Config persistida em app_settings
// ─────────────────────────────────────────────────────────────────
async function getSettingsDoc() {
  const db = await mongoClient.getDb();
  return db.collection('app_settings').findOne({ _id: SETTINGS_KEY });
}

async function saveSettingsDoc(data) {
  const db = await mongoClient.getDb();
  await db.collection('app_settings').updateOne(
    { _id: SETTINGS_KEY },
    { $set: { ...data, _id: SETTINGS_KEY, updatedAt: new Date() } },
    { upsert: true }
  );
}

export async function getSyncConfig() {
  const doc = await getSettingsDoc();
  return {
    enabled: doc?.enabled ?? false,
    intervalMinutes: doc?.intervalMinutes ?? 60,
    windowStart: doc?.windowStart ?? '08:00',
    windowEnd: doc?.windowEnd ?? '22:00',
    lastSyncAt: doc?.lastSyncAt ?? null,
    lastSyncCount: doc?.lastSyncCount ?? 0,
    lastSyncError: doc?.lastSyncError ?? null,
  };
}

export async function saveSyncConfig(cfg) {
  const allowed = ['enabled', 'intervalMinutes', 'windowStart', 'windowEnd'];
  const payload = {};
  for (const k of allowed) {
    if (cfg[k] !== undefined) payload[k] = cfg[k];
  }
  // apiKey nunca aceita via esta função — a chave vem exclusivamente de process.env.LEADS_API_KEY
  await saveSettingsDoc(payload);
}

// ─────────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────────

/** Retorna true se a hora atual está dentro da janela configurada */
function isWithinWindow(windowStart, windowEnd) {
  const now = new Date();
  const hh = now.getHours() * 60 + now.getMinutes();

  const parse = (t) => {
    const [h, m] = (t || '00:00').split(':').map(Number);
    return h * 60 + (m || 0);
  };

  const start = parse(windowStart);
  const end   = parse(windowEnd);

  if (start <= end) return hh >= start && hh <= end;
  // janela vira meia-noite (ex: 22:00–06:00)
  return hh >= start || hh <= end;
}

/** Resolve a API key exclusivamente da variável de ambiente */
function resolveApiKey() {
  return (process.env[API_KEY_ENV] || '').trim();
}

/** Formata uma date como YYYY-MM-DD */
function toDateStr(date) {
  if (!date) return null;
  return new Date(date).toISOString().slice(0, 10);
}

// ─────────────────────────────────────────────────────────────────
//  Core sync — com mutex, circuit breaker e bulkWrite
// ─────────────────────────────────────────────────────────────────

/**
 * Busca leads da API externa e faz upsert em lote no MongoDB.
 *
 * Proteções:
 *  - Mutex: rejeita imediatamente se já há uma sync em andamento
 *  - Circuit breaker: bloqueia novas tentativas após MAX_CONSECUTIVE_FAILURES erros
 *  - Auto-disable em 401: chave inválida → desativa scheduled sync
 *  - BulkWrite: todos os upserts em uma única operação de banco
 *  - AbortSignal.timeout: fetch cancela após 30s
 *
 * @param {{ force?: boolean }} [opts]  force=true ignora circuit breaker (uso interno)
 */
export async function syncPartnerLeads({ force = false } = {}) {
  // ── Mutex: impede execuções concorrentes ──────────────────────
  if (_state.running) {
    throw new Error('Sync já está em andamento. Aguarde a conclusão antes de tentar novamente.');
  }

  // ── Circuit breaker: backoff exponencial ─────────────────────
  if (!force && _state.coolingUntil > Date.now()) {
    const remaining = Math.ceil((_state.coolingUntil - Date.now()) / 60000);
    throw new Error(`Circuit breaker ativo após ${_state.consecutiveFailures} falhas consecutivas. Próxima tentativa em ${remaining} min.`);
  }

  const apiKey = resolveApiKey();
  if (!apiKey) {
    throw new Error('LEADS_API_KEY não configurada. Defina a variável de ambiente no Render.');
  }

  _state.running = true;
  _state.lastTrigger = force ? 'manual' : 'scheduler';

  try {
    const db  = await mongoClient.getDb();
    const col = db.collection(LEADS_COLLECTION);

    // Determina "since" a partir da última sync (margem de 1 dia para segurança)
    const settingsDoc = await getSettingsDoc();
    const lastSyncAt  = settingsDoc?.lastSyncAt ? new Date(settingsDoc.lastSyncAt) : null;
    const since = lastSyncAt
      ? toDateStr(new Date(lastSyncAt.getTime() - 24 * 60 * 60 * 1000))
      : null;

    const params = new URLSearchParams({ type: 'all', limit: String(BATCH_LIMIT) });
    if (since) params.set('since', since);

    const res = await fetch(`${API_URL}?${params.toString()}`, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(30000),
    });

    // 401 → chave inválida: desativa scheduler para não gerar chamadas em loop
    if (res.status === 401) {
      _state.consecutiveFailures = MAX_CONSECUTIVE_FAILURES;
      _state.coolingUntil = Date.now() + BACKOFF_MS[BACKOFF_MS.length - 1];
      await saveSettingsDoc({
        enabled: false,
        lastSyncError: 'Chave API inválida (401). Verifique LEADS_API_KEY no Render e reative a sync.',
      });
      throw new Error('Chave API inválida (401). Sync automática desativada.');
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`API retornou ${res.status}: ${text.slice(0, 200)}`);
    }

    const data = await res.json();
    if (!data.ok) throw new Error('API retornou ok=false');

    const now      = new Date();
    const drivers  = Array.isArray(data.drivers)  ? data.drivers  : [];
    const whatsapp = Array.isArray(data.whatsapp) ? data.whatsapp : [];

    const allLeads = [
      ...drivers.map(d  => ({ ...d,  source: 'driver'   })),
      ...whatsapp.map(w => ({ ...w,  source: 'whatsapp' })),
    ].filter(l => !!l.id);

    let inserted = 0;
    let updated  = 0;

    if (allLeads.length > 0) {
      // ── BulkWrite: todos os upserts em uma única operação ──────
      const ops = allLeads.map(lead => ({
        updateOne: {
          filter: { _id: lead.id },
          update: {
            $set: {
              source:         lead.source,
              nome:           lead.nome           || '',
              telefone:       lead.telefone        || '',
              email:          lead.email           || '',
              cidade:         lead.cidade          || '',
              estado:         lead.estado          || '',
              cpf:            lead.cpf             || '',
              cnh_numero:     lead.cnh_numero      || '',
              cnh_categoria:  lead.cnh_categoria   || '',
              veiculo_marca:  lead.veiculo_marca   || '',
              veiculo_modelo: lead.veiculo_modelo  || '',
              veiculo_ano:    lead.veiculo_ano     || null,
              veiculo_placa:  lead.veiculo_placa   || '',
              ref_code:       lead.ref_code        || '',
              partner_name:   lead.partner_name    || '',
              status:         lead.status          || 'novo',
              convertido:     lead.convertido      ?? false,
              origem:         lead.origem          || lead.source || '',
              message:        lead.message         || '',
              created_at:     lead.created_at ? new Date(lead.created_at) : now,
              synced_at:      now,
            },
            $setOnInsert: { _id: lead.id },
          },
          upsert: true,
        },
      }));

      const bulkResult = await col.bulkWrite(ops, { ordered: false });
      inserted = bulkResult.upsertedCount  || 0;
      updated  = bulkResult.modifiedCount  || 0;
    }

    // ── Sync bem-sucedida: reseta circuit breaker ──────────────
    _state.consecutiveFailures = 0;
    _state.coolingUntil        = 0;

    await saveSettingsDoc({
      lastSyncAt:    now,
      lastSyncCount: allLeads.length,
      lastSyncError: null,
    });

    console.log(`[partner-leads] Sync OK — total=${allLeads.length} inserted=${inserted} updated=${updated}`);
    return { inserted, updated, total: allLeads.length, generatedAt: data.generated_at };

  } catch (err) {
    // ── Falha: incrementa contador e aplica backoff ────────────
    _state.consecutiveFailures = Math.min(_state.consecutiveFailures + 1, MAX_CONSECUTIVE_FAILURES);
    const backoffIdx = _state.consecutiveFailures - 1;
    const backoff    = BACKOFF_MS[Math.min(backoffIdx, BACKOFF_MS.length - 1)];
    _state.coolingUntil = Date.now() + backoff;

    const backoffMin = Math.round(backoff / 60000);
    console.error(`[partner-leads] Sync falhou (tentativa ${_state.consecutiveFailures}/${MAX_CONSECUTIVE_FAILURES}, cooldown ${backoffMin}min):`, err.message);

    try {
      await saveSettingsDoc({ lastSyncError: err.message });
    } catch (_) {}

    throw err;
  } finally {
    _state.running     = false;
    _state.lastTrigger = null;
  }
}

// ─────────────────────────────────────────────────────────────────
//  Leitura de leads do MongoDB
// ─────────────────────────────────────────────────────────────────

export async function listPartnerLeads({ source, ref_code, since, convertido, limit = 2000 } = {}) {
  const db = await mongoClient.getDb();
  const col = db.collection(LEADS_COLLECTION);

  const filter = {};
  if (source && source !== 'all') filter.source = source;
  if (ref_code) filter.ref_code = ref_code;
  if (since)    filter.created_at = { $gte: new Date(since) };
  if (convertido !== undefined) filter.convertido = convertido;

  return col.find(filter).sort({ created_at: -1 }).limit(limit).toArray();
}

export async function countPartnerLeads() {
  const db = await mongoClient.getDb();
  return db.collection(LEADS_COLLECTION).estimatedDocumentCount();
}

// ─────────────────────────────────────────────────────────────────
//  Scheduler
// ─────────────────────────────────────────────────────────────────

let _schedulerHandle = null;

export function startLeadsScheduler() {
  if (_schedulerHandle) {
    clearInterval(_schedulerHandle);
    _schedulerHandle = null;
  }

  // Tick a cada minuto — a lógica interna decide se é hora de rodar
  _schedulerHandle = setInterval(async () => {
    try {
      // Não tenta se já está rodando (dupla proteção além do mutex)
      if (_state.running) return;

      // Não tenta se circuit breaker está ativo
      if (_state.coolingUntil > Date.now()) return;

      const cfg = await getSyncConfig();
      if (!cfg.enabled) return;
      if (!isWithinWindow(cfg.windowStart, cfg.windowEnd)) return;

      // Verifica se passou o intervalo configurado desde o último sync
      if (cfg.lastSyncAt) {
        const elapsed    = Date.now() - new Date(cfg.lastSyncAt).getTime();
        const intervalMs = (cfg.intervalMinutes || 60) * 60 * 1000;
        if (elapsed < intervalMs) return;
      }

      console.log('[partner-leads] Scheduler disparando sync automática...');
      await syncPartnerLeads(); // mutex interno garante exclusividade
    } catch (err) {
      // Erros já logados dentro de syncPartnerLeads; evita crash do setInterval
      if (!err.message?.includes('já está em andamento') && !err.message?.includes('Circuit breaker')) {
        console.error('[partner-leads] Erro inesperado no scheduler:', err.message);
      }
    }
  }, 60 * 1000); // tick a cada 1 minuto

  console.log('[partner-leads] Scheduler iniciado (tick a cada 60s)');
}

export function stopLeadsScheduler() {
  if (_schedulerHandle) {
    clearInterval(_schedulerHandle);
    _schedulerHandle = null;
    console.log('[partner-leads] Scheduler parado');
  }
}
