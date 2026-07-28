/**
 * Webhook endpoints para intenções do agente GPT Maker.
 *
 * Montado em /api/agent. Substitui MCP como mecanismo de consulta
 * operacional do agente, usando REST puro em vez de JSON-RPC.
 *
 * SEGURANÇA:
 *  - Bearer token via AGENT_WEBHOOK_SECRET (timing-safe, hard-fail sem env)
 *  - Consultas são read-only; a gravação é restrita a evidências de imagem
 *  - Respostas nunca contêm CPF, PIX, e-mail, fotos, IDs internos,
 *    metas numéricas, dados financeiros ou qualquer campo sensível
 *  - O agente recebe apenas indicadores binários/categóricos + safe_reply
 */

import crypto from 'crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  lookup_contact,
  search_campaigns_by_city,
} from '../services/mcp/tools.js';
import { registerAgentEvidence } from '../services/agent-evidence.js';
import {
  normalizeGptMakerNewMessage,
  sanitize,
  summarizeGptMakerWebhookPayload,
} from '../services/agent-evidence-webhook.js';
import { normalizeEvidencePhone } from '../services/agent-evidence-utils.js';
import { isCampaignDriverDetached } from '../services/mongo.js';
import { readCampaignById, readDriverByExactPhone } from '../services/oddrive-sync.js';

const router = Router();

// ── Auth ──────────────────────────────────────────────────────────────

function hashStr(s) {
  return crypto.createHash('sha256').update(String(s), 'utf8').digest();
}

function timingSafeStringEqual(a, b) {
  try {
    return crypto.timingSafeEqual(hashStr(a), hashStr(b));
  } catch {
    return false;
  }
}

function isEvidenceEventRoute(req) {
  const path = String(req.path || '').replace(/\/+$/, '');
  return path === '/evidences/on-new-message'
    || path === '/evidences/on-new-message-debug';
}

function querySecretValues(req) {
  if (!isEvidenceEventRoute(req)) return [];
  return [req.query?.secret, req.query?.webhook_secret]
    .filter(value => typeof value === 'string' || typeof value === 'number')
    .map(value => String(value).trim())
    .filter(Boolean);
}

function removeSecretFromUrl(value) {
  const raw = String(value || '');
  if (!raw.includes('?')) return raw;
  try {
    const parsed = new URL(raw, 'http://localhost');
    parsed.searchParams.delete('secret');
    parsed.searchParams.delete('webhook_secret');
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return raw
      .replace(/([?&])(secret|webhook_secret)=[^&#]*/gi, '$1')
      .replace(/[?&]+$/, '')
      .replace('?&', '?');
  }
}

function clearQuerySecrets(req) {
  if (req.query && typeof req.query === 'object') {
    delete req.query.secret;
    delete req.query.webhook_secret;
  }
  req.url = removeSecretFromUrl(req.url);
  req.originalUrl = removeSecretFromUrl(req.originalUrl);
}

export function authenticateAgent(req, res, next) {
  const secret = String(process.env.AGENT_WEBHOOK_SECRET || '').trim();
  if (secret.length < 16) {
    return res.status(503).json({ error: 'Agent webhook not configured' });
  }
  const auth = String(req.headers['authorization'] || '');
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  const headerSecret = String(
    req.headers['x-agent-webhook-secret'] || req.headers['x-webhook-secret'] || '',
  ).trim();
  const presentedSecrets = [
    match?.[1]?.trim(),
    headerSecret,
    ...querySecretValues(req),
  ].filter(Boolean);
  if (!presentedSecrets.length) {
    return res.status(401).json({ error: 'Missing webhook secret' });
  }
  if (!presentedSecrets.some(value => timingSafeStringEqual(value, secret))) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  clearQuerySecrets(req);
  next();
}

// ── Rate limit (por IP, antes do auth) ───────────────────────────────

function positiveIntegerEnv(name, fallback, { min = 1, max = 10_000 } = {}) {
  const parsed = Number.parseInt(String(process.env[name] || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

const agentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded' },
  skip: isEvidenceEventRoute,
});

const evidenceEventLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: positiveIntegerEnv('AGENT_EVIDENCE_EVENT_RATE_LIMIT_PER_MINUTE', 300, {
    min: 60,
    max: 3_000,
  }),
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Evidence event rate limit exceeded' },
  skip: req => !isEvidenceEventRoute(req),
});

router.use(agentLimiter);
router.use(evidenceEventLimiter);
router.use(authenticateAgent);

// ── Helpers de safe_reply ─────────────────────────────────────────────

// Intentionally takes NO name parameter — driver names must never appear
// in agent responses. All strings are hardcoded to prevent accidental leaks.
function safeReplyContactFound(type) {
  if (type === 'driver') {
    return 'Este contato já possui cadastro ativo no sistema.';
  }
  if (type === 'graphic') {
    return 'Este contato consta como parceiro gráfico no sistema.';
  }
  // Fallback: found=true but unexpected type — treat as unrecognised contact.
  return 'Contato identificado no sistema. Por favor, oriente conforme o contexto da conversa.';
}

function safeReplyCampaign(campaigns) {
  // campaigns = [{ campaign_name, open }] ou []
  if (!campaigns || campaigns.length === 0) {
    return {
      has_campaign: false,
      status: 'none',
      safe_reply:
        'No momento não aparece campanha aberta para novos motoristas nessa região. Mesmo assim, vale completar o cadastro no app para futuras oportunidades.',
    };
  }
  const openOnes = campaigns.filter((c) => c.open);
  if (openOnes.length > 0) {
    return {
      has_campaign: true,
      status: 'open',
      safe_reply:
        'No momento existem campanhas abertas para essa região, mas a participação depende do cadastro no app e da avaliação da campanha.',
    };
  }
  // Tem campanha mas todas fechadas (meta batida)
  return {
    has_campaign: true,
    status: 'full',
    safe_reply:
      'Tem campanha na sua cidade, mas no momento as vagas dessa campanha já foram preenchidas. Vale deixar seu cadastro pronto no app para próximas oportunidades.',
  };
}

function safeReplyDriverCampaign(details) {
  if (!details?.found) {
    return {
      has_campaign: false,
      status: 'not_found',
      registered_driver: false,
      safe_reply:
        'Não encontrei cadastro ativo para este telefone. Para participar, complete seu cadastro no app OD Drive.',
    };
  }

  if (details.campaign_name) {
    return {
      has_campaign: true,
      status: details.status || 'active',
      registered_driver: true,
      safe_reply:
        `Sim, você está vinculado à campanha ${details.campaign_name}. Para acompanhar detalhes, acesse o app OD Drive.`,
    };
  }

  return {
    has_campaign: false,
    status: 'none',
    registered_driver: true,
    safe_reply:
      'Você possui cadastro ativo, mas não aparece vínculo com campanha ativa no momento. Acompanhe os convites pelo app OD Drive.',
  };
}

async function getExactDriverCampaignStatus(rawPhone) {
  const phone = normalizeEvidencePhone(rawPhone);
  if (!phone) {
    return {
      invalid: true,
      found: false,
    };
  }

  const driver = await readDriverByExactPhone(phone);
  if (!driver) return { invalid: false, found: false };

  const driverId = String(driver.id || driver._id || '').trim();
  const campaignId = String(
    driver.campaignId || driver.campaignData?.campaignId || '',
  ).trim();
  const driverCampaignId = String(
    driver.driverCampaignId || driver.campaignData?.driverCampaignId || '',
  ).trim();

  if (!campaignId || await isCampaignDriverDetached(campaignId, driverId, driverCampaignId)) {
    return {
      invalid: false,
      found: true,
      campaign_name: '',
      status: 'none',
    };
  }

  const campaign = await readCampaignById(campaignId);
  return {
    invalid: false,
    found: true,
    campaign_name: String(campaign?.name || campaign?.title || '').trim(),
    status: String(driver.status || 'active').trim(),
  };
}

// ── Endpoints ─────────────────────────────────────────────────────────

/**
 * POST /api/agent/lookup-contact-status
 *
 * Verifica se um contato (telefone ou nome+telefone) já existe no sistema.
 * Para WhatsApp: passe { phone }.
 * Para Instagram (sem telefone): não chame este endpoint ou passe { name }
 * após o usuário informar o número.
 *
 * Entrada: { phone?, name?, channel? }
 * Saída:   { registered_driver, type, safe_reply }
 */
// Input field limits (prevents oversized strings reaching DB/normalize logic)
const MAX_PHONE = 30;
const MAX_NAME  = 120;
const MAX_CITY  = 80;

/**
 * POST /api/agent/evidences/register-image
 *
 * Registra uma imagem recebida pelo agente no fluxo de evidências da campanha.
 * O backend identifica motorista e campanha exclusivamente pelo telefone.
 */
router.post('/evidences/register-image', async (req, res) => {
  try {
    const result = await registerAgentEvidence(req.body || {});
    return res.json(result);
  } catch (error) {
    const status = Number(error?.status || error?.statusCode || 500);
    const clientError = status >= 400 && status < 500;
    console.error('[agent][evidence] erro:', error?.message || error);
    return res.status(clientError ? status : 500).json({
      success: false,
      safe_reply: clientError
        ? 'Não consegui processar essa imagem. Verifique os dados e tente novamente.'
        : 'Não consegui salvar essa imagem agora. Tente novamente em alguns instantes.',
    });
  }
});

/**
 * POST /api/agent/evidences/on-new-message-debug
 *
 * Diagnostico temporario do payload bruto do onNewMessage. Registra somente
 * um snapshot estrutural sanitizado; nunca registra credenciais ou PII completa.
 */
router.post('/evidences/on-new-message-debug', (req, res) => {
  const body = req.body;
  const snapshot = {
    content_type: String(req.headers['content-type'] || '').slice(0, 200),
    body_type: typeof body,
    top_level_keys: body && typeof body === 'object'
      ? Object.keys(body)
      : [],
    sanitized_body: sanitize(body ?? null),
  };
  console.info(
    '[agent][evidence][on-new-message-debug][payload]',
    JSON.stringify(snapshot),
  );
  return res.json({ success: true, received: true });
});

function evidenceEventLog(payload, extra = {}) {
  const snapshot = summarizeGptMakerWebhookPayload(payload || {});
  console.info(
    '[agent][evidence][on-new-message][event]',
    JSON.stringify({
      has_contactPhone: snapshot.has_contactPhone,
      has_contextId: snapshot.has_contextId,
      has_messageId: snapshot.has_messageId,
      images_count: snapshot.images_count,
      role: snapshot.role || snapshot.message_role || 'unknown',
      ignored_reason: extra.ignored_reason || null,
      debug_reason: extra.debug_reason || null,
      processing_result: extra.processing_result || 'received',
    }),
  );
}

function missingEvidenceEventFields(input = {}) {
  const missing = [];
  if (!input.phone) missing.push('phone');
  if (!input.message_id) missing.push('message_id');
  if (!input.image_url && !input.chat_id) missing.push('image_url_or_chat_id');
  return missing;
}

/**
 * POST /api/agent/evidences/on-new-message
 *
 * Fonte principal para imagens recebidas. Mensagens que nao sejam imagens
 * enviadas pelo usuario sao confirmadas e ignoradas sem efeitos colaterais.
 */
router.post('/evidences/on-new-message', async (req, res) => {
  const event = normalizeGptMakerNewMessage(req.body || {});
  if (!event.accepted) {
    evidenceEventLog(req.body, {
      ignored_reason: event.reason,
      processing_result: 'ignored',
    });
    return res.json({
      success: true,
      ignored: true,
      ignored_reason: event.reason,
      processed: false,
    });
  }

  const missingFields = missingEvidenceEventFields(event.input);
  if (missingFields.length) {
    const debugReason = `missing_${missingFields.join('_')}`;
    evidenceEventLog(req.body, {
      debug_reason: debugReason,
      processing_result: 'missing_required_fields',
    });
    return res.json({
      success: false,
      processed: false,
      debug_reason: debugReason,
      safe_reply: 'Nao consegui processar essa imagem. Vou encaminhar para conferencia da equipe.',
    });
  }

  try {
    const result = await registerAgentEvidence(event.input);
    evidenceEventLog(req.body, {
      processing_result: result?.ignored
        ? 'ignored_not_registered'
        : (result?.duplicate ? 'duplicate' : 'processed'),
    });
    return res.json({
      processed: Boolean(result?.success && !result?.ignored && !result?.duplicate),
      ...result,
    });
  } catch (error) {
    const status = Number(error?.status || error?.statusCode || 500);
    const clientError = status >= 400 && status < 500;
    const debugReason = clientError ? 'processing_client_error' : 'processing_server_error';
    evidenceEventLog(req.body, {
      debug_reason: debugReason,
      processing_result: 'failed',
    });
    console.error('[agent][evidence][on-new-message] erro:', error?.message || error);
    return res.status(clientError ? status : 500).json({
      success: false,
      processed: false,
      debug_reason: debugReason,
      safe_reply: clientError
        ? 'Nao consegui processar essa imagem. Vou encaminhar para conferencia da equipe.'
        : 'Nao consegui salvar essa imagem agora. Tente novamente em alguns instantes.',
    });
  }
});

router.post('/lookup-contact-status', async (req, res) => {
  try {
    const rawPhone = String(req.body?.phone ?? '').slice(0, MAX_PHONE) || undefined;
    const rawName  = String(req.body?.name  ?? '').slice(0, MAX_NAME)  || undefined;
    const phone = rawPhone || undefined;
    const name  = rawName  || undefined;
    const result = await lookup_contact({ phone, name });

    const registered_driver = result.type === 'driver' && result.found;
    const safe_reply =
      result.found
        ? safeReplyContactFound(result.type) // nunca expõe nome — veja função acima
        : 'Nenhum cadastro encontrado para este contato.';

    return res.json({
      registered_driver,
      type: result.type,       // "driver" | "graphic" | "lead_unknown"
      safe_reply,
    });
  } catch (err) {
    console.error('[agent][lookup-contact-status] erro:', err?.message);
    return res.status(500).json({
      registered_driver: false,
      type: 'lead_unknown',
      safe_reply: 'Não foi possível verificar o contato agora.',
    });
  }
});

/**
 * POST /api/agent/search-campaign-status-by-city
 *
 * Verifica se há campanha ativa na cidade e se ainda está aberta.
 * Opcionalmente, se phone vier junto, também verifica se o contato
 * já é motorista (para orientar a resposta sem expor o dado).
 *
 * Entrada: { city, phone?, channel? }
 * Saída:   { has_campaign, status, registered_driver, safe_reply }
 */
router.post('/search-campaign-status-by-city', async (req, res) => {
  try {
    const city  = String(req.body?.city  ?? '').slice(0, MAX_CITY).trim();
    const phone = String(req.body?.phone ?? '').slice(0, MAX_PHONE) || undefined;
    if (!city || city.length < 2) {
      return res.status(400).json({ error: 'city é obrigatório' });
    }

    // Busca de campanhas e verificação de contato em paralelo
    const [campaigns, contactResult] = await Promise.all([
      search_campaigns_by_city({ city }),
      phone ? lookup_contact({ phone }) : Promise.resolve(null),
    ]);

    const registered_driver =
      contactResult?.found && contactResult?.type === 'driver';

    const campaignPayload = safeReplyCampaign(campaigns);

    return res.json({
      ...campaignPayload,
      registered_driver,
    });
  } catch (err) {
    console.error('[agent][search-campaign-status-by-city] erro:', err?.message);
    return res.status(500).json({
      has_campaign: false,
      status: 'none',
      registered_driver: false,
      safe_reply: 'Não foi possível consultar campanhas agora.',
    });
  }
});

/**
 * POST /api/agent/search-campaign-status-by-contact
 *
 * Verifica o status do próprio contato pelo telefone.
 *
 * Use para perguntas como:
 * - "já estou em campanha?"
 * - "estou ativo?"
 * - "meu número está em alguma campanha?"
 *
 * Entrada: { phone }
 * Saída:   { has_campaign, status, registered_driver, safe_reply }
 */
router.post('/search-campaign-status-by-contact', async (req, res) => {
  try {
    const phone = String(req.body?.phone ?? '').slice(0, MAX_PHONE);

    if (!phone) {
      return res.status(400).json({
        has_campaign: false,
        status: 'invalid_phone',
        registered_driver: false,
        safe_reply: 'Não consegui identificar o telefone deste contato.',
      });
    }

    const details = await getExactDriverCampaignStatus(phone);
    if (details.invalid) {
      return res.status(400).json({
        has_campaign: false,
        status: 'invalid_phone',
        registered_driver: false,
        safe_reply: 'Não consegui identificar um telefone válido para este contato.',
      });
    }
    return res.json(safeReplyDriverCampaign(details));
  } catch (err) {
    console.error('[agent][search-campaign-status-by-contact] erro:', err?.message);
    return res.status(500).json({
      has_campaign: false,
      status: 'none',
      registered_driver: false,
      safe_reply: 'Não foi possível consultar agora.',
    });
  }
});

export default router;
