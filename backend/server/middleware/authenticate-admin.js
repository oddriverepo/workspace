import { getAdminSession } from '../services/sessionStore.js';
import { consumeAdminStreamTicket } from '../services/streamTickets.js';

function isStreamTicketPath(req) {
  const path = String(req.path || '');
  const originalPath = String(req.originalUrl || '').split('?')[0];
  return path === '/inbox/stream' || originalPath === '/api/disparador/inbox/stream';
}

export async function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [, headerToken] = authHeader.split(' ');
  const streamTicket = isStreamTicketPath(req) ? String(req.query.streamTicket || '') : '';

  if (!headerToken && streamTicket) {
    const ticketSession = consumeAdminStreamTicket(streamTicket);
    if (!ticketSession) {
      return res.status(401).json({ error: 'Sessao invalida ou expirada' });
    }
    req.adminUser = {
      id: ticketSession.userId,
      username: ticketSession.username,
      name: ticketSession.name,
      role: ticketSession.role || 'admin',
      sessionToken: null,
    };
    return next();
  }

  const token = headerToken || '';
  
  if (!token) {
    return res.status(401).json({ error: 'Autenticacao necessaria' });
  }

  const session = await getAdminSession(token);
  
  if (!session) {
    return res.status(401).json({ error: 'Sessao invalida ou expirada' });
  }

  // Adiciona dados do admin no request
  req.adminUser = {
    id: session.userId,
    username: session.username,
    name: session.name,
    role: session.role || 'admin',
    sessionToken: token,
  };

  next();
}

export async function optionalAdmin(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [, token] = authHeader.split(' ');
  
  if (!token) {
    req.adminUser = null;
    return next();
  }

  const session = await getAdminSession(token);
  
  if (!session) {
    req.adminUser = null;
    return next();
  }

  req.adminUser = {
    id: session.userId,
    username: session.username,
    name: session.name,
    role: session.role || 'admin',
    sessionToken: token,
  };

  next();
}
