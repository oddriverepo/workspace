/**
 * MongoDB Client para funções do Gerador de Orçamentos
 * (propostas + solicitações de representantes)
 * Reutiliza a conexão MongoDB do gerenciador de campanhas (mongo.js)
 * Convertido de CJS para ESM
 */
import { getDb } from './mongo.js';

const REPRESENTATIVE_REQUESTS_COLLECTION = 'representative_requests';
const PROPOSALS_COLLECTION = 'proposals';

// Re-export getDb para uso externo
export { getDb };

// ============================================
// Solicitações de Representantes
// ============================================

export async function createRepresentativeRequest(requestData) {
  const database = await getDb();
  const now = new Date();
  const doc = { ...requestData, createdAt: now, updatedAt: now };
  const result = await database.collection(REPRESENTATIVE_REQUESTS_COLLECTION).insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

export async function listRepresentativeRequests() {
  const database = await getDb();
  return database.collection(REPRESENTATIVE_REQUESTS_COLLECTION)
    .find({}).sort({ createdAt: -1 }).toArray();
}

export async function getRepresentativeRequestById(requestId) {
  const database = await getDb();
  return database.collection(REPRESENTATIVE_REQUESTS_COLLECTION).findOne({ id: requestId });
}

export async function updateRepresentativeRequestStatus(requestId, status) {
  const database = await getDb();
  const result = await database.collection(REPRESENTATIVE_REQUESTS_COLLECTION)
    .updateOne({ id: requestId }, { $set: { status, updatedAt: new Date() } });
  if (result.matchedCount === 0) throw new Error('Solicitação não encontrada');
  return getRepresentativeRequestById(requestId);
}

export async function updateRepresentativeRequest(requestId, updates) {
  const database = await getDb();
  const result = await database.collection(REPRESENTATIVE_REQUESTS_COLLECTION)
    .updateOne({ id: requestId }, { $set: { ...updates, updatedAt: new Date() } });
  if (result.matchedCount === 0) throw new Error('Solicitação não encontrada');
  return getRepresentativeRequestById(requestId);
}

export async function deleteRepresentativeRequest(requestId) {
  const database = await getDb();
  const result = await database.collection(REPRESENTATIVE_REQUESTS_COLLECTION).deleteOne({ id: requestId });
  return result.deletedCount > 0;
}

// ============================================
// Propostas (Orçamentos)
// ============================================

export async function createProposal(proposalData) {
  const database = await getDb();
  const now = new Date();

  const allowedFields = [
    'id', 'status', 'cliente', 'comercial', 'uploads', 'produtosSelecionados',
    'orcamentos', 'uploadDriveUrls', 'googlePresentationId', 'googlePresentationUrl',
    'generatedAt', 'generatedPdfPath',
    'fonte', 'requestStatus', 'representante', 'notes', 'observacoes',
  ];
  const sanitized = {};
  for (const key of allowedFields) {
    if (key in proposalData) sanitized[key] = proposalData[key];
  }

  const uploadsMetadata = {};
  if (sanitized.uploads) {
    for (const [key, file] of Object.entries(sanitized.uploads)) {
      if (file && typeof file === 'object') {
        uploadsMetadata[key] = {
          name: file.name, type: file.type, size: file.size, lastModified: file.lastModified,
        };
      }
    }
  }

  const doc = {
    ...sanitized,
    uploads: uploadsMetadata,
    id: sanitized?.id || Date.now().toString(),
    createdAt: now,
    updatedAt: now,
    status: sanitized?.status || 'draft',
  };
  const result = await database.collection(PROPOSALS_COLLECTION).insertOne(doc);
  return { ...doc, _id: result.insertedId };
}

export async function listProposals() {
  const database = await getDb();
  return database.collection(PROPOSALS_COLLECTION).find({}).sort({ createdAt: -1 }).toArray();
}

export async function getProposalById(proposalId) {
  const database = await getDb();
  return database.collection(PROPOSALS_COLLECTION).findOne({ id: proposalId });
}

export async function updateProposal(proposalId, updates) {
  const database = await getDb();

  const allowedUpdateFields = [
    'status', 'cliente', 'comercial', 'uploads', 'produtosSelecionados',
    'orcamentos', 'uploadDriveUrls', 'googlePresentationId', 'googlePresentationUrl',
    'generatedAt', 'generatedPdfPath',
    'fonte', 'requestStatus', 'representante', 'notes', 'observacoes',
  ];
  const safeUpdates = {};
  for (const key of allowedUpdateFields) {
    if (key in updates) safeUpdates[key] = updates[key];
  }

  const uploadsMetadata = {};
  if (safeUpdates.uploads) {
    for (const [key, file] of Object.entries(safeUpdates.uploads)) {
      if (file && typeof file === 'object') {
        uploadsMetadata[key] = {
          name: file.name, type: file.type, size: file.size, lastModified: file.lastModified,
        };
      }
    }
  }

  const sanitizedUpdates = { ...safeUpdates, uploads: uploadsMetadata };
  // Remove _id para evitar erro "cannot modify immutable field '_id'"
  delete sanitizedUpdates._id;
  const result = await database.collection(PROPOSALS_COLLECTION)
    .updateOne({ id: proposalId }, { $set: { ...sanitizedUpdates, updatedAt: new Date() } });
  if (result.matchedCount === 0) throw new Error('Proposta não encontrada');
  return getProposalById(proposalId);
}

export async function deleteProposal(proposalId) {
  const database = await getDb();
  const result = await database.collection(PROPOSALS_COLLECTION).deleteOne({ id: proposalId });
  return result.deletedCount > 0;
}
