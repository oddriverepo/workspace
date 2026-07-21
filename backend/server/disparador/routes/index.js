import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticateAdmin } from "../../middleware/authenticate-admin.js";
import { metaWebhookRouter } from "./meta-webhook.route.js";
import { metaOnboardingRouter } from "./meta-onboarding.route.js";
import { contactsRouter } from "./contacts.route.js";
import { listsRouter } from "./lists.route.js";
import { templatesRouter } from "./templates.route.js";
import { campaignsRouter } from "./campaigns.route.js";
import { flowsRouter } from "./flows.route.js";
import { flowRunsRouter } from "./flow-runs.route.js";
import { inboxRouter } from "./inbox.route.js";
import { aiRouter } from "./ai.route.js";
import { templateFlowsRouter } from "./template-flows.route.js";
import { mediaRouter, publicMediaRouter } from "./media.route.js";

const router = Router();

// ── Rate limiters dedicados (apenas em produção) ──
const isProd = process.env.NODE_ENV === "production";
const skipLimiter = () => process.env.DISABLE_RATE_LIMIT === "1" || !isProd;

// Meta envia bursts de webhooks (status updates, mensagens). Limite generoso por IP.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipLimiter,
  message: { error: "Webhook rate limit exceeded" },
});

// /media/:id é público (Meta puxa imagens). Protege contra scraping/DoS.
const publicMediaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipLimiter,
  message: { error: "Muitas requisicoes de media." },
});

// Rotas de IA chamam APIs externas pagas (Claude). Limite agressivo por IP.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: skipLimiter,
  message: { error: "Muitas requisicoes ao agente de IA. Tente em instantes." },
});

router.get("/health", (req, res) => {
  res.json({ ok: true, module: "disparador", ts: new Date().toISOString() });
});

// Webhook routes — Meta calls these directly, auth via HMAC signature
router.use(webhookLimiter, metaWebhookRouter);

// Public media serving — Meta WhatsApp API needs unauthenticated access to fetch images
router.use(publicMediaLimiter, publicMediaRouter);

// All other routes require admin authentication
router.use(authenticateAdmin);
router.use(metaOnboardingRouter);
router.use(contactsRouter);
router.use(listsRouter);
router.use(templatesRouter);
router.use(campaignsRouter);
router.use(flowsRouter);
router.use(flowRunsRouter);
router.use(inboxRouter);
router.use(aiLimiter, aiRouter);
router.use(templateFlowsRouter);
router.use(mediaRouter);

export { router as disparadorRouter };
