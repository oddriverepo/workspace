import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';
import {
  getMetaAdsDashboard,
  getMetaAdsStatus,
  MetaAdsError,
} from '../services/meta-ads.js';

const router = Router();

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { ok: false, error: 'Muitas consultas ao META ADS. Aguarde alguns segundos.' },
});

router.use(authenticateAdmin);
router.use(readLimiter);

function sendError(res, error) {
  if (error instanceof MetaAdsError) {
    return res.status(error.status).json({
      ok: false,
      error: error.message,
      code: error.code,
    });
  }
  console.error('[meta-ads] Unexpected error:', error);
  return res.status(500).json({
    ok: false,
    error: 'Erro interno ao processar os dados do META ADS.',
    code: 'META_ADS_INTERNAL_ERROR',
  });
}

router.get('/status', (_req, res) => {
  return res.json({ ok: true, ...getMetaAdsStatus() });
});

router.get('/dashboard', async (req, res) => {
  try {
    const forceRefresh = String(req.query.refresh || '') === '1';
    const dashboard = await getMetaAdsDashboard({
      accountId: req.query.accountId,
      from: req.query.from,
      to: req.query.to,
      force: forceRefresh,
    });
    res.set('Cache-Control', forceRefresh ? 'no-store' : 'private, max-age=30');
    return res.json(dashboard);
  } catch (error) {
    return sendError(res, error);
  }
});

export default router;
