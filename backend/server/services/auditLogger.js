/**
 * Sistema de auditoria para rastrear ações críticas
 */
import { insertAuditLog } from '../services/db.js';

/**
 * Categorias de eventos auditáveis
 */
export const AuditAction = {
  // Autenticação
  LOGIN_SUCCESS: 'LOGIN_SUCCESS',
  LOGIN_FAILURE: 'LOGIN_FAILURE',
  LOGOUT: 'LOGOUT',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  
  // Campanhas
  CAMPAIGN_CREATE: 'CAMPAIGN_CREATE',
  CAMPAIGN_UPDATE: 'CAMPAIGN_UPDATE',
  CAMPAIGN_DELETE: 'CAMPAIGN_DELETE',
  CAMPAIGN_IMPORT: 'CAMPAIGN_IMPORT',
  
  // Motoristas
  DRIVER_CREATE: 'DRIVER_CREATE',
  DRIVER_UPDATE: 'DRIVER_UPDATE',
  DRIVER_LOGIN: 'DRIVER_LOGIN',
  
  // Evidências
  EVIDENCE_UPLOAD: 'EVIDENCE_UPLOAD',
  EVIDENCE_DELETE: 'EVIDENCE_DELETE',
  
  // Configurações
  CONFIG_UPDATE: 'CONFIG_UPDATE',
  MASTER_SHEET_CHANGE: 'MASTER_SHEET_CHANGE',
  
  // Acessos suspeitos
  UNAUTHORIZED_ACCESS: 'UNAUTHORIZED_ACCESS',
  RATE_LIMIT_EXCEEDED: 'RATE_LIMIT_EXCEEDED',
  INVALID_INPUT: 'INVALID_INPUT',
};

/**
 * Tipos de entidade
 */
export const EntityType = {
  USER: 'user',
  ADMIN: 'admin',
  DRIVER: 'driver',
  GRAPHIC: 'graphic',
  CAMPAIGN: 'campaign',
  EVIDENCE: 'evidence',
  CONFIG: 'config',
  SESSION: 'session',
};

/**
 * Middleware para auditoria automática de rotas sensíveis
 */
export function auditRoute(action, entityType) {
  return async (req, res, next) => {
    const originalJson = res.json.bind(res);
    
    res.json = function(data) {
      // Log após resposta bem-sucedida
      if (res.statusCode >= 200 && res.statusCode < 300) {
        logAudit({
          action,
          entityType,
          entityId: data?.id || req.params?.id || null,
          username: req.adminUser?.username || req.sessionContext?.session?.name || 'anonymous',
          userId: req.adminUser?.id || req.sessionContext?.session?.userId || null,
          metadata: {
            method: req.method,
            path: req.path,
            ip: req.ip || req.connection.remoteAddress,
            userAgent: req.get('user-agent'),
          },
          success: true,
        }).catch(err => console.error('[audit] Falha ao registrar log:', err));
      }
      
      return originalJson(data);
    };
    
    next();
  };
}

/**
 * Registra evento de auditoria
 */
export async function logAudit({ action, entityType, entityId, username, userId, metadata = {}, success = true }) {
  try {
    const meta = metadata && typeof metadata === 'object' ? { ...metadata } : {};
    const ip = meta.ipAddress || meta.ip || null;
    const userAgent = meta.userAgent || null;
    delete meta.ip;
    delete meta.ipAddress;
    delete meta.userAgent;

    await insertAuditLog({
      action,
      entityType,
      entityId: entityId || null,
      username: username || 'system',
      userId: userId || null,
      details: meta,
      ipAddress: ip,
      userAgent,
      timestamp: Date.now(),
      success,
    });
  } catch (err) {
    console.error('[audit] Erro ao inserir log:', err);
  }
}

/**
 * Log de login bem-sucedido
 */
export async function logLoginSuccess(username, userId, req) {
  return logAudit({
    action: AuditAction.LOGIN_SUCCESS,
    entityType: EntityType.ADMIN,
    entityId: userId,
    username,
    userId,
    metadata: {
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent'),
    },
    success: true,
  });
}

/**
 * Log de falha de login
 */
export async function logLoginFailure(username, reason, req) {
  return logAudit({
    action: AuditAction.LOGIN_FAILURE,
    entityType: EntityType.ADMIN,
    entityId: null,
    username: username || 'unknown',
    userId: null,
    metadata: {
      reason,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent'),
    },
    success: false,
  });
}

/**
 * Log de logout
 */
export async function logLogout(username, userId) {
  return logAudit({
    action: AuditAction.LOGOUT,
    entityType: EntityType.ADMIN,
    entityId: userId,
    username,
    userId,
    success: true,
  });
}

/**
 * Log de tentativa de acesso não autorizado
 */
export async function logUnauthorizedAccess(req, reason = 'No token provided') {
  return logAudit({
    action: AuditAction.UNAUTHORIZED_ACCESS,
    entityType: EntityType.SESSION,
    entityId: null,
    username: 'anonymous',
    userId: null,
    metadata: {
      reason,
      path: req.path,
      method: req.method,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('user-agent'),
    },
    success: false,
  });
}

/**
 * Log de criação/importação de campanha
 */
export async function logCampaignAction(action, campaignId, campaignName, username, userId) {
  return logAudit({
    action,
    entityType: EntityType.CAMPAIGN,
    entityId: campaignId,
    username,
    userId,
    metadata: {
      campaignName,
    },
    success: true,
  });
}

/**
 * Log de upload de evidência
 */
export async function logEvidenceUpload(evidenceId, driverId, driverName, campaignId) {
  return logAudit({
    action: AuditAction.EVIDENCE_UPLOAD,
    entityType: EntityType.EVIDENCE,
    entityId: evidenceId,
    username: driverName,
    userId: driverId,
    metadata: {
      campaignId,
    },
    success: true,
  });
}

/**
 * Log de mudança de configuração
 */
export async function logConfigChange(configKey, oldValue, newValue, username, userId) {
  return logAudit({
    action: AuditAction.CONFIG_UPDATE,
    entityType: EntityType.CONFIG,
    entityId: configKey,
    username,
    userId,
    metadata: {
      configKey,
      oldValue,
      newValue,
    },
    success: true,
  });
}

/**
 * Log de entrada inválida (possível ataque)
 */
export async function logInvalidInput(req, fieldName, value) {
  return logAudit({
    action: AuditAction.INVALID_INPUT,
    entityType: EntityType.SESSION,
    entityId: null,
    username: req.adminUser?.username || 'anonymous',
    userId: req.adminUser?.id || null,
    metadata: {
      fieldName,
      invalidValue: String(value).slice(0, 100), // Limita tamanho
      path: req.path,
      ip: req.ip || req.connection.remoteAddress,
    },
    success: false,
  });
}
