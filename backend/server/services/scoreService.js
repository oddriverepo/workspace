/**
 * scoreService.js
 *
 * Serviço de pontuação de motoristas.
 * computeScore() é chamado on-demand pelo GET /api/driver-scores/:phone.
 */

import { fetchDrivers, fetchCampaigns } from './db.js';
import { getDb, getCampaignSettingsByIds } from './mongo.js';
import { scoreDriverCampaign, aggregateDriverScore } from '../lib/score-engine.js';

/**
 * Computa a pontuação de um motorista sem persistir.
 *
 * @param {string} phone - Telefone normalizado
 */
export async function computeScore(phone) {
  const suffix = phone.slice(-9);
  const allDrivers = await fetchDrivers();
  const driverDocs = allDrivers.filter(d => {
    const dPhone = (d.phoneDigits || d.phone || '').replace(/\D/g, '');
    return dPhone.slice(-9) === suffix;
  });

  if (!driverDocs.length) return { score: null, campaignScores: [] };

  const allCampaigns = await fetchCampaigns();
  const campaignIds = [...new Set(driverDocs.map(d => d.campaignId).filter(Boolean))];
  const settingsMap = await getCampaignSettingsByIds(campaignIds);
  const db = await getDb();
  const campaignScores = [];

  for (const driver of driverDocs) {
    if (!driver.campaignId) continue;
    const campaign = allCampaigns.find(c => c._id === driver.campaignId || c.id === driver.campaignId);
    if (!campaign) continue;

    const settings = settingsMap.get(String(driver.campaignId)) || {};

    const [bookings, storageEntries] = await Promise.all([
      db.collection('scheduling_bookings').find({
        campaignId: driver.campaignId,
        $or: [
          { driverPhone: { $regex: suffix + '$' } },
          { driverId: String(driver._id || driver.id) },
        ],
      }).toArray().catch(() => []),
      db.collection('storage_files').find({
        driverId: String(driver._id || driver.id),
      }).toArray().catch(() => []),
    ]);

    const result = scoreDriverCampaign(driver, campaign, bookings, storageEntries, settings);
    if (!result.skipped) {
      campaignScores.push({
        campaignId: driver.campaignId,
        campaignName: campaign.name || '',
        weightedScore: result.weightedScore,
        components: result.components,
      });
    }
  }

  const score = aggregateDriverScore(campaignScores);
  return { score, campaignScores };
}
