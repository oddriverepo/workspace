import { insertAuditLog } from '../services/db.js';

/**
 * Middleware de auditoria que grava logs de ações administrativas
 * Usa após a execução da rota (wrap the handler)
 */
export function auditAction(actionType, getDetails = null) {
  return (handler) => async (req, res, next) => {
    const originalJson = res.json.bind(res);
    const originalStatus = res.status.bind(res);
    let statusCode = 200;
    let responseData = null;

    // Intercepta res.status()
    res.status = (code) => {
      statusCode = code;
      return originalStatus(code);
    };

    // Intercepta res.json()
    res.json = (data) => {
      responseData = data;
      
      // Grava log após resposta bem-sucedida
      if (req.adminUser && statusCode >= 200 && statusCode < 400) {
        setImmediate(async () => {
          try {
            const details = typeof getDetails === 'function' 
              ? getDetails(req, responseData) 
              : {};

            await insertAuditLog({
              userId: req.adminUser.id || null,
              username: req.adminUser.username || 'unknown',
              name: req.adminUser.name || req.adminUser.username || 'Unknown',
              action: actionType,
              entityType: details.entityType || actionType.split(':')[0] || null,
              entityId: details.entityId || req.params.id || null,
              details: details.data || details || {},
              ipAddress: req.ip || req.connection.remoteAddress || null,
              userAgent: req.headers['user-agent'] || null,
              timestamp: Date.now(),
              success: true,
            });
          } catch (err) {
            console.error('[audit] Erro ao gravar log:', err.message);
          }
        });
      }

      return originalJson(data);
    };

    // Executa o handler original
    try {
      await handler(req, res, next);
    } catch (err) {
      // Log de erro se houver exceção
      if (req.adminUser) {
        setImmediate(async () => {
          try {
            await insertAuditLog({
              userId: req.adminUser.id || null,
              username: req.adminUser.username || 'unknown',
              name: req.adminUser.name || req.adminUser.username || 'Unknown',
              action: actionType,
              entityType: actionType.split(':')[0] || null,
              entityId: req.params.id || null,
              details: { error: err.message },
              ipAddress: req.ip || req.connection.remoteAddress || null,
              userAgent: req.headers['user-agent'] || null,
              timestamp: Date.now(),
              success: false,
            });
          } catch (logErr) {
            console.error('[audit] Erro ao gravar log de erro:', logErr.message);
          }
        });
      }
      throw err;
    }
  };
}

/**
 * Middleware simplificado para gravar log manualmente dentro da rota
 */
export async function logAudit(req, action, details = {}) {
  if (!req.adminUser) return;
  
  try {
    await insertAuditLog({
      userId: req.adminUser.id || null,
      username: req.adminUser.username || 'unknown',
      name: req.adminUser.name || req.adminUser.username || 'Unknown',
      action,
      entityType: details.entityType || action.split(':')[0] || null,
      entityId: details.entityId || null,
      details: details.data || details || {},
      ipAddress: req.ip || req.connection.remoteAddress || null,
      userAgent: req.headers['user-agent'] || null,
      timestamp: Date.now(),
      success: true,
    });
  } catch (err) {
    console.error('[audit] Erro ao gravar log:', err.message);
  }
}
