import { Router } from 'express';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';
import { getStorageFileMetadata, openStorageFileStream } from '../services/mongo.js';

const router = Router();

router.get('/:id', authenticateAdmin, async (req, res) => {
  try {
    const file = await getStorageFileMetadata(req.params.id);
    if (!file) {
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }

    const stream = await openStorageFileStream(req.params.id);
    res.set('Content-Type', file.mimeType || 'application/octet-stream');
    res.set('Cache-Control', 'private, no-store, max-age=0');

    stream.on('error', err => {
      console.error('[storage] erro ao ler arquivo', err?.message || err);
      if (!res.headersSent) {
        res.status(500).json({ error: 'Falha ao ler arquivo' });
      } else {
        res.end();
      }
    });

    stream.pipe(res);
  } catch (err) {
    console.warn('[storage] stream error', err?.message || err);
    res.status(400).json({ error: 'Arquivo inválido ou indisponível' });
  }
});

export default router;
