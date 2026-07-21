import crypto from 'crypto';

const KEY_ENV = process.env.SECRET_ENCRYPTION_KEY || process.env.DATA_ENCRYPTION_KEY || '';
const isProd = process.env.NODE_ENV === 'production';

function getKey() {
  if (!KEY_ENV) {
    if (isProd) {
      throw new Error('SECRET_ENCRYPTION_KEY nao configurada para criptografar segredos.');
    }
    return null;
  }
  return crypto.createHash('sha256').update(String(KEY_ENV)).digest();
}

export function encryptSecret(value) {
  if (value === undefined || value === null || value === '') return value;
  const key = getKey();
  if (!key) return value;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(String(value), 'utf8'),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  return {
    enc: 'aes-256-gcm',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64'),
  };
}

export function decryptSecret(value) {
  if (!value || typeof value !== 'object' || value.enc !== 'aes-256-gcm') return value;
  const key = getKey();
  if (!key) return '';

  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(value.data, 'base64')),
    decipher.final(),
  ]).toString('utf8');
}

export function isSensitiveConfigKey(key = '') {
  return /(TOKEN|SECRET|PASSWORD|PRIVATE_KEY)/i.test(String(key));
}
