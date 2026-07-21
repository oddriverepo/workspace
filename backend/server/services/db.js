/**
 * backend/services/db.js
 *
 * Camada de dados unificada:
 * - MongoDB (mongo.js) para dados locais (evidence, storage, admin, graphics, audit)
 * - MongoDB (oddrive-sync.js) para campanhas e motoristas (escrita via sync-push externo)
 */

import * as mongo from './mongo.js';
import * as sync from './oddrive-sync.js';

// ── MongoDB: dados locais (evidence, storage, admin, graphics) ──
export const {
  uploadBase64ImageMongo,
  upsertCampaignRecord,
  upsertDriverRecord,
  insertEvidenceRecord,
  listOdometerEvidenceByCampaign,
  deleteEvidenceRecord,
  deleteStorageFile,
  deleteStorageFilesByFolder,
  upsertMasterRecord,
  deleteMastersByCampaign,
  deleteAllCampaignData,
  deleteMasterByDriver,
  ensureDatabaseSchema,
  getCampaignTableName,
  ensureCampaignMasterTable,
  upsertCampaignMasterRows,
  getCampaignGraphicsTableName,
  ensureCampaignGraphicsTable,
  upsertCampaignGraphicsRows,
  deleteCampaignGraphicsTable,
  deleteGraphicRow,
  getDriverStorageBasePath,
  listDriverStorageTree,
  listStorageEntriesByCampaign,
  getDriverLastActivityByCampaign,
  getUploadHeatmapByCampaign,
  findDriverByIdentityMongo,
  listCampaignDriversRecords,
  getCampaignRecordById,
  findCampaignByCodeMongo,
  listCampaignGraphicsRecords,
  findDriverRowInMasterTables,
  findAdminUserByUsername,
  createAdminUser,
  listAdminUsers,
  updateAdminUser,
  findAdminUserById,
  insertAuditLog,
  listAuditLogs,
  clearAllAuditLogs,
  listCampaignHistory,
  detachCampaignDriver,
  restoreCampaignDriver,
  listCampaignDriverDetachments,
  listDetachedDriverIdsByCampaign,
  isCampaignDriverDetached,
} = mongo;

// ── Campanhas e Motoristas: leitura do MongoDB (populado pelo sync) ──
export async function fetchCampaigns() {
  return sync.readCampaigns();
}

export async function fetchCampaignById(campaignId) {
  return sync.readCampaignById(campaignId);
}

function campaignDriverPairKey(campaignId, driverId) {
  return `${String(campaignId || '').trim()}:${String(driverId || '').trim()}`;
}

function driverCampaignAssignmentId(driver) {
  return String(
    driver?.campaignData?.driverCampaignId || driver?.driverCampaignId || '',
  ).trim();
}

function detachmentMatchesDriver(detachment, driver) {
  if (!detachment || !driver) return false;
  const detachedAssignmentId = String(detachment.driverCampaignId || '').trim();
  const currentAssignmentId = driverCampaignAssignmentId(driver);
  return !detachedAssignmentId || !currentAssignmentId || detachedAssignmentId === currentAssignmentId;
}

async function loadDetachedCampaignDriverPairs(drivers = []) {
  const campaignIds = Array.from(new Set(
    drivers.map(driver => String(driver?.campaignId || '').trim()).filter(Boolean),
  ));
  if (!campaignIds.length) return new Map();
  const docs = await mongo.listCampaignDriverDetachments(campaignIds);
  return new Map(docs.map(doc => [campaignDriverPairKey(doc.campaignId, doc.driverId), doc]));
}

function applyDetachedDriverView(driver, detachedPairs) {
  if (!driver?.campaignId) return driver;
  const pair = campaignDriverPairKey(driver.campaignId, driver.id);
  const detachment = detachedPairs.get(pair);
  if (!detachmentMatchesDriver(detachment, driver)) return driver;
  return {
    ...driver,
    campaignId: null,
    status: 'cadastrando',
    statusRaw: '',
    detachedFromCampaignId: String(driver.campaignId),
    campaignData: driver.campaignData
      ? { ...driver.campaignData, detached: true }
      : null,
  };
}

async function applyCurrentCampaignDetachments(drivers = []) {
  const detachedPairs = await loadDetachedCampaignDriverPairs(drivers);
  if (!detachedPairs.size) return drivers;
  return drivers.map(driver => applyDetachedDriverView(driver, detachedPairs));
}

export async function fetchDrivers() {
  return applyCurrentCampaignDetachments(await sync.readDrivers());
}

export async function fetchDriversByCampaign(campaignId) {
  const drivers = await sync.readDriversByCampaign(campaignId);
  return filterDetachedCampaignDrivers(campaignId, drivers);
}

export async function filterDetachedCampaignDrivers(campaignId, drivers = []) {
  const normalizedCampaignId = String(campaignId || '').trim();
  if (!normalizedCampaignId || !Array.isArray(drivers) || !drivers.length) return drivers;
  const docs = await mongo.listCampaignDriverDetachments([normalizedCampaignId]);
  if (!docs.length) return drivers;
  const byDriverId = new Map(
    docs.map(doc => [String(doc.driverId || '').trim(), doc]),
  );
  return drivers.filter(driver => {
    const detachment = byDriverId.get(String(driver?.id || '').trim());
    return !detachmentMatchesDriver(detachment, driver);
  });
}

export async function fetchDriversByCampaignPeriod(campaignId, periodStart, periodEnd) {
  // Lê do MongoDB — sem chamar API. O período é ignorado porque os dados
  // já foram sincronizados previamente pelo script externo.
  return fetchDriversByCampaign(campaignId);
}

export async function fetchDriverById(driverId) {
  const driver = await sync.readDriverById(driverId);
  if (!driver) return null;
  return (await applyCurrentCampaignDetachments([driver]))[0] || null;
}

export async function findDriverByIdentity(identity) {
  const driver = await sync.readDriverByIdentity(identity);
  if (!driver) return null;
  return (await applyCurrentCampaignDetachments([driver]))[0] || null;
}

export async function findDriverByPhone(phone) {
  const driver = await sync.readDriverByPhone(phone);
  if (!driver) return null;
  return (await applyCurrentCampaignDetachments([driver]))[0] || null;
}

// ── Sync: dados vêm via script externo (POST /api/campaigns/sync-push) ──

export async function getSyncStatus() {
  return sync.getSyncStatus();
}

export async function getCacheStatus() {
  return sync.getSyncStatus();
}

export async function getSyncHistory(limit) {
  return sync.getSyncHistory(limit);
}

// ── Bootstrap: criar índices na inicialização ──
export const ensureSyncIndexes = sync.ensureSyncIndexes;
export const hasMongoData = sync.hasMongoData;

export default mongo;
