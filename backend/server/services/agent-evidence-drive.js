import axios from 'axios';
import FormData from 'form-data';
import { Readable } from 'stream';
import { runWorkload } from './workload-manager.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';
const folderCache = new Map();
let googleAuthService = null;

export function configureAgentEvidenceDrive({ googleAuthService: service }) {
  googleAuthService = service;
}

function rootFolderId() {
  return String(
    process.env.GOOGLE_DRIVE_EVIDENCE_FOLDER_ID ||
    process.env.GOOGLE_DRIVE_EVIDENCES_FOLDER_ID ||
    process.env.EVIDENCE_DRIVE_ROOT_FOLDER_ID ||
    '',
  ).trim();
}

function requireConfiguration() {
  if (!googleAuthService) throw Object.assign(new Error('Google Auth não inicializado.'), { status: 503 });
  const folderId = rootFolderId();
  if (!folderId) {
    throw Object.assign(new Error('Pasta de evidências do Google Drive não configurada.'), { status: 503 });
  }
  return folderId;
}

function safeSegment(value, fallback) {
  const segment = String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return segment || fallback;
}

function escapeDriveQuery(value) {
  return String(value || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

async function accessToken() {
  const token = await googleAuthService.getValidAccessToken();
  if (!token) throw Object.assign(new Error('Google Drive não está conectado.'), { status: 503 });
  return token;
}

function tagDriveError(error, operation) {
  const target = error instanceof Error
    ? error
    : new Error(String(error || 'Falha na operacao do Google Drive'));
  target.driveOperation = target.driveOperation || operation;
  const googleError = target?.response?.data?.error;
  const firstError = Array.isArray(googleError?.errors) ? googleError.errors[0] : null;
  target.googleReason = target.googleReason
    || String(firstError?.reason || googleError?.status || '').slice(0, 120);
  target.googleMessage = target.googleMessage
    || String(googleError?.message || target.message || '').slice(0, 300);
  return target;
}

function logDriveFailure(error, operation) {
  const tagged = tagDriveError(error, operation);
  console.error(
    '[agent][evidence][drive][failure]',
    JSON.stringify({
      drive_operation: tagged.driveOperation || operation,
      status_code: Number(tagged?.response?.status || tagged?.status || tagged?.statusCode || 0) || null,
      google_reason: tagged.googleReason || '',
      google_message: tagged.googleMessage || '',
    }),
  );
  return tagged;
}

async function driveRequest(config, retry = true) {
  const token = await accessToken();
  const driveOperation = config.driveOperation || 'drive_request';
  try {
    return await axios({
      timeout: 30_000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      ...config,
      driveOperation: undefined,
      headers: {
        ...(config.headers || {}),
        Authorization: `Bearer ${token}`,
      },
    });
  } catch (error) {
    if (retry && error?.response?.status === 401) {
      await googleAuthService.refreshToken();
      return driveRequest(config, false);
    }
    throw tagDriveError(error, driveOperation);
  }
}

async function ensureFolder(parentId, name) {
  const cacheKey = `${parentId}:${name}`;
  const cached = folderCache.get(cacheKey);
  if (cached) return cached;

  const operation = (async () => {
    const query = [
      `'${escapeDriveQuery(parentId)}' in parents`,
      `name = '${escapeDriveQuery(name)}'`,
      `mimeType = 'application/vnd.google-apps.folder'`,
      'trashed = false',
    ].join(' and ');
    const found = await driveRequest({
      driveOperation: 'find_folder',
      method: 'GET',
      url: `${DRIVE_API}/files`,
      params: {
        q: query,
        fields: 'files(id,name)',
        pageSize: 1,
        supportsAllDrives: true,
        includeItemsFromAllDrives: true,
      },
    });
    let folderId = found.data?.files?.[0]?.id;
    if (!folderId) {
      const created = await driveRequest({
        driveOperation: 'create_folder',
        method: 'POST',
        url: `${DRIVE_API}/files`,
        params: { fields: 'id,name', supportsAllDrives: true },
        data: {
          name,
          mimeType: 'application/vnd.google-apps.folder',
          parents: [parentId],
        },
      });
      folderId = created.data?.id;
    }
    if (!folderId) throw new Error('O Google Drive não retornou o ID da pasta.');
    return folderId;
  })();

  if (folderCache.size >= 500) folderCache.clear();
  folderCache.set(cacheKey, operation);
  try {
    const folderId = await operation;
    folderCache.set(cacheKey, folderId);
    return folderId;
  } catch (error) {
    if (folderCache.get(cacheKey) === operation) folderCache.delete(cacheKey);
    throw logDriveFailure(error, error?.driveOperation || 'ensure_folder');
  }
}

function dateFolderName(value) {
  const date = new Date(value || Date.now());
  const valid = Number.isFinite(date.getTime()) ? date : new Date();
  return valid.toISOString().slice(0, 10);
}

async function uploadMultipart({ metadata, buffer, fileName, mimeType }, retry = true) {
  const form = new FormData();
  form.append('metadata', JSON.stringify(metadata), { contentType: 'application/json' });
  form.append('file', buffer, { filename: fileName, contentType: mimeType, knownLength: buffer.length });
  try {
    return await driveRequest({
      driveOperation: 'upload_file',
      method: 'POST',
      url: `${DRIVE_UPLOAD_API}/files`,
      params: { uploadType: 'multipart', fields: 'id,name,mimeType,size', supportsAllDrives: true },
      headers: form.getHeaders(),
      data: form,
    }, false);
  } catch (error) {
    if (retry && error?.response?.status === 401) {
      await googleAuthService.refreshToken();
      return uploadMultipart({ metadata, buffer, fileName, mimeType }, false);
    }
    throw logDriveFailure(error, error?.driveOperation || 'upload_file');
  }
}

async function findExistingEvidenceFile(messageId) {
  const normalizedMessageId = String(messageId || '').trim().slice(0, 120);
  if (!normalizedMessageId) return null;
  const query = [
    `appProperties has { key='source' and value='gptmaker' }`,
    `appProperties has { key='messageId' and value='${escapeDriveQuery(normalizedMessageId)}' }`,
    'trashed = false',
  ].join(' and ');
  const found = await driveRequest({
    driveOperation: 'find_existing_evidence_file',
    method: 'GET',
    url: `${DRIVE_API}/files`,
    params: {
      q: query,
      fields: 'files(id,name,mimeType,size)',
      pageSize: 1,
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    },
  });
  return found.data?.files?.[0] || null;
}

function compactProperties(properties) {
  return Object.fromEntries(
    Object.entries(properties || {})
      .map(([key, value]) => [key, String(value ?? '').trim().slice(0, 120)])
      .filter(([, value]) => value.length > 0),
  );
}

export async function uploadAgentEvidenceImage({
  buffer,
  mimeType,
  extension,
  campaign,
  driver,
  messageId,
  receivedAt,
}) {
  return runWorkload('external', 'agent-evidence:drive-upload', async () => {
    const rootId = requireConfiguration();
    const hasCampaign = Boolean(campaign?.id || driver?.campaignId);
    const campaignName = hasCampaign
      ? safeSegment(
          `${campaign?.name || 'Campanha'} - ${campaign?.id || driver?.campaignId || ''}`,
          'Campanha',
        )
      : 'Motoristas sem campanha';
    const driverName = safeSegment(
      `${driver?.name || 'Motorista'} - ${driver?.id || driver?._id || ''}`,
      'Motorista',
    );
    const campaignFolderId = await ensureFolder(rootId, campaignName);
    const driverFolderId = await ensureFolder(campaignFolderId, driverName);
    const dayName = dateFolderName(receivedAt);
    const dayFolderId = await ensureFolder(driverFolderId, dayName);

    const safeMessageId = safeSegment(messageId, `evidencia-${Date.now()}`);
    const fileName = `${safeMessageId}.${extension}`;
    const expectedPath = `${campaignName}/${driverName}/${dayName}/${fileName}`;
    const existing = await findExistingEvidenceFile(messageId);
    if (existing?.id) {
      return {
        fileId: existing.id,
        fileName: existing.name || fileName,
        mimeType: existing.mimeType || mimeType,
        size: Number(existing.size || buffer.length),
        path: expectedPath,
        protectedUrl: `/api/storage/drive/${encodeURIComponent(existing.id)}`,
        reused: true,
      };
    }
    const metadata = {
      name: fileName,
      parents: [dayFolderId],
      appProperties: compactProperties({
        source: 'gptmaker',
        messageId,
        campaignId: campaign?.id || driver?.campaignId,
        driverId: driver?.id || driver?._id,
        evidenceContext: hasCampaign ? 'campaign' : 'driver_validation',
      }),
    };
    const uploaded = await uploadMultipart({ metadata, buffer, fileName, mimeType });
    const fileId = uploaded.data?.id;
    if (!fileId) throw new Error('O Google Drive não retornou o ID do arquivo.');

    return {
      fileId,
      fileName: uploaded.data?.name || fileName,
      mimeType: uploaded.data?.mimeType || mimeType,
      size: Number(uploaded.data?.size || buffer.length),
      path: expectedPath,
      protectedUrl: `/api/storage/drive/${encodeURIComponent(fileId)}`,
      reused: false,
    };
  });
}

export async function openAgentEvidenceDriveStream(fileId) {
  if (!/^[a-zA-Z0-9_-]{10,200}$/.test(String(fileId || ''))) {
    throw Object.assign(new Error('Arquivo inválido.'), { status: 400 });
  }
  requireConfiguration();
  const response = await runWorkload('external', 'agent-evidence:drive-download', () =>
      driveRequest({
        driveOperation: 'download_file',
        method: 'GET',
        url: `${DRIVE_API}/files/${encodeURIComponent(fileId)}`,
      params: { alt: 'media', supportsAllDrives: true },
      responseType: 'stream',
    }),
  );
  return {
    stream: response.data instanceof Readable ? response.data : Readable.from(response.data),
    mimeType: response.headers?.['content-type'] || 'application/octet-stream',
    size: Number(response.headers?.['content-length'] || 0) || null,
  };
}

export async function deleteAgentEvidenceDriveFile(fileId) {
  if (!fileId) return false;
  requireConfiguration();
  try {
    await runWorkload('external', 'agent-evidence:drive-delete', () =>
      driveRequest({
        driveOperation: 'delete_file',
        method: 'DELETE',
        url: `${DRIVE_API}/files/${encodeURIComponent(fileId)}`,
        params: { supportsAllDrives: true },
      }),
    );
    return true;
  } catch (error) {
    if (error?.response?.status === 404) return true;
    throw error;
  }
}
