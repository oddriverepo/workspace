import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';

// ── Prevent process crash from unhandled async errors ──
process.on('unhandledRejection', (reason, promise) => {
  console.error('[UNHANDLED_REJECTION]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[UNCAUGHT_EXCEPTION]', err);
});
import { fileURLToPath } from 'url';
import os from 'os';

// ── Rotas do Gerenciador de Campanhas ──
import campaignsRouter from './routes/campaigns.js';
import metaTemplatesRouter from './routes/meta-templates.js';
import importsRouter   from './routes/imports.js';
import configRouter    from './routes/config.js';
import sessionRouter   from './routes/sessions.js';
import storageRouter   from './routes/storage.js';
import adminAuthRouter from './routes/admin-auth.js';
import adminUsersRouter from './routes/admin-users.js';
import mcpRouter from './routes/mcp.js';
import agentWebhooksRouter from './routes/agent-webhooks.js';
import driversRouter   from './routes/drivers.js';
import notificationsRouter from './routes/notifications.js';
import userWidgetsRouter from './routes/user-widgets.js';
import schedulingRouter   from './routes/scheduling.js';
import overviewActionsRouter from './routes/overview-actions.js';
import partnerLeadsRouter    from './routes/partner-leads.js';
import driverScoreRouter     from './routes/driver-score.js';
import crmRouter             from './routes/crm.js';
import suppliersRouter       from './routes/suppliers.js';
import metaAdsRouter         from './routes/meta-ads.js';

// ── Rotas do Gerador de Orçamentos (convertidas para ESM) ──
import { buildProposalsRouter }      from './routes/proposals.js';
import { buildSettingsRouter }       from './routes/settings.js';
import { buildSlidesRouter }         from './routes/slides.js';
import { buildRepresentativesRouter } from './routes/representatives.js';

// ── Rotas do Disparador (Atendimento WhatsApp) ──
import { disparadorRouter } from './disparador/routes/index.js';

// ── Serviços do Gerador ──
import { GoogleAuthService } from './services/googleAuth.js';
import { DataStore, MongoDataStore } from './services/dataStore.js';
import { configureMongoSessions } from './services/sessionStore.js';
import { configureAgentEvidenceDrive } from './services/agent-evidence-drive.js';
import * as mongoClient      from './services/mongoClient.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

const app  = express();
const PORT = process.env.PORT || 10000;
const HOST = '0.0.0.0';
const isProd = process.env.NODE_ENV === 'production';

// ── Trust proxy (Render / reverse proxy) ──
if (process.env.TRUST_PROXY === '1') {
  app.set('trust proxy', 1);
}
app.disable('x-powered-by');

// ── Request logger (não loga query string para evitar vazamento de tokens/tickets) ──
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    try {
      const dur = Date.now() - start;
      if (/\.(css|js|png|jpg|jpeg|svg|html)$/.test(req.path) || req.path === '/' || req.path.startsWith('/api')) {
        // req.path já exclui query string; req.originalUrl inclui. Usamos path para evitar leak.
        console.log(`[REQ] ${req.method} ${req.path} -> ${res.statusCode} (${dur}ms)`);
      }
    } catch (_) {}
  });
  next();
});

// ── Compression ──
app.use(compression());

// ── Helmet (segurança HTTP) ──
const helmetOptions = {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https:"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
};
if (isProd) {
  helmetOptions.hsts = { maxAge: 31536000, includeSubDomains: true, preload: true };
} else {
  helmetOptions.crossOriginOpenerPolicy = false;
  helmetOptions.originAgentCluster = false;
}
app.use(helmet(helmetOptions));

// ══════════════════════════════════════════
//  CORS – Origens permitidas
// ══════════════════════════════════════════
const allowedOrigins = new Set();

function addAllowedOrigins(rawValue) {
  String(rawValue || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .forEach((origin) => allowedOrigins.add(origin));
}

// Frontend principal
addAllowedOrigins(process.env.FRONTEND_URL);

// Origens extras
addAllowedOrigins(process.env.CORS_ORIGINS);

// Em produção, FRONTEND_URL ou CORS_ORIGINS DEVEM estar configurados no ambiente.
// Falha ruidosa em vez de fallback hardcoded — evita aceitar origem errada por engano.
if (isProd && !process.env.FRONTEND_URL && !process.env.CORS_ORIGINS) {
  console.error('[CORS] FRONTEND_URL ou CORS_ORIGINS não configurados em produção. Apenas same-origin será aceito.');
}
// Dev origins — only in non-production
if (!isProd) {
  const devOrigins = [
    'http://localhost:3000', 'http://localhost:4173', 'http://localhost:5173', 'http://localhost:5174',
    'http://127.0.0.1:3000', 'http://127.0.0.1:4173', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174',
    'https://localhost:3000', 'https://localhost:4173', 'https://localhost:5173', 'https://localhost:5174',
    'https://127.0.0.1:3000', 'https://127.0.0.1:4173', 'https://127.0.0.1:5173', 'https://127.0.0.1:5174',
    'capacitor://localhost', 'ionic://localhost',
  ];
  devOrigins.forEach(o => allowedOrigins.add(o));
}

function isPrivateLanHost(hostname = '') {
  return /^192\.168\./.test(hostname)
    || /^10\./.test(hostname)
    || /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(hostname);
}

function isAllowedOrigin(origin, req) {
  if (!origin) return true; // same-origin / curl / Postman
  if (allowedOrigins.has(origin)) return true;
  if (!isProd) {
    try {
      const parsed = new URL(origin);
      if (isPrivateLanHost(parsed.hostname)) return true;
    } catch (_) {}
  }
  // Same-origin check (only when req is available)
  if (req && typeof req.get === 'function') {
    const host = req.get('host');
    if (host) {
      const proto = (req.get('x-forwarded-proto') || req.protocol || 'http').split(',')[0].trim();
      if (origin === `${proto}://${host}`) return true;
    }
  }
  return false;
}

// Guard middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!origin) return next();
  if (isAllowedOrigin(origin, req)) return next();
  console.warn(`[CORS] Bloqueado: ${origin}`);
  return res.status(403).json({ error: 'Origem nao permitida' });
});

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || isAllowedOrigin(origin, {})) return callback(null, true);
    return callback(new Error('Origem nao permitida'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
}));

// ── Body parser ──
const bodyLimit = process.env.JSON_BODY_LIMIT || '10mb';
app.use(express.json({
  limit: bodyLimit,
  // O corpo bruto so e necessario para validar a assinatura do webhook da Meta.
  verify: (req, _res, buf) => {
    const requestPath = String(req.originalUrl || '').split('?')[0];
    if (requestPath === '/api/disparador/webhooks/meta/whatsapp') req.rawBody = buf;
  },
}));
app.use(express.urlencoded({ extended: true, limit: bodyLimit }));

// ── Garantir charset UTF-8 em todas as respostas JSON ──
app.use((_req, res, next) => {
  const send = res.json.bind(res);
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return send(body);
  };
  next();
});

// ══════════════════════════════════════════
//  RATE LIMITING
// ══════════════════════════════════════════
function shouldSkipRateLimit() {
  if (process.env.DISABLE_RATE_LIMIT === '1') return true;
  if (!isProd) return true;
  return false;
}

const adminLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
  standardHeaders: true, legacyHeaders: false,
  skip: () => shouldSkipRateLimit(),
});

const portalLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: Math.max(10, Number.parseInt(process.env.PORTAL_LOGIN_RATE_MAX || '60', 10) || 60),
  message: { error: 'Muitas tentativas de acesso. Tente novamente em 15 minutos.' },
  standardHeaders: true, legacyHeaders: false,
  skip: () => shouldSkipRateLimit(),
});

const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  message: { error: 'Muitas requisições. Tente novamente mais tarde.' },
  standardHeaders: true, legacyHeaders: false,
  skip: () => shouldSkipRateLimit(),
});

app.use('/api/admin/login', adminLoginLimiter);
app.use('/api/session/driver', portalLoginLimiter);
app.use('/api/session/graphic', portalLoginLimiter);
app.use('/api', apiLimiter);

// ══════════════════════════════════════════
//  INICIALIZAR SERVIÇOS DO GERADOR
// ══════════════════════════════════════════
let store;
if (process.env.MONGO_URI) {
  store = new MongoDataStore(() => mongoClient.getDb());
  console.log('[Startup] DataStore → MongoDB (app_settings)');
} else {
  const dataFile = path.join(__dirname, 'data', 'app-data.json');
  store = new DataStore(dataFile, {});
  console.log('[Startup] DataStore → arquivo local (app-data.json)');
}
await store.ensureReady();

const googleAuthService = new GoogleAuthService(store);
configureAgentEvidenceDrive({ googleAuthService });

// Conectar MongoDB no startup
console.log('[Startup] Inicializando MongoDB...');
try {
  await mongoClient.getDb();
  console.log('[Startup] ✅ MongoDB pronto');

  // Ativar persistência de sessões via MongoDB
  configureMongoSessions(() => mongoClient.getDb());
  console.log('[Startup] ✅ Sessões persistidas no MongoDB');

  // Criar índices das coleções de sync
  try {
    const { ensureSyncIndexes } = await import('./services/oddrive-sync.js');
    await ensureSyncIndexes();
  } catch (err) {
    console.warn('[Startup] ⚠️  Falha ao criar índices de sync:', err.message);
  }

  // Restaurar fila de automação do disparador (jobs pendentes persistidos)
  try {
    const { restoreAutomationQueue } = await import('./disparador/services/flow-automation.service.js');
    await restoreAutomationQueue();
  } catch (err) {
    console.warn('[Startup] ⚠️  Falha ao restaurar fila de automação:', err.message);
  }

  // Garantir índice da config de runtime do disparador
  try {
    const { ensureRuntimeConfigIndexes } = await import('./disparador/store/runtime-config.repo.js');
    await ensureRuntimeConfigIndexes();
  } catch (err) {
    console.warn('[Startup] ⚠️  Falha ao criar índice de runtime config:', err.message);
  }

  try {
    const { ensureTemplateFlowIndexes } = await import('./disparador/services/mongo/template-flows.repo.js');
    await ensureTemplateFlowIndexes();
  } catch (err) {
    console.warn('[Startup] ⚠️  Falha ao criar índices do OD Flow Studio:', err.message);
  }

  try {
    const { ensureTemplateFlowRunIndexes } = await import('./disparador/services/mongo/template-flow-runs.repo.js');
    await ensureTemplateFlowRunIndexes();
  } catch (err) {
    console.warn('[Startup] ⚠️  Falha ao criar índices de runs do OD Flow Studio:', err.message);
  }

  try {
    const { ensureDriverOutreachIndexes } = await import('./services/driver-outreach.js');
    await ensureDriverOutreachIndexes();
  } catch (err) {
    console.warn('[Startup] ⚠️  Falha ao criar índices de outreach de motoristas:', err.message);
  }

  // META ADS cria apenas indices; a sincronizacao ocorre sob demanda.
  try {
    const { ensureMetaAdsIndexes } = await import('./services/meta-ads.js');
    await ensureMetaAdsIndexes();
  } catch (err) {
    console.warn('[Startup] Falha ao criar indices do META ADS:', err.message);
  }

  try {
    const { ensureGptMakerCrmIndexes } = await import('./services/gpt-maker-crm.js');
    await ensureGptMakerCrmIndexes();
  } catch (err) {
    console.warn('[Startup] Falha ao criar indices do CRM GPT Maker:', err.message);
  }

  try {
    const { ensureAgentEvidenceIndexes } = await import('./services/agent-evidence.js');
    await ensureAgentEvidenceIndexes();
  } catch (err) {
    console.warn('[Startup] Falha ao criar indices das evidencias do agente:', err.message);
  }

  // Indices e scheduler de leads de parceiros.
  try {
    const { ensureLeadsIndexes, startLeadsScheduler } = await import('./services/partner-leads-sync.js');
    await ensureLeadsIndexes();
    startLeadsScheduler();
    console.log('[Startup] ✅ Partner leads scheduler iniciado');
  } catch (err) {
    console.warn('[Startup] ⚠️  Falha ao iniciar partner leads scheduler:', err.message);
  }

  try {
    const { startMirrorScheduler } = await import('./services/oddrive-mirror.js');
    startMirrorScheduler();
  } catch (err) {
    console.warn('[Startup] ⚠️  Falha ao iniciar mirror OdDrive:', err.message);
  }
} catch (error) {
  console.error('[Startup] ⚠️  MongoDB indisponível:', error.message);
}

// ══════════════════════════════════════════
//  MONTAR ROTAS DA API
// ══════════════════════════════════════════

// ── Gerenciador de Campanhas ──
app.use('/api/campaigns',      campaignsRouter);
app.use('/api/imports',        importsRouter);
app.use('/api/config',         configRouter);
app.use('/api/session',        sessionRouter);
app.use('/api/storage',        storageRouter);
app.use('/api/admin/users',    adminUsersRouter);
app.use('/api/admin',          adminAuthRouter);
app.use('/api/drivers',        driversRouter);
app.use('/api/notifications',  notificationsRouter);
app.use('/api/user-widgets',   userWidgetsRouter);
app.use('/api/scheduling',     schedulingRouter);
app.use('/api/meta/templates', metaTemplatesRouter);
app.use('/api/overview',       overviewActionsRouter);
app.use('/api/partner-leads',  partnerLeadsRouter);
app.use('/api/driver-scores',  driverScoreRouter);
app.use('/api/crm',            crmRouter);
app.use('/api/suppliers',      suppliersRouter);
app.use('/api/meta-ads',       metaAdsRouter);

// ── MCP (Model Context Protocol) — agente externo (GPT Maker) ──
app.use('/api/mcp',            mcpRouter);

// ── Agent webhooks — intenções GPT Maker via REST ──
app.use('/api/agent',          agentWebhooksRouter);

// ── Gerador de Orçamentos ──
app.use('/api/proposals',       buildProposalsRouter());
app.use('/api/settings',        buildSettingsRouter(store));
app.use('/api/slides',          buildSlidesRouter(store, googleAuthService));
app.use('/api/representatives', buildRepresentativesRouter(store));

// ── Disparador (Atendimento WhatsApp) ──
app.use('/api/disparador', disparadorRouter);

// ══════════════════════════════════════════
//  HEALTH CHECK
// ══════════════════════════════════════════
app.get('/health', async (_req, res) => {
  if (isProd) {
    return res.json({
      status: 'ok',
      service: 'oddrive-backend',
      timestamp: new Date().toISOString(),
    });
  }

  const health = {
    status: 'ok',
    service: 'oddrive-backend',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    mongodb: 'unknown',
    oddrive_api: 'unknown',
  };
  try {
    await mongoClient.getDb();
    health.mongodb = 'connected';
  } catch (error) {
    health.mongodb = 'disconnected';
    health.mongoError = error.message;
  }
  // OdDrive API — sync feito externamente, checar dados no MongoDB
  try {
    const { getSyncStatus } = await import('./services/db.js');
    const ss = await getSyncStatus();
    health.oddrive_api = (ss.campaigns > 0 || ss.drivers > 0) ? 'ok (mongo)' : 'no-data';
    health.oddrive_sync = {
      campaigns: ss.campaigns || 0,
      drivers: ss.drivers || 0,
      lastSync: ss.lastSync || null,
    };
  } catch (_) {
    health.oddrive_api = 'error';
  }
  res.json(health);
});

// ══════════════════════════════════════════
//  PÁGINAS PÚBLICAS
// ══════════════════════════════════════════
app.get('/privacidade', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.resolve(__dirname, '../../frontend/privacidade.html'));
});

app.get('/exclusao-dados', (_req, res) => {
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Exclusão de Dados — OD Drive</title>
  <style>
    body { font-family: Arial, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 24px; color: #333; line-height: 1.7; }
    h1 { color: #1a1a1a; border-bottom: 2px solid #eee; padding-bottom: 12px; }
    p { margin: 12px 0; }
    a { color: #0066cc; }
  </style>
</head>
<body>
  <h1>Solicitação de Exclusão de Dados</h1>
  <p><strong>OD Drive — Plataforma de Gestão de Campanhas</strong></p>
  <p>Para solicitar a exclusão dos seus dados pessoais da plataforma OD Drive, envie um e-mail para:</p>
  <p><a href="mailto:filipe_mm@hotmail.com">filipe_mm@hotmail.com</a></p>
  <p>Inclua no e-mail:</p>
  <ul>
    <li>Seu nome completo</li>
    <li>Seu número de telefone cadastrado</li>
    <li>Solicitação de exclusão dos seus dados</li>
  </ul>
  <p>A solicitação será processada em até <strong>15 dias úteis</strong>.</p>
</body>
</html>`);
});

// ══════════════════════════════════════════
//  ROOT / CATCH-ALL
// ══════════════════════════════════════════
app.get('/', (_req, res) => {
  res.json({
    service: 'OD Drive Backend',
    status: 'running',
    docs: 'Este servidor serve apenas APIs. O frontend está hospedado separadamente.',
    health: '/health',
  });
});

// ── Global error handler — sanitize internal errors before sending to client ──
app.use((err, req, res, _next) => {
  console.error('[ERROR]', err);
  // Ensure CORS headers are present even on error responses.
  // The cors() middleware may have already set them, but if the error
  // occurred before cors() ran (e.g. body-parser error) they might be missing.
  const origin = req.headers.origin;
  if (origin && isAllowedOrigin(origin, req) && !res.headersSent) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
  }
  const status = err.status || err.statusCode || 500;
  const safeMessage = status >= 500 && err?.expose !== true
    ? 'Erro interno do servidor.'
    : (err.message || 'Erro na requisição.');
  if (!res.headersSent) {
    res.status(status).json({ error: safeMessage });
  }
});

// ══════════════════════════════════════════
//  INICIAR SERVIDOR
// ══════════════════════════════════════════
function readFileIfExists(filePath) {
  try {
    if (!filePath) return null;
    return fs.readFileSync(path.resolve(process.cwd(), filePath));
  } catch { return null; }
}

function getHttpsOptions() {
  const pfxPath = process.env.LOCAL_SSL_PFX;
  if (pfxPath) {
    const pfx = readFileIfExists(pfxPath);
    if (!pfx) return null;
    return { pfx, passphrase: process.env.LOCAL_SSL_PFX_PASSPHRASE || undefined };
  }
  const keyPath = process.env.LOCAL_SSL_KEY;
  const certPath = process.env.LOCAL_SSL_CERT;
  if (keyPath && certPath) {
    const key = readFileIfExists(keyPath);
    const cert = readFileIfExists(certPath);
    if (!key || !cert) return null;
    return { key, cert };
  }
  return null;
}

const wantHttps = process.env.LOCAL_HTTPS === '1';
const httpsOpts = wantHttps ? getHttpsOptions() : null;
const server = httpsOpts ? https.createServer(httpsOpts, app) : http.createServer(app);
const scheme = httpsOpts ? 'https' : 'http';

server.listen(PORT, HOST, () => {
  console.log('========================================');
  console.log('🚀 OD Drive – Backend Unificado');
  console.log(`📍 Servidor: ${scheme}://${HOST}:${PORT}`);
  console.log(`✅ Health:   ${scheme}://${HOST}:${PORT}/health`);
  console.log(`🌐 Ambiente: ${isProd ? 'PRODUÇÃO' : 'DESENVOLVIMENTO'}`);
  console.log('========================================');

  // Startup: API sync é feito por script externo — nenhuma chamada API no startup
  console.log('[Startup] Inicializando MongoDB...');
  (async () => {
    try {
      const { ensureDatabaseSchema } = await import('./services/db.js');
      const out = await ensureDatabaseSchema();
      console.log(out?.created ? '[DB] ✅ Schema criado.' : '[DB] ✅ Schema OK.');
    } catch (e) {
      console.warn('[DB] ⚠️  Schema:', e?.message || e);
    }
    console.log('[Startup] ✅ MongoDB pronto');
  })();

  // Print network info
  try {
    const nets = os.networkInterfaces();
    const addrs = Object.values(nets).flat().filter(Boolean)
      .filter(n => (n.family === 'IPv4' || n.family === 4) && !n.internal)
      .map(n => n.address);
    if (addrs.length) {
      console.log('🌍 Endereços de rede:');
      addrs.forEach(ip => console.log(`   ${scheme}://${ip}:${PORT}`));
    }
  } catch (_) {}

  (async () => {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 5000);
      const resp = await fetch('https://api.ipify.org?format=text', { signal: ctrl.signal });
      clearTimeout(t);
      const ip = (await resp.text()).trim();
      console.log(`[egress] IP de saida: ${ip}`);
    } catch (e) {
      console.log('[egress] IP de saida indisponivel: ' + (e?.message || e));
    }
  })();
});
