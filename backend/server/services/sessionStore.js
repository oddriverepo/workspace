/**
 * Armazenamento seguro de sessões em Redis com expiração automática.
 * Permite escalonamento horizontal e persistência entre reinícios.
 * Fallback: Redis → MongoDB → Memória
 */
import crypto from 'crypto';
import IORedis from 'ioredis';

const REDIS_URL = process.env.REDIS_URL || '';
// Enable Redis only when a REDIS_URL is provided and USE_REDIS is not explicitly 'false'
const USE_REDIS = !!REDIS_URL && process.env.USE_REDIS !== 'false';

let redis = null;

if (USE_REDIS) {
  try {
    redis = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        if (times > 3) {
          console.error('[sessionStore] Redis connection failed after 3 retries');
          return null; // stop retrying
        }
        return Math.min(times * 200, 2000); // exponential backoff
      },
    });
    redis.on('error', (err) => console.error('[sessionStore] Redis error:', err?.message || err));
    redis.on('connect', () => console.log('[sessionStore] Redis connected'));
  } catch (err) {
    console.error('[sessionStore] Failed to initialize Redis:', err?.message || err);
    redis = null;
  }
} else {
  console.log('[sessionStore] Redis disabled (no REDIS_URL or explicitly turned off)');
}

// ── MongoDB fallback para sessões ──────────────────────────
let _mongoGetDb = null;
let _mongoSessionsReady = false;

const ADMIN_SESSION_TTL_SEC = 24 * 60 * 60; // 24 horas
const USER_SESSION_TTL_SEC = 7 * 24 * 60 * 60; // 7 dias
const ADMIN_PREFIX = 'session:admin:';
const USER_PREFIX = 'session:user:';

function tokenHash(token) {
  return crypto.createHash('sha256').update(String(token || '')).digest('hex');
}

function storageKey(prefix, token) {
  return `${prefix}${tokenHash(token)}`;
}

function serializeSession(session) {
  const { token, ...safeSession } = session || {};
  return { ...safeSession, tokenHash: tokenHash(token) };
}

function restoreSession(stored, token) {
  if (!stored) return null;
  const { _id, token: _storedToken, tokenHash: _storedHash, ...rest } = stored;
  const expiresAt = rest.expiresAt instanceof Date ? rest.expiresAt.getTime() : rest.expiresAt;
  return { ...rest, token, expiresAt };
}

function publicSession(session = {}) {
  const { _id, token, tokenHash: _tokenHash, ...rest } = session;
  return rest;
}

/**
 * Configura MongoDB como camada de persistência de sessões.
 * Chamado pelo index.js após conectar ao Mongo.
 */
export function configureMongoSessions(getDbFn) {
  _mongoGetDb = getDbFn;
}

async function _mongoCol(prefix) {
  if (!_mongoGetDb) return null;
  try {
    const db = await _mongoGetDb();
    const colName = prefix === ADMIN_PREFIX ? 'admin_sessions' : 'user_sessions';
    const col = db.collection(colName);
    if (!_mongoSessionsReady) {
      _mongoSessionsReady = true;
      col.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
      db.collection(prefix === ADMIN_PREFIX ? 'user_sessions' : 'admin_sessions')
        .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }).catch(() => {});
    }
    return col;
  } catch {
    return null;
  }
}

// Fallback in-memory storage (usado se Redis não estiver disponível)
const memoryAdminSessions = new Map();
const memoryUserSessions = new Map();

/**
 * Cria uma nova sessão de administrador
 */
export async function createAdminSession(token, userData) {
  const now = Date.now();
  const session = {
    token,
    userId: userData.userId || userData.id,
    username: userData.username,
    name: userData.name,
    role: userData.role || 'admin',
    createdAt: now,
    lastAccessAt: now,
    expiresAt: now + ADMIN_SESSION_TTL_SEC * 1000,
  };
  
  if (redis) {
    try {
      const key = storageKey(ADMIN_PREFIX, token);
      await redis.set(key, JSON.stringify(serializeSession(session)), 'EX', ADMIN_SESSION_TTL_SEC);
    } catch (err) {
      console.error('[sessionStore] Redis error on createAdminSession:', err.message);
      memoryAdminSessions.set(token, session); // fallback
    }
  } else {
    memoryAdminSessions.set(token, session);
  }

  // Persistir no MongoDB (sobrevive a restarts)
  const col = await _mongoCol(ADMIN_PREFIX);
  if (col) {
    try {
      await col.updateOne(
        { _id: tokenHash(token) },
        { $set: { ...serializeSession(session), expiresAt: new Date(session.expiresAt) } },
        { upsert: true }
      );
    } catch (err) {
      console.warn('[sessionStore] MongoDB write error (admin create):', err.message);
    }
  }
  
  return session;
}

/**
 * Busca sessão de administrador
 */
export async function getAdminSession(token) {
  if (!token) return null;
  
  if (redis) {
    try {
      const key = storageKey(ADMIN_PREFIX, token);
      const raw = await redis.get(key);
      if (raw) {
        const session = restoreSession(JSON.parse(raw), token);
        if (session.expiresAt && session.expiresAt < Date.now()) {
          await redis.del(key);
        } else {
          session.lastAccessAt = Date.now();
          await redis.set(key, JSON.stringify(serializeSession(session)), 'EX', ADMIN_SESSION_TTL_SEC);
          return session;
        }
      }
      // Redis não tem — continua para memória + MongoDB
    } catch (err) {
      console.error('[sessionStore] Redis error on getAdminSession:', err.message);
    }
  }
  
  // Memory fallback
  const session = memoryAdminSessions.get(token);
  if (!session) {
    // MongoDB fallback (sobrevive a restarts)
    const col = await _mongoCol(ADMIN_PREFIX);
    if (col) {
      try {
        let doc = await col.findOne({ _id: tokenHash(token) });
        let legacyDoc = false;
        if (!doc) {
          doc = await col.findOne({ _id: token });
          legacyDoc = Boolean(doc);
        }
        if (doc && doc.expiresAt && new Date(doc.expiresAt).getTime() >= Date.now()) {
          const restored = restoreSession(doc, token);
          restored.lastAccessAt = Date.now();
          memoryAdminSessions.set(token, restored);
          await col.updateOne(
            { _id: tokenHash(token) },
            { $set: { ...serializeSession(restored), expiresAt: new Date(restored.expiresAt), lastAccessAt: restored.lastAccessAt } },
            { upsert: true },
          );
          if (legacyDoc) await col.deleteOne({ _id: token }).catch(() => {});
          return restored;
        }
      } catch (err) {
        console.warn('[sessionStore] MongoDB read error (admin get):', err.message);
      }
    }
    return null;
  }
  
  if (session.expiresAt && session.expiresAt < Date.now()) {
    memoryAdminSessions.delete(token);
    return null;
  }
  
  session.lastAccessAt = Date.now();
  return session;
}

/**
 * Remove sessão de administrador
 */
export async function deleteAdminSession(token) {
  if (!token) return false;
  
  // Limpar de todas as camadas
  const col = await _mongoCol(ADMIN_PREFIX);
  if (col) {
    col.deleteOne({ _id: tokenHash(token) }).catch(() => {});
    col.deleteOne({ _id: token }).catch(() => {});
  }

  if (redis) {
    try {
      const result = await redis.del(storageKey(ADMIN_PREFIX, token));
      memoryAdminSessions.delete(token);
      return result > 0;
    } catch (err) {
      console.error('[sessionStore] Redis error on deleteAdminSession:', err.message);
      return memoryAdminSessions.delete(token);
    }
  }
  
  return memoryAdminSessions.delete(token);
}

/**
 * Lista todas as sessões de administrador ativas
 */
export async function listAdminSessions() {
  if (redis) {
    try {
      const keys = await redis.keys(`${ADMIN_PREFIX}*`);
      const sessions = [];
      for (const key of keys) {
        const raw = await redis.get(key);
        if (raw) {
          const session = JSON.parse(raw);
          if (!session.expiresAt || session.expiresAt >= Date.now()) {
            sessions.push(publicSession(session));
          }
        }
      }
      return sessions;
    } catch (err) {
      console.error('[sessionStore] Redis error on listAdminSessions:', err.message);
      const now = Date.now();
      return Array.from(memoryAdminSessions.values()).filter(
        s => !s.expiresAt || s.expiresAt >= now
      ).map(publicSession);
    }
  }
  
  const now = Date.now();
  const memorySessions = Array.from(memoryAdminSessions.values()).filter(
    s => !s.expiresAt || s.expiresAt >= now
  ).map(publicSession);

  // Complementar com sessões do MongoDB que não estão na memória
  const col = await _mongoCol(ADMIN_PREFIX);
  if (col) {
    try {
      const docs = await col.find({ expiresAt: { $gte: new Date() } }).toArray();
      const memoryIds = new Set(memorySessions.map(s => `${s.userId || ''}:${s.createdAt || ''}`));
      for (const doc of docs) {
        const key = `${doc.userId || ''}:${doc.createdAt || ''}`;
        if (!memoryIds.has(key)) {
          const rest = publicSession(doc);
          rest.expiresAt = new Date(doc.expiresAt).getTime();
          memorySessions.push(rest);
        }
      }
    } catch (err) {
      console.warn('[sessionStore] MongoDB read error (admin list):', err.message);
    }
  }

  return memorySessions;
}

/**
 * Cria uma nova sessão de usuário (motorista/arte)
 */
export async function createUserSession(token, userData) {
  const now = Date.now();
  const session = {
    token,
    userId: userData.userId || userData.id,
    name: userData.name,
    type: userData.type, // 'driver' ou 'graphic'
    role: userData.type, // Compatibilidade com código legado
    driverId: userData.type === 'driver' ? userData.userId : null, // Compatibilidade
    campaignId: userData.campaignId,
    identity: userData.identity, // CPF, placa, etc
    meta: {
      graphicId: userData.type === 'graphic' ? userData.userId : null,
      graphicName: userData.type === 'graphic' ? userData.name : null,
      responsibleName: userData.type === 'graphic' ? (userData.responsibleName || userData.name) : null,
    },
    createdAt: now,
    lastAccessAt: now,
    expiresAt: now + USER_SESSION_TTL_SEC * 1000,
  };
  
  if (redis) {
    try {
      const key = storageKey(USER_PREFIX, token);
      await redis.set(key, JSON.stringify(serializeSession(session)), 'EX', USER_SESSION_TTL_SEC);
    } catch (err) {
      console.error('[sessionStore] Redis error on createUserSession:', err.message);
      memoryUserSessions.set(token, session);
    }
  } else {
    memoryUserSessions.set(token, session);
  }

  // Persistir no MongoDB (sobrevive a restarts)
  const col = await _mongoCol(USER_PREFIX);
  if (col) {
    try {
      await col.updateOne(
        { _id: tokenHash(token) },
        { $set: { ...serializeSession(session), expiresAt: new Date(session.expiresAt) } },
        { upsert: true }
      );
    } catch (err) {
      console.warn('[sessionStore] MongoDB write error (user create):', err.message);
    }
  }
  
  return session;
}

/**
 * Busca sessão de usuário
 */
export async function getUserSession(token) {
  if (!token) return null;
  
  if (redis) {
    try {
      const key = storageKey(USER_PREFIX, token);
      const raw = await redis.get(key);
      if (raw) {
        const session = restoreSession(JSON.parse(raw), token);
        if (session.expiresAt && session.expiresAt < Date.now()) {
          await redis.del(key);
        } else {
          session.lastAccessAt = Date.now();
          await redis.set(key, JSON.stringify(serializeSession(session)), 'EX', USER_SESSION_TTL_SEC);
          return session;
        }
      }
      // Redis não tem — continua para memória + MongoDB
    } catch (err) {
      console.error('[sessionStore] Redis error on getUserSession:', err.message);
    }
  }
  
  const session = memoryUserSessions.get(token);
  if (!session) {
    // MongoDB fallback (sobrevive a restarts)
    const col = await _mongoCol(USER_PREFIX);
    if (col) {
      try {
        let doc = await col.findOne({ _id: tokenHash(token) });
        let legacyDoc = false;
        if (!doc) {
          doc = await col.findOne({ _id: token });
          legacyDoc = Boolean(doc);
        }
        if (doc && doc.expiresAt && new Date(doc.expiresAt).getTime() >= Date.now()) {
          const restored = restoreSession(doc, token);
          restored.lastAccessAt = Date.now();
          memoryUserSessions.set(token, restored);
          await col.updateOne(
            { _id: tokenHash(token) },
            { $set: { ...serializeSession(restored), expiresAt: new Date(restored.expiresAt), lastAccessAt: restored.lastAccessAt } },
            { upsert: true },
          );
          if (legacyDoc) await col.deleteOne({ _id: token }).catch(() => {});
          return restored;
        }
      } catch (err) {
        console.warn('[sessionStore] MongoDB read error (user get):', err.message);
      }
    }
    return null;
  }
  
  if (session.expiresAt && session.expiresAt < Date.now()) {
    memoryUserSessions.delete(token);
    return null;
  }
  
  session.lastAccessAt = Date.now();
  return session;
}

/**
 * Remove sessão de usuário
 */
export async function deleteUserSession(token) {
  if (!token) return false;

  let removed = memoryUserSessions.delete(token);
  const col = await _mongoCol(USER_PREFIX);
  if (col) {
    try {
      const results = await Promise.all([
        col.deleteOne({ _id: tokenHash(token) }),
        col.deleteOne({ _id: token }),
      ]);
      removed = results.some(result => result.deletedCount > 0) || removed;
    } catch (err) {
      console.warn('[sessionStore] MongoDB delete error (user session):', err.message);
    }
  }
  
  if (redis) {
    try {
      const result = await redis.del(storageKey(USER_PREFIX, token));
      return result > 0 || removed;
    } catch (err) {
      console.error('[sessionStore] Redis error on deleteUserSession:', err.message);
      return removed;
    }
  }
  
  return removed;
}

/**
 * Lista todas as sessões de usuário ativas
 */
export async function listUserSessions() {
  if (redis) {
    try {
      const keys = await redis.keys(`${USER_PREFIX}*`);
      const sessions = [];
      for (const key of keys) {
        const raw = await redis.get(key);
        if (raw) {
          const session = JSON.parse(raw);
          if (!session.expiresAt || session.expiresAt >= Date.now()) {
            sessions.push(publicSession(session));
          }
        }
      }
      return sessions;
    } catch (err) {
      console.error('[sessionStore] Redis error on listUserSessions:', err.message);
      const now = Date.now();
      return Array.from(memoryUserSessions.values()).filter(
        s => !s.expiresAt || s.expiresAt >= now
      ).map(publicSession);
    }
  }
  
  const now = Date.now();
  const memorySessions = Array.from(memoryUserSessions.values()).filter(
    s => !s.expiresAt || s.expiresAt >= now
  ).map(publicSession);

  // Complementar com sessões do MongoDB que não estão na memória
  const col = await _mongoCol(USER_PREFIX);
  if (col) {
    try {
      const docs = await col.find({ expiresAt: { $gte: new Date() } }).toArray();
      const memoryIds = new Set(memorySessions.map(s => `${s.userId || ''}:${s.createdAt || ''}`));
      for (const doc of docs) {
        const key = `${doc.userId || ''}:${doc.createdAt || ''}`;
        if (!memoryIds.has(key)) {
          const rest = publicSession(doc);
          rest.expiresAt = new Date(doc.expiresAt).getTime();
          memorySessions.push(rest);
        }
      }
    } catch (err) {
      console.warn('[sessionStore] MongoDB read error (user list):', err.message);
    }
  }

  return memorySessions;
}

/**
 * Remove todas as sessões (usado em testes/manutenção)
 */
export async function clearAllSessions() {
  if (redis) {
    try {
      const adminKeys = await redis.keys(`${ADMIN_PREFIX}*`);
      const userKeys = await redis.keys(`${USER_PREFIX}*`);
      const all = [...adminKeys, ...userKeys];
      if (all.length > 0) {
        await redis.del(...all);
      }
    } catch (err) {
      console.error('[sessionStore] Redis error on clearAllSessions:', err.message);
    }
  }

  // Limpar MongoDB também
  const adminCol = await _mongoCol(ADMIN_PREFIX);
  if (adminCol) { adminCol.deleteMany({}).catch(() => {}); }
  const userCol = await _mongoCol(USER_PREFIX);
  if (userCol) { userCol.deleteMany({}).catch(() => {}); }
  
  memoryAdminSessions.clear();
  memoryUserSessions.clear();
}

/**
 * Estatísticas do armazenamento de sessões
 */
export async function getSessionStats() {
  if (redis) {
    try {
      const adminKeys = await redis.keys(`${ADMIN_PREFIX}*`);
      const userKeys = await redis.keys(`${USER_PREFIX}*`);
      return {
        adminSessions: adminKeys.length,
        userSessions: userKeys.length,
        total: adminKeys.length + userKeys.length,
        storage: 'redis',
      };
    } catch (err) {
      console.error('[sessionStore] Redis error on getSessionStats:', err.message);
    }
  }
  
  return {
    adminSessions: memoryAdminSessions.size,
    userSessions: memoryUserSessions.size,
    total: memoryAdminSessions.size + memoryUserSessions.size,
    storage: _mongoGetDb ? 'mongodb' : 'memory',
  };
}
