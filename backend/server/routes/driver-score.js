/**
 * driver-score.js — Rotas para o sistema de pontuação de motoristas
 *
 * Coleção: driver_scores
 *   { _id: phone, score: { final, count, override, overrideReason, campaigns: [...] }, updatedAt }
 *
 * Route prefix: /api/driver-scores  (mounted in index.js)
 */

import { Router } from 'express';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';
import { getDriverScore, upsertDriverScore } from '../services/mongo.js';
import { computeScore } from '../services/scoreService.js';

const router = Router();
router.use(authenticateAdmin);

/**
 * GET /api/driver-scores/:phone
 * Calcula e retorna a pontuação do motorista com os dados atuais do MongoDB.
 * Sempre computado na hora — sem cache — para refletir o estado real ao abrir o modal.
 */
router.get('/:phone', async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
    if (!phone) return res.status(400).json({ error: 'Telefone inválido' });

    const { score, campaignScores } = await computeScore(phone);
    if (!score || score.count === 0) {
      return res.status(404).json({ error: 'Dados insuficientes para calcular pontuação', score: null });
    }

    // Buscar override manual persistido, se existir
    const persisted = await getDriverScore(phone).catch(() => null);
    const override = persisted?.score?.override ?? null;
    const overrideReason = persisted?.score?.overrideReason ?? null;

    res.json({ phone, score: { ...score, override, overrideReason } });
  } catch (err) {
    console.error('[driver-scores] GET /:phone', err?.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

/**
 * POST /api/driver-scores/:phone/recalculate
 * Alias do GET — recalcula e opcionalmente persiste para histórico.
 */
router.post('/:phone/recalculate', async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
    if (!phone) return res.status(400).json({ error: 'Telefone inválido' });

    const { score } = await computeScore(phone);
    if (!score || score.count === 0) {
      return res.status(404).json({ error: 'Nenhum dado encontrado para esse motorista' });
    }

    // Preservar override manual existente
    const existing = await getDriverScore(phone).catch(() => null);
    const override = existing?.score?.override ?? null;
    const overrideReason = existing?.score?.overrideReason ?? null;

    await upsertDriverScore(phone, { score: { ...score, override, overrideReason }, updatedAt: new Date() });
    res.json({ phone, score: { ...score, override, overrideReason } });
  } catch (err) {
    console.error('[driver-scores] POST /:phone/recalculate', err?.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

/**
 * PATCH /api/driver-scores/:phone/override
 * Define uma pontuação manual para o motorista.
 * Body: { value: number (0-5), reason: string }
 */
router.patch('/:phone/override', async (req, res) => {
  try {
    const phone = decodeURIComponent(req.params.phone).replace(/\D/g, '');
    if (!phone) return res.status(400).json({ error: 'Telefone inválido' });

    const { value, reason } = req.body || {};
    if (value !== null && value !== undefined) {
      const v = Number(value);
      if (!Number.isFinite(v) || v < 0 || v > 5) {
        return res.status(400).json({ error: 'value deve ser entre 0 e 5' });
      }
    }

    const existing = await getDriverScore(phone);
    const currentScore = existing?.score || {};

    await upsertDriverScore(phone, {
      score: {
        ...currentScore,
        override: value !== null && value !== undefined ? Math.round(Number(value) * 10) / 10 : null,
        overrideReason: reason || null,
      },
    });

    res.json({ phone, override: value });
  } catch (err) {
    console.error('[driver-scores] PATCH /:phone/override', err?.message);
    res.status(500).json({ error: 'Erro interno' });
  }
});

export default router;
