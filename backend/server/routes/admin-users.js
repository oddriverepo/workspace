import { Router } from 'express';
import bcrypt from 'bcrypt';
import {
  listAdminUsers,
  createAdminUser,
  updateAdminUser,
  findAdminUserById,
  findAdminUserByUsername,
  listAuditLogs,
} from '../services/db.js';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';
import { logAudit, AuditAction, EntityType } from '../services/auditLogger.js';
import { getDb } from '../services/mongo.js';

const router = Router();

router.use(authenticateAdmin);

function requireAdminRole(req, res, next) {
  if (req.adminUser?.role !== 'admin') {
    return res.status(403).json({ error: 'Apenas administradores podem gerenciar usuários.' });
  }
  next();
}

function publicUser(u) {
  if (!u) return null;
  return {
    id: String(u._id),
    username: u.username,
    name: u.name || u.username,
    email: u.email || null,
    role: u.role || 'admin',
    active: u.active !== false,
    createdAt: u.createdAt || null,
    updatedAt: u.updatedAt || null,
  };
}

// GET /api/admin/users
router.get('/', requireAdminRole, async (req, res) => {
  try {
    const users = await listAdminUsers();
    res.json({ items: users.map(publicUser) });
  } catch (err) {
    console.error('[admin-users] list error:', err);
    res.status(500).json({ error: 'Erro ao listar usuários.' });
  }
});

// POST /api/admin/users
router.post('/', requireAdminRole, async (req, res) => {
  const { username, password, name, email, role } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'username e password são obrigatórios.' });
  }
  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres.' });
  }
  try {
    const existing = await findAdminUserByUsername(username);
    if (existing) return res.status(409).json({ error: 'Usuário já existe.' });

    const passwordHash = await bcrypt.hash(String(password), 10);
    const created = await createAdminUser({
      username,
      passwordHash,
      name: name || username,
      email: email || null,
      role: role === 'viewer' ? 'viewer' : 'admin',
      active: true,
      createdBy: req.adminUser.username,
    });

    await logAudit({
      action: 'USER_CREATED',
      entityType: EntityType.ADMIN,
      entityId: String(created._id),
      username: req.adminUser.username,
      userId: req.adminUser.id,
      metadata: { targetUsername: created.username, role: created.role },
    });

    res.status(201).json({ item: publicUser(created) });
  } catch (err) {
    console.error('[admin-users] create error:', err);
    res.status(500).json({ error: 'Erro ao criar usuário.' });
  }
});

// PATCH /api/admin/users/:id
router.patch('/:id', requireAdminRole, async (req, res) => {
  const { name, email, role, active, password } = req.body || {};
  try {
    const user = await findAdminUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const updates = {};
    if (typeof name === 'string') updates.name = name;
    if (typeof email === 'string' || email === null) updates.email = email;
    if (role === 'admin' || role === 'viewer') updates.role = role;
    if (typeof active === 'boolean') updates.active = active;
    if (password) {
      if (String(password).length < 6) {
        return res.status(400).json({ error: 'Senha deve ter ao menos 6 caracteres.' });
      }
      updates.passwordHash = await bcrypt.hash(String(password), 10);
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'Nada para atualizar.' });
    }
    await updateAdminUser(req.params.id, updates);

    await logAudit({
      action: active === false ? 'USER_DEACTIVATED' : 'USER_UPDATED',
      entityType: EntityType.ADMIN,
      entityId: String(req.params.id),
      username: req.adminUser.username,
      userId: req.adminUser.id,
      metadata: {
        targetUsername: user.username,
        fieldsChanged: Object.keys(updates),
      },
    });

    const fresh = await findAdminUserById(req.params.id);
    res.json({ item: publicUser(fresh) });
  } catch (err) {
    console.error('[admin-users] update error:', err);
    res.status(500).json({ error: 'Erro ao atualizar usuário.' });
  }
});

// GET /api/admin/users/:id/activity
// Returns combined activity feed: audit logs + dispatch runs + conversations started
router.get('/:id/activity', requireAdminRole, async (req, res) => {
  try {
    const user = await findAdminUserById(req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

    const limit = Math.min(500, Math.max(10, Number(req.query.limit) || 100));
    const userId = String(user._id);

    const [logs, dispatches, conversations] = await Promise.all([
      listAuditLogs({ username: user.username }, { limit }).catch(() => []),
      (async () => {
        const db = await getDb();
        return db.collection('disparador_dispatch_runs')
          .find({ operatorId: userId })
          .sort({ triggeredAt: -1 })
          .limit(limit)
          .toArray();
      })().catch(() => []),
      (async () => {
        const db = await getDb();
        return db.collection('disparador_inbox_conversations')
          .find({ operatorId: userId })
          .sort({ updatedAt: -1 })
          .limit(limit)
          .toArray();
      })().catch(() => []),
    ]);

    const events = [];
    for (const log of logs) {
      events.push({
        type: 'audit',
        at: typeof log.timestamp === 'number' ? new Date(log.timestamp).toISOString() : String(log.timestamp || ''),
        action: log.action,
        success: log.success !== false,
        details: log.details || {},
      });
    }
    for (const d of dispatches) {
      events.push({
        type: 'dispatch',
        at: d.triggeredAt || (d._id ? null : null),
        title: d.sourceName || d.campaignName || d.source,
        templateName: d.templateName || '',
        totals: d.totals || {},
        status: d.status || '',
      });
    }
    for (const c of conversations) {
      events.push({
        type: 'conversation',
        at: c.createdAt || c.updatedAt || null,
        contactName: c.displayName || '',
        phoneE164: c.phoneE164 || '',
        conversationId: String(c._id || c.id || ''),
      });
    }
    events.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));

    res.json({
      user: publicUser(user),
      stats: {
        dispatches: dispatches.length,
        conversations: conversations.length,
        auditEntries: logs.length,
      },
      events: events.slice(0, limit),
    });
  } catch (err) {
    console.error('[admin-users] activity error:', err);
    res.status(500).json({ error: 'Erro ao carregar atividade.' });
  }
});

export default router;
