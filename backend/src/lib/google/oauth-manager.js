const axios = require('axios');
const http = require('http');
const { shell } = require('electron');
const crypto = require('crypto');

const GOOGLE_OAUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DEFAULT_SCOPES = [
  'https://www.googleapis.com/auth/presentations',
  'https://www.googleapis.com/auth/drive'
];
const DEFAULT_REDIRECT_PATH = '/api/slides/oauth/callback';
const DEFAULT_REDIRECT_URI = `https://oddrive-gerador.onrender.com${DEFAULT_REDIRECT_PATH}`;
const SECRET_ENCRYPTION_KEY = process.env.SECRET_ENCRYPTION_KEY || process.env.DATA_ENCRYPTION_KEY || '';

function getSecretKey() {
  if (!SECRET_ENCRYPTION_KEY) return null;
  return crypto.createHash('sha256').update(String(SECRET_ENCRYPTION_KEY)).digest();
}

function encryptSecret(value) {
  if (!value) return value;
  const key = getSecretKey();
  if (!key) return value;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const data = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  return {
    enc: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    data: data.toString('base64'),
  };
}

function decryptSecret(value) {
  if (!value || typeof value !== 'object' || value.enc !== 'aes-256-gcm') return value;
  const key = getSecretKey();
  if (!key) return '';
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(value.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

class GoogleOAuthManager {
  constructor(store, configProvider = null) {
    this.store = store;
    this.configProvider = typeof configProvider === 'function' ? configProvider : null;
    this.clientId = process.env.GOOGLE_CLIENT_ID || '';
    this.clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
    this.redirectUri = process.env.GOOGLE_REDIRECT_URI || DEFAULT_REDIRECT_URI;
    this.redirectPath = DEFAULT_REDIRECT_PATH;
    this.port = parseInt(process.env.PORT || '8080', 10);
    this.codeVerifier = null;
    this.server = null;
    this.loadCredentials();
  }

  loadCredentials() {
    const fromConfig = this.configProvider ? this.configProvider() : null;
    if (fromConfig && Object.keys(fromConfig).length) {
      this.clientId = fromConfig.clientId || this.clientId;
      this.clientSecret = fromConfig.clientSecret || this.clientSecret;
      this.redirectUri = fromConfig.redirectUri || this.redirectUri;
    }
    this.updateRedirectMetadata();
  }

  updateRedirectMetadata() {
    try {
      const redirectUrl = new URL(this.redirectUri || DEFAULT_REDIRECT_URI);
      this.redirectPath = redirectUrl.pathname || DEFAULT_REDIRECT_PATH;
      this.port = redirectUrl.port
        ? parseInt(redirectUrl.port, 10)
        : this.port;
    } catch (error) {
      this.redirectPath = DEFAULT_REDIRECT_PATH;
    }
  }

  generatePKCE() {
    this.codeVerifier = crypto.randomBytes(64).toString('base64url');
    const challenge = crypto
      .createHash('sha256')
      .update(this.codeVerifier)
      .digest('base64url');
    return challenge;
  }

  buildAuthUrl() {
    this.loadCredentials();
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      response_type: 'code',
      scope: DEFAULT_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      code_challenge_method: 'S256',
      code_challenge: this.generatePKCE()
    });

    return `${GOOGLE_OAUTH_URL}?${params.toString()}`;
  }

  async startOAuthFlow() {
    this.loadCredentials();
    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        const url = new URL(req.url, `http://127.0.0.1:${this.port}`);

        if (url.pathname === this.redirectPath) {
          const code = url.searchParams.get('code');
          const error = url.searchParams.get('error');

          if (error) {
            this.closeServer();
            reject(new Error(error));
            res.writeHead(400, { 'Content-Type': 'text/plain' });
            res.end('Authorization error');
            return;
          }

          try {
            const tokenData = await this.exchangeCodeForToken(code);
            this.saveToken(tokenData);

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<h2>Autorização concluída. Você pode fechar esta janela.</h2>');

            this.closeServer();
            resolve({ success: true });
          } catch (tokenError) {
            console.error('[Google OAuth] Falha ao trocar código por token:', tokenError.response?.data || tokenError.message);
            this.closeServer();
            reject(tokenError);
          }
        } else {
          res.writeHead(404);
          res.end();
        }
      });

      this.server.listen(this.port, () => {
        const authUrl = this.buildAuthUrl();
        shell.openExternal(authUrl);
      });
    });
  }

  closeServer() {
    if (this.server) {
      this.server.close();
      this.server = null;
    }
  }

  async exchangeCodeForToken(code) {
    this.loadCredentials();
    const params = new URLSearchParams({
      code,
      client_id: this.clientId,
      client_secret: this.clientSecret,
      redirect_uri: this.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: this.codeVerifier
    });

    const response = await axios.post(GOOGLE_TOKEN_URL, params.toString(), {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      }
    });

    return response.data;
  }

  saveToken(tokenData) {
    const now = new Date();
    const expiresAt = new Date(now.getTime() + tokenData.expires_in * 1000);

    this.store.set('google_auth', {
      accessToken: encryptSecret(tokenData.access_token),
      refreshToken: encryptSecret(tokenData.refresh_token),
      tokenType: tokenData.token_type,
      scope: tokenData.scope,
      expiresAt: expiresAt.toISOString(),
      connectedAt: now.toISOString()
    });
  }

  getToken() {
    const data = this.store.get('google_auth');
    if (!data) return null;
    return decryptSecret(data.accessToken);
  }

  async getValidAccessToken() {
    const data = this.getTokenInfo();
    if (!data) return null;

    const expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    const now = new Date();

    if (!expiresAt) {
      return data.accessToken;
    }

    const remainingMs = expiresAt.getTime() - now.getTime();
    if (remainingMs > 60 * 1000) {
      return data.accessToken;
    }

    try {
      const refreshed = await this.refreshToken();
      return refreshed.access_token || refreshed.accessToken || this.getTokenInfo()?.accessToken || null;
    } catch (error) {
      console.error('[Google OAuth] Falha ao renovar token automaticamente:', error.message);
      return null;
    }
  }

  getTokenInfo() {
    const data = this.store.get('google_auth') || null;
    if (!data) return null;
    return {
      ...data,
      accessToken: decryptSecret(data.accessToken),
      refreshToken: decryptSecret(data.refreshToken),
    };
  }

  disconnect() {
    this.store.delete('google_auth');
  }

  async refreshToken() {
    this.loadCredentials();
    const auth = this.getTokenInfo();
    if (!auth?.refreshToken) {
      throw new Error('Refresh token não disponível');
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: auth.refreshToken,
      grant_type: 'refresh_token'
    });

    const response = await axios.post(GOOGLE_TOKEN_URL, params.toString(), {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
    });

    const payload = {
      ...response.data,
      refresh_token: response.data.refresh_token || auth.refreshToken
    };

    this.saveToken(payload);

    return payload;
  }
}

module.exports = GoogleOAuthManager;
