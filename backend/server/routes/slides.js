/**
 * Rotas de Slides / Google OAuth (Gerador de Orçamentos)
 * Convertido de CJS para ESM
 */
import { Router } from 'express';
import { createRequire } from 'module';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';

// generator.js usa require() internamente, então importamos via createRequire
const require = createRequire(import.meta.url);
const GoogleSlidesGenerator = require('../lib/google/generator.cjs');

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function toPublicTokenInfo(info) {
  if (!info) return null;
  return {
    connected: Boolean(info.refreshToken || info.accessToken),
    scope: info.scope || '',
    expiresAt: info.expiresAt || null,
    connectedAt: info.connectedAt || null,
  };
}

export function buildSlidesRouter(store, googleAuthService) {
  const router = Router();

  router.post('/generate', authenticateAdmin, async (req, res) => {
    try {
      const { proposalData, options } = req.body || {};
      if (!proposalData) {
        return res.status(400).json({ success: false, error: 'Dados da proposta não enviados.' });
      }

      const accessToken = await googleAuthService.getValidAccessToken();
      if (!accessToken) {
        return res.status(401).json({ success: false, error: 'Conecte-se ao Google antes de gerar a apresentação.' });
      }

      const configOverrides = (await store.get('googleConfig')) || {};
      const tokenRefresher = async () => {
        const payload = await googleAuthService.refreshToken();
        return payload.access_token;
      };
      const generator = new GoogleSlidesGenerator(accessToken, configOverrides, { tokenRefresher });
      const progressTrail = [];
      const result = await generator.generateProposal(
        proposalData,
        (progress, message) => {
          progressTrail.push({ progress, message });
        },
        options || {}
      );

      res.json({ success: true, ...result, progress: progressTrail });
    } catch (error) {
      console.error('[Slides] Falha na geração:', error?.message || error, error?.stack);
      res.status(500).json({
        success: false,
        error: 'Erro interno ao gerar proposta.',
      });
    }
  });

  router.post('/export-pdf', authenticateAdmin, async (req, res) => {
    try {
      const { presentationId, proposalId } = req.body || {};
      if (!presentationId) {
        return res.status(400).json({ success: false, error: 'presentationId obrigatório.' });
      }

      const accessToken = await googleAuthService.getValidAccessToken();
      if (!accessToken) {
        return res.status(401).json({ success: false, error: 'Conecte-se ao Google antes de exportar o PDF.' });
      }

      const configOverrides = (await store.get('googleConfig')) || {};
      const tokenRefresher = async () => {
        const payload = await googleAuthService.refreshToken();
        return payload.access_token;
      };
      const generator = new GoogleSlidesGenerator(accessToken, configOverrides, { tokenRefresher });
      const buffer = await generator.client.exportPresentationPdf(presentationId);
      const fileName = `proposta-${proposalId || Date.now()}.pdf`;

      res.json({
        success: true,
        base64: Buffer.from(buffer).toString('base64'),
        fileName,
      });
    } catch (error) {
      console.error('[Slides] Falha ao exportar PDF:', error);
      res.status(500).json({ success: false, error: error.message || 'Erro interno ao exportar PDF.' });
    }
  });

  router.post('/oauth/start', authenticateAdmin, async (_req, res) => {
    try {
      const session = await googleAuthService.startSession();
      res.json({ success: true, ...session });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  });

  async function handleOAuthCallback(req, res) {
    console.log('[OAuth Callback] Recebendo callback do Google');
    try {
      const timeoutPromise = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Timeout na autorização')), 25000)
      );
      await Promise.race([googleAuthService.handleCallback(req.query), timeoutPromise]);
      console.log('[OAuth Callback] ✅ Autorização concluída');

      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>OK</title>
        <style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:linear-gradient(135deg,#667eea,#764ba2);color:#fff}.c{text-align:center;padding:40px;background:rgba(255,255,255,.1);border-radius:20px}</style>
        </head><body><div class="c"><div style="font-size:64px">✅</div><h1>Autorização Concluída!</h1><p>Esta janela será fechada...</p></div>
        <script>setTimeout(()=>{window.close();setTimeout(()=>window.location.href='/',1e3)},2e3)</script></body></html>`);
    } catch (error) {
      console.error('[OAuth Callback] ❌ Erro:', error.message);
      const safeMessage = escapeHtml(error.message || 'Falha na autorizacao.');
      res.status(400).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Erro</title>
        <style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:linear-gradient(135deg,#f093fb,#f5576c);color:#fff}.c{text-align:center;padding:40px;background:rgba(255,255,255,.1);border-radius:20px;max-width:500px}</style>
        </head><body><div class="c"><div style="font-size:64px">❌</div><h1>Erro na Autorização</h1><p>${safeMessage}</p></div>
        <script>setTimeout(()=>{window.close();setTimeout(()=>window.location.href='/',1e3)},5e3)</script></body></html>`);
    }
  }

  router.get('/oauth/callback', handleOAuthCallback);
  router.get('/google/callback', handleOAuthCallback);

  router.get('/token-info', authenticateAdmin, async (_req, res) => {
    const info = await googleAuthService.getTokenInfo();
    res.json(toPublicTokenInfo(info));
  });

  router.post('/disconnect', authenticateAdmin, async (_req, res) => {
    await googleAuthService.disconnect();
    res.json({ success: true });
  });

  router.post('/refresh', authenticateAdmin, async (_req, res) => {
    try {
      await googleAuthService.refreshToken();
      const info = await googleAuthService.getTokenInfo();
      res.json({ success: true, token: toPublicTokenInfo(info) });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  });

  return router;
}
