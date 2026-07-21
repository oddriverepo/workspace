import { Router } from 'express';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';
import { validateSpreadsheetId } from '../middleware/validators.js';
import { getSpreadsheetMeta } from '../services/sheets.js';
import { ensureLegacyStoreReady, loadLegacyDb, saveLegacyDb } from '../services/legacyStore.js';

await ensureLegacyStoreReady();

function loadDB() {
  const db = loadLegacyDb();
  db.settings = db.settings || {};
  return db;
}

function saveDB(db) {
  if (!db.settings) db.settings = {};
  saveLegacyDb(db);
}

const router = Router();

// Retorna configuracoes globais
router.get('/', authenticateAdmin, (req, res) => {
  const db = loadDB();
  const settings = db.settings || {};
  res.json({
    masterSheetId: settings.masterSheetId || null,
    updatedAt: settings.updatedAt || null,
  });
});

// Define o ID da planilha mestre (Banco de Dados)
router.post('/master-sheet', authenticateAdmin, validateSpreadsheetId, async (req, res) => {
  const { spreadsheetId } = req.body || {};
  if (!spreadsheetId || typeof spreadsheetId !== 'string' || !spreadsheetId.trim()) {
    return res.status(400).json({ error: 'spreadsheetId obrigatorio' });
  }
  const id = spreadsheetId.trim();
  try {
    // Validate access to the spreadsheet (permissions/exists)
    const meta = await getSpreadsheetMeta(id);
    if (!meta || !meta.spreadsheetId) {
      return res.status(400).json({ error: 'Planilha nao encontrada ou inacessivel' });
    }
    const db = loadDB();
    db.settings = db.settings || {};
    db.settings.masterSheetId = id;
    db.settings.updatedAt = Date.now();
    saveDB(db);
    res.json({ ok: true, masterSheetId: id, title: meta.properties?.title || null });
  } catch (err) {
    const remoteMessage = err?.response?.data?.error?.message || err?.message || String(err);
    const reason = err?.response?.data?.error?.errors?.[0]?.reason;
    const hint = reason === 'failedPrecondition'
      ? 'O ID informado nao e uma planilha Google (Sheets) ou a conta de servico nao tem acesso.'
      : 'Verifique o ID e compartilhe a planilha com GOOGLE_CLIENT_EMAIL.';
    res.status(400).json({ error: 'Nao foi possivel validar a planilha mestre.', detail: remoteMessage, hint });
  }
});

export default router;
