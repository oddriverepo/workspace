/**
 * Webhook endpoints para intenções do agente GPT Maker.
 *
 * Montado em /api/agent. Substitui MCP como mecanismo de consulta
 * operacional do agente, usando REST puro em vez de JSON-RPC.
 *
 * SEGURANÇA:
 *  - Bearer token via AGENT_WEBHOOK_SECRET (timing-safe, hard-fail sem env)
 *  - Todos os endpoints são read-only
 *  - Respostas nunca contêm CPF, PIX, e-mail, fotos, IDs internos,
 *    metas numéricas, dados financeiros ou qualquer campo sensível
 *  - O agente recebe apenas indicadores binários/categóricos + safe_reply
 */

import crypto from 'crypto';
import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import {
  lookup_contact,
  get_driver_details,
  search_campaigns_by_city,
} from '../services/mcp/tools.js';

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

function authenticateAgent(req, res, next) {
  const secret = process.env.AGENT_WEBHOOK_SECRET;
  if (!secret || String(secret).trim().length < 16) {
    return res.status(503).json({ error: 'Agent webhook not configured' });
  }
  const auth = req.headers['authorization'] || '';
  const match = /^Bearer\s+(.+)$/i.exec(auth.trim());
  if (!match) {
    return res.status(401).json({ error: 'Missing bearer token' });
  }
  if (!timingSafeStringEqual(match[1].trim(), String(secret))) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  next();
}

// ── Rate limit (por IP, antes do auth) ───────────────────────────────

const agentLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Rate limit exceeded' },
});

router.use(agentLimiter);
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
    const phone = String(req.body?.phone ?? '').slice(0, MAX_PHONE) || undefined;

    if (!phone) {
      return res.status(400).json({ error: 'phone é obrigatório' });
    }

    const details = await get_driver_details({ phone });
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
