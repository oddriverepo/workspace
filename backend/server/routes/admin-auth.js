import { Router } from 'express';
import bcrypt from 'bcrypt';
import { nanoid } from 'nanoid';
import { findAdminUserByUsername, listAuditLogs, clearAllAuditLogs } from '../services/db.js';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';
import { createAdminSession, deleteAdminSession } from '../services/sessionStore.js';
import { validateAdminCredentials } from '../middleware/validators.js';
import { logLoginSuccess, logLoginFailure, logLogout } from '../services/auditLogger.js';

const router = Router();

// POST /api/admin/login
router.post('/login', validateAdminCredentials, async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    await logLoginFailure(username, 'Missing credentials', req);
    return res.status(400).json({ error: 'Username e senha sao obrigatorios' });
  }

  try {
    const user = await findAdminUserByUsername(username);

    if (!user) {
      await logLoginFailure(username, 'User not found', req);
      return res.status(401).json({ error: 'Credenciais invalidas' });
    }

    if (!user.active) {
      await logLoginFailure(username, 'User inactive', req);
      return res.status(403).json({ error: 'Usuario desativado' });
    }

    const passwordMatch = await bcrypt.compare(password, user.passwordHash);

    if (!passwordMatch) {
      await logLoginFailure(username, 'Invalid password', req);
      return res.status(401).json({ error: 'Credenciais invalidas' });
    }

    // Cria sessão segura em memória
    const token = nanoid(48);
    const session = await createAdminSession(token, {
      userId: String(user._id),
      username: user.username,
      name: user.name,
      role: user.role || 'admin',
    });

    await logLoginSuccess(user.username, String(user._id), req);

    // Anti-cache: respostas com token nunca devem ser cacheadas por proxies/browsers.
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0');
    res.set('Pragma', 'no-cache');
    res.set('Expires', '0');

    res.json({
      token: session.token,
      role: 'admin',
      expiresAt: session.expiresAt,
      user: {
        id: String(user._id),
        username: user.username,
        name: user.name,
        role: user.role,
      },
    });
  } catch (err) {
    console.error('[admin-auth] Erro no login:', err);
    await logLoginFailure(username, `Error: ${err.message}`, req);
    res.status(500).json({ error: 'Erro interno no servidor' });
  }
});

// GET /api/admin/me
router.get('/me', authenticateAdmin, (req, res) => {
  res.json({
    user: {
      id: req.adminUser.id,
      username: req.adminUser.username,
      name: req.adminUser.name,
      role: req.adminUser.role,
    },
  });
});

// POST /api/admin/logout
router.post('/logout', authenticateAdmin, async (req, res) => {
  const token = req.adminUser.sessionToken;
  await logLogout(req.adminUser.username, req.adminUser.id);
  await deleteAdminSession(token);
  res.json({ ok: true });
});

// GET /api/admin/audit-logs
router.get('/audit-logs', authenticateAdmin, async (req, res) => {
  try {
    const { username, action, entityType, limit = 100, skip = 0 } = req.query;
    
    const filters = {};
    if (username) filters.username = username;
    if (action) filters.action = action;
    if (entityType) filters.entityType = entityType;
    
    const logs = await listAuditLogs(filters, {
      limit: parseInt(limit, 10) || 100,
      skip: parseInt(skip, 10) || 0,
    });

    res.json({ logs });
  } catch (err) {
    console.error('[admin-auth] Erro ao buscar logs:', err);
    res.status(500).json({ error: 'Erro ao buscar logs de auditoria' });
  }
});

// DELETE /api/admin/audit-logs - apaga TODOS os registros (reset)
router.delete('/audit-logs', authenticateAdmin, async (req, res) => {
  try {
    const result = await clearAllAuditLogs();
    // Registra um unico evento informando quem limpou (apos o wipe)
    try {
      const { insertAuditLog } = await import('../services/db.js');
      await insertAuditLog({
        userId: req.adminUser?.id || null,
        username: req.adminUser?.username || 'unknown',
        name: req.adminUser?.name || req.adminUser?.username || 'Unknown',
        action: 'audit:clear-all',
        entityType: 'audit',
        entityId: null,
        details: { deletedCount: result.deletedCount },
        ipAddress: req.ip || null,
        userAgent: req.headers['user-agent'] || null,
        timestamp: Date.now(),
        success: true,
      });
    } catch (logErr) {
      console.warn('[admin-auth] Falha ao registrar wipe:', logErr.message);
    }
    res.json({ ok: true, deletedCount: result.deletedCount });
  } catch (err) {
    console.error('[admin-auth] Erro ao limpar logs:', err);
    res.status(500).json({ error: 'Erro ao limpar logs de auditoria' });
  }
});

export default router;
