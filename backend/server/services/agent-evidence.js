import crypto from 'crypto';
import { getDb, isCampaignDriverDetached } from './mongo.js';
import { readCampaignById, readDriverByExactPhone } from './oddrive-sync.js';
import { runWorkload } from './workload-manager.js';
import {
  downloadRemoteImage,
  mapEvidenceType,
  normalizeEvidencePhone,
  resolveGptMakerImage,
} from './agent-evidence-utils.js';
import {
  deleteAgentEvidenceDriveFile,
  uploadAgentEvidenceImage,
} from './agent-evidence-drive.js';

const COLLECTION = 'evidence';
const PROCESSING_STALE_MS = 5 * 60 * 1000;
const SUCCESS_REPLY = 'Recebi essa foto. Pode enviar a próxima.';
const DUPLICATE_REPLY = 'Essa foto já foi recebida. Pode enviar a próxima, se faltar alguma.';
const PROCESSING_REPLY = 'Essa foto já está sendo processada. Pode enviar a próxima, se faltar alguma.';
const NOT_REGISTERED_REPLY =
  'Não localizei um cadastro ativo para este telefone. A imagem não foi registrada.';

function deterministicEvidenceId(messageId) {
  const digest = crypto.createHash('sha256').update(`gptmaker:${messageId}`).digest('hex').slice(0, 28);
  return `gpt_${digest}`;
}

function parseReceivedAt(value) {
  if (value == null || value === '') return new Date();
  const numeric = Number(value);
  const date = Number.isFinite(numeric)
    ? new Date(numeric < 100_000_000_000 ? numeric * 1000 : numeric)
    : new Date(value);
  return Number.isFinite(date.getTime()) ? date : new Date();
}

function publicDriver(driver) {
  return {
    id: String(driver?.id || driver?._id || ''),
    name: String(driver?.name || '').trim(),
    campaignId: String(driver?.campaignId || driver?.campaignData?.campaignId || '').trim(),
    driverCampaignId: String(driver?.campaignData?.driverCampaignId || driver?.driverCampaignId || '').trim(),
  };
}

async function claimMessage({ messageId, phone, driver, evidenceType, receivedAt, chatId, caption }) {
  const database = await getDb();
  const collection = database.collection(COLLECTION);
  const id = deterministicEvidenceId(messageId);
  const now = new Date();
  const baseDocument = {
    _id: id,
    source: 'gptmaker',
    source_provider: 'gptmaker',
    source_message_id: messageId,
    chat_id: chatId || null,
    phone,
    campaign_id: driver.campaignId || null,
    driver_id: driver.id,
    driver_campaign_id: driver.driverCampaignId || null,
    step: evidenceType,
    uploader_type: 'driver',
    caption: caption || '',
    status: 'processing',
    received_at: receivedAt,
    created_at: now,
    updated_at: now,
    processing_started_at: now,
  };

  try {
    await collection.insertOne(baseDocument);
    return { claimed: true, id, document: baseDocument };
  } catch (error) {
    if (error?.code !== 11000) throw error;
  }

  const existing = await collection.findOne({
    source_provider: 'gptmaker',
    source_message_id: messageId,
  });
  if (!existing) throw new Error('Falha ao recuperar o registro idempotente da evidência.');
  if (existing.status === 'received' || existing.status === 'recebida') {
    return { claimed: false, duplicate: true, id: String(existing._id), document: existing };
  }
  if (existing.drive_file_id && existing.url) {
    return { claimed: true, resumeUpload: true, id: String(existing._id), document: existing };
  }

  const processingAt = new Date(existing.processing_started_at || existing.updated_at || 0).getTime();
  if (existing.status === 'processing' && Date.now() - processingAt < PROCESSING_STALE_MS) {
    return { claimed: false, processing: true, id: String(existing._id), document: existing };
  }

  const { _id: _ignoredId, ...reclaimFields } = baseDocument;
  const reclaimed = await collection.findOneAndUpdate(
    {
      _id: existing._id,
      status: existing.status,
      updated_at: existing.updated_at,
    },
    {
      $set: {
        ...reclaimFields,
        created_at: existing.created_at || now,
        updated_at: now,
        processing_started_at: now,
      },
      $unset: { last_error: '' },
    },
    { returnDocument: 'after' },
  );
  if (!reclaimed) {
    return { claimed: false, processing: true, id: String(existing._id), document: existing };
  }
  return { claimed: true, id: String(existing._id), document: reclaimed };
}

async function markFailed(id, error) {
  try {
    const database = await getDb();
    await database.collection(COLLECTION).updateOne(
      { _id: id, status: { $ne: 'received' } },
      {
        $set: {
          status: 'failed',
          last_error: String(error?.message || 'Falha no processamento').slice(0, 300),
          updated_at: new Date(),
        },
      },
    );
  } catch (markError) {
    console.warn('[agent-evidence] falha ao registrar erro:', markError?.message || markError);
  }
}

async function markUploaded(id, drive) {
  const database = await getDb();
  const result = await database.collection(COLLECTION).updateOne(
    { _id: id },
    {
      $set: {
        status: 'uploaded',
        drive_file_id: drive.fileId,
        drive_file_name: drive.fileName,
        drive_mime_type: drive.mimeType,
        drive_size: drive.size,
        path: drive.path,
        url: drive.protectedUrl,
        updated_at: new Date(),
      },
    },
  );
  if (result.matchedCount !== 1) {
    throw new Error('Não foi possível vincular o arquivo do Drive à evidência.');
  }
}

async function markReceived(id, sourceHost) {
  const database = await getDb();
  const result = await database.collection(COLLECTION).updateOne(
    { _id: id, drive_file_id: { $exists: true } },
    {
      $set: {
        status: 'received',
        source_image_host: sourceHost || null,
        processed_at: new Date(),
        updated_at: new Date(),
      },
      $unset: { last_error: '', processing_started_at: '' },
    },
  );
  if (result.matchedCount !== 1) throw new Error('Não foi possível concluir o registro da evidência.');
}

export async function ensureAgentEvidenceIndexes() {
  const database = await getDb();
  await Promise.all([
    database.collection(COLLECTION).createIndex(
      { source_provider: 1, source_message_id: 1 },
      {
        unique: true,
        partialFilterExpression: {
          source_provider: 'gptmaker',
          source_message_id: { $type: 'string' },
        },
        name: 'unique_gptmaker_message',
      },
    ),
    database.collection(COLLECTION).createIndex(
      { campaign_id: 1, driver_id: 1, status: 1, created_at: -1 },
      { name: 'campaign_driver_evidence' },
    ),
    database.collection(COLLECTION).createIndex(
      { driver_id: 1, status: 1, created_at: -1 },
      { name: 'driver_evidence' },
    ),
    database.collection(COLLECTION).createIndex(
      { source_provider: 1, drive_file_id: 1, status: 1 },
      {
        name: 'received_gptmaker_drive_file',
        partialFilterExpression: {
          source_provider: 'gptmaker',
          drive_file_id: { $type: 'string' },
        },
      },
    ),
  ]);
}

export async function registerAgentEvidence(input = {}) {
  const phone = normalizeEvidencePhone(input.phone);
  const messageId = String(input.message_id || input.messageId || '').trim().slice(0, 200);
  const chatId = String(input.chat_id || input.chatId || '').trim().slice(0, 200);
  const mediaType = String(input.media_type || input.mediaType || '').trim().toUpperCase();
  const caption = String(input.caption || '').trim().slice(0, 1000);
  const evidenceType = mapEvidenceType(input.evidence_type || input.evidenceType);
  const receivedAt = parseReceivedAt(input.message_time || input.messageTime);
  let imageUrl = String(input.image_url || input.imageUrl || '').trim().slice(0, 4096);

  if (!phone || !messageId || mediaType !== 'IMAGE') {
    throw Object.assign(new Error('phone, message_id e media_type=IMAGE são obrigatórios.'), { status: 400 });
  }
  if (!imageUrl && !chatId) {
    throw Object.assign(
      new Error('image_url ou chat_id é obrigatório para localizar a imagem.'),
      { status: 400 },
    );
  }

  const rawDriver = await readDriverByExactPhone(phone);
  const driver = publicDriver(rawDriver);
  if (!driver.id) {
    return { success: false, ignored: true, safe_reply: NOT_REGISTERED_REPLY };
  }

  let campaign = null;
  let evidenceDriver = driver;
  if (driver.campaignId) {
    const detached = await isCampaignDriverDetached(driver.campaignId, driver.id, driver.driverCampaignId);
    campaign = detached ? null : await readCampaignById(driver.campaignId);
    if (!campaign) {
      evidenceDriver = { ...driver, campaignId: '', driverCampaignId: '' };
    }
  }

  const claim = await claimMessage({
    messageId,
    phone,
    driver: evidenceDriver,
    evidenceType,
    receivedAt,
    chatId,
    caption,
  });
  if (!claim.claimed) {
    return {
      success: true,
      duplicate: true,
      processing: Boolean(claim.processing),
      safe_reply: claim.processing ? PROCESSING_REPLY : DUPLICATE_REPLY,
    };
  }

  try {
    let drive = claim.resumeUpload ? {
      fileId: claim.document.drive_file_id,
      fileName: claim.document.drive_file_name,
      mimeType: claim.document.drive_mime_type,
      size: claim.document.drive_size,
      path: claim.document.path,
      protectedUrl: claim.document.url,
    } : null;

    if (!drive) {
      if (!imageUrl) {
        const resolved = await runWorkload('external', 'agent-evidence:gptmaker-message', () =>
          resolveGptMakerImage({ chatId, messageId }),
        );
        imageUrl = resolved.imageUrl;
      }
      const image = await runWorkload('external', 'agent-evidence:image-download', () =>
        downloadRemoteImage(imageUrl),
      );
      drive = await uploadAgentEvidenceImage({
        ...image,
        campaign: campaign
          ? {
              id: String(campaign.id || campaign._id || evidenceDriver.campaignId),
              name: campaign.name || campaign.title || 'Campanha',
            }
          : null,
        driver: evidenceDriver,
        messageId,
        receivedAt,
      });
      try {
        await markUploaded(claim.id, drive);
      } catch (error) {
        try {
          await deleteAgentEvidenceDriveFile(drive.fileId);
        } catch (cleanupError) {
          console.warn(
            '[agent-evidence] falha ao limpar upload sem registro:',
            cleanupError?.message || cleanupError,
          );
        }
        throw error;
      }
    }

    let sourceHost = null;
    try {
      sourceHost = imageUrl ? new URL(imageUrl).hostname : null;
    } catch {
      sourceHost = null;
    }
    await markReceived(claim.id, sourceHost);
    return { success: true, duplicate: false, safe_reply: SUCCESS_REPLY };
  } catch (error) {
    await markFailed(claim.id, error);
    throw error;
  }
}
