import { Router } from 'express';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';
import {
  getReceivedEvidenceByDriveFileId,
  getStorageFileMetadata,
  openStorageFileStream,
} from '../services/mongo.js';
import { openAgentEvidenceDriveStream } from '../services/agent-evidence-drive.js';

const router = Router();

router.get('/drive/:id', authenticateAdmin, async (req, res) => {
  try {
    const evidence = await getReceivedEvidenceByDriveFileId(req.params.id);
    if (!evidence) {
      return res.status(404).json({ error: 'Arquivo não encontrado' });
    }
    const file = await openAgentEvidenceDriveStream(req.params.id);
    res.set('Content-Type', file.mimeType || 'application/octet-stream');
    if (file.size) res.set('Content-Length', String(file.size));
    res.set('Cache-Control', 'private, no-store, max-age=0');
    res.set('Content-Disposition', 'inline');

    file.stream.on('error', error => {
      console.error('[storage:drive] erro ao ler arquivo', error?.message || error);
      if (!res.headersSent) {
        res.status(502).json({ error: 'Falha ao ler arquivo' });
      } else {
        res.end();
      }
    });
    file.stream.pipe(res);
  } catch (error) {
    const status = Number(error?.status || error?.response?.status || 500);
    if (status === 404) return res.status(404).json({ error: 'Arquivo não encontrado' });
    console.warn('[storage:drive] stream error', error?.message || error);
    return res.status(status >= 400 && status < 600 ? status : 500)
      .json({ error: 'Arquivo inválido ou indisponível' });
  }
});

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
