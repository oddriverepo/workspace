import { getUserSession } from '../services/sessionStore.js';

export async function authenticateSession(req, res, next) {
  const authHeader = req.headers.authorization || '';
  const [, headerToken] = authHeader.split(' ');
  const token = headerToken || '';

  if (!token) {
    return res.status(401).json({ error: 'Autenticacao necessaria' });
  }

  const session = await getUserSession(token);

  if (!session) {
    return res.status(401).json({ error: 'Sessao invalida ou expirada' });
  }

  req.userSession = session;
  next();
}
