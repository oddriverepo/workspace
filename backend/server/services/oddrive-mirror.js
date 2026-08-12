import { ObjectId } from 'mongodb';
import { getLiveDb, DEFAULT_MAX_TIME_MS } from './oddrive-live-client.js';
import { getDb as getAppDb } from './mongo.js';
import { normalizeCampaign, normalizeDriver } from './oddrive-sync.js';

const MT = DEFAULT_MAX_TIME_MS;
const OBJECT_ID_PATTERN = /^[a-f0-9]{24}$/i;

const DRIVER_PROJ = {
  name: 1, email: 1, cpf: 1, phone: 1, address: 1, rating_app: 1,
  main_app_registered: 1, apps_registered: 1, operation_period: 1,
  operation_neighborhood: 1, indication_code: 1, how_meet_app: 1,
  who_indicated_app: 1, created_at: 1,
};
const DC_PROJ = {
  driver_id: 1, campaign_id: 1, vehicle_id: 1, current_campaign_status: 1,
  campaign_status: 1, created_at: 1, filial_id: 1,
};
const CAMP_PROJ = {
  title: 1, sponsor_id: 1, description: 1, sub_title: 1, period: 1,
  monthly_value: 1, total_investment: 1, city: 1, state: 1, terms: 1,
  meta_kms: 1, current_status: 1, campaign_link: 1, images: 1, links: 1,
  created_by: 1, created_at: 1, filial_id: 1,
};

const S = (v) => (v && v._bsontype === 'ObjectId') ? v.toString() : (v == null ? '' : String(v));

function idVariants(value) {
  const out = [String(value)];
  try { out.push(new ObjectId(String(value))); } catch {}
  return out;
}

export function resolveMirrorFilialIds(env = process.env) {
  const primary = String(env.ODDRIVE_FILIAL_ID || '').trim();
  const additional = String(env.MIRROR_FILIAL_IDS || '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  const configured = [primary, ...additional].filter(Boolean);
  const invalidCount = configured.filter((value) => !OBJECT_ID_PATTERN.test(value)).length;

  if (invalidCount) {
    const err = new Error(`Configuração do mirror contém ${invalidCount} filial(is) inválida(s); use IDs MongoDB com 24 caracteres hexadecimais.`);
    err.code = 'MIRROR_FILIAL_IDS_INVALID';
    throw err;
  }

  const ids = [...new Set(configured.map((value) => value.toLowerCase()))];
  if (!ids.length) {
    const err = new Error('Nenhuma filial configurada para o mirror. Defina ODDRIVE_FILIAL_ID e, opcionalmente, MIRROR_FILIAL_IDS.');
    err.code = 'MIRROR_FILIAL_IDS_MISSING';
    throw err;
  }
  return ids;
}

function filialFilter(filialIds) {
  return { filial_id: { $in: filialIds.flatMap(idVariants) } };
}

async function validateConfiguredFiliais(liveDb, filialIds) {
  const rows = await liveDb.collection('filiais')
    .find({ _id: { $in: filialIds.flatMap(idVariants) } }, { projection: { _id: 1, name: 1 } })
    .maxTimeMS(MT)
    .toArray();
  const found = new Set(rows.map((row) => S(row._id).toLowerCase()));
  const missingCount = filialIds.filter((id) => !found.has(id)).length;

  if (missingCount) {
    const err = new Error(`${missingCount} filial(is) configurada(s) não existem na coleção filiais; mirror cancelado antes da gravação.`);
    err.code = 'MIRROR_FILIAL_IDS_NOT_FOUND';
    throw err;
  }

  return new Map(rows.map((row) => [
    S(row._id).toLowerCase(),
    String(row.name || '').trim(),
  ]));
}

async function buildCampaigns(liveDb, filialIds, filialNameById) {
  const camps = await liveDb.collection('campaigns')
    .find(filialFilter(filialIds), { projection: CAMP_PROJ }).maxTimeMS(MT).toArray();

  const sponsorIds = [...new Set(camps.map((c) => c.sponsor_id).filter(Boolean).map(S))];
  const sponsorOr = sponsorIds.flatMap(idVariants);
  const sponsors = sponsorOr.length
    ? await liveDb.collection('sponsors')
        .find({ _id: { $in: sponsorOr } }, { projection: { name: 1 } }).maxTimeMS(MT).toArray()
    : [];
  const sponsorName = new Map(sponsors.map((s) => [S(s._id), s.name || '']));

  const filialIdSet = new Set(filialIds);
  const foreignFilial = camps.filter((c) => c.filial_id && !filialIdSet.has(S(c.filial_id).toLowerCase())).length;

  const toIso = (v) => (v instanceof Date ? v.toISOString() : (v ?? null));
  const normalized = camps.map((c) => {
    const apiShape = {
      ...c,
      _id: S(c._id),
      sponsor_id: c.sponsor_id ? S(c.sponsor_id) : '',
      created_by: c.created_by ? S(c.created_by) : '',
      created_at: toIso(c.created_at),
      period: {
        start: toIso(c.period && c.period.start),
        end: toIso(c.period && c.period.end),
      },
    };
    const norm = normalizeCampaign(apiShape);
    const filialId = S(c.filial_id).toLowerCase();
    norm.client = sponsorName.get(S(c.sponsor_id)) || '';
    norm.filialId = filialId;
    norm.filialName = filialNameById.get(filialId) || '';
    return norm;
  });
  return { normalized, foreignFilial };
}

async function buildDrivers(liveDb, filialIds, filialNameById) {
  const dcs = await liveDb.collection('driver_campaign')
    .find(filialFilter(filialIds), { projection: DC_PROJ }).maxTimeMS(MT).toArray();

  const dcByDriver = new Map();
  const tsOf = (dc) => {
    const cs = dc.campaign_status && typeof dc.campaign_status === 'object' ? dc.campaign_status : {};
    const stamps = Object.values(cs).map((v) => new Date(v).getTime()).filter(Number.isFinite);
    const maxStamp = stamps.length ? Math.max(...stamps) : new Date(dc.created_at || 0).getTime() || 0;
    return maxStamp;
  };
  for (const dc of dcs) {
    const key = S(dc.driver_id);
    const prev = dcByDriver.get(key);
    if (!prev) { dcByDriver.set(key, dc); continue; }
    const prevCurrent = prev.current_campaign_status === 'in_campaign';
    const curCurrent = dc.current_campaign_status === 'in_campaign';
    if (curCurrent && !prevCurrent) { dcByDriver.set(key, dc); continue; }
    if (curCurrent === prevCurrent && tsOf(dc) > tsOf(prev)) dcByDriver.set(key, dc);
  }

  const selectedDcs = [...dcByDriver.values()];
  const dcIdOids = selectedDcs.map((d) => d._id);
  const allDcIdOids = dcs.map((d) => d._id);
  const driverIdByDc = new Map(dcs.map((dc) => [S(dc._id), S(dc.driver_id)]));
  const vehicleOids = selectedDcs.map((d) => d.vehicle_id).filter(Boolean);

  const kmAgg = allDcIdOids.length
    ? await liveDb.collection('driver_routes_resume').aggregate([
        { $match: { driver_campaign_id: { $in: allDcIdOids } } },
        { $group: { _id: '$driver_campaign_id', km: { $sum: '$km_distance' } } },
      ], { maxTimeMS: MT, allowDiskUse: true }).toArray()
    : [];
  const kmByDc = new Map(kmAgg.map((r) => [S(r._id), r.km || 0]));
  const kmHistoricalByDriver = new Map();
  for (const row of kmAgg) {
    const driverId = driverIdByDc.get(S(row._id));
    if (!driverId) continue;
    kmHistoricalByDriver.set(driverId, (kmHistoricalByDriver.get(driverId) || 0) + (Number(row.km) || 0));
  }

  const scanAgg = await liveDb.collection('scans').aggregate([
    { $match: { driver_campaign_id: { $in: dcIdOids } } },
    { $group: { _id: '$driver_campaign_id', scans: { $sum: '$total_scans' } } },
  ], { maxTimeMS: MT, allowDiskUse: true }).toArray();
  const scansByDc = new Map(scanAgg.map((r) => [S(r._id), r.scans || 0]));

  const vehicles = vehicleOids.length
    ? await liveDb.collection('driver_vehicles')
        .find({ _id: { $in: vehicleOids } }, { projection: { plate: 1, vehicle_model: 1 } }).maxTimeMS(MT).toArray()
    : [];
  const plateByVehicle = new Map(vehicles.map((v) => [S(v._id), v.plate || '']));
  const modelByVehicle = new Map(vehicles.map((v) => [S(v._id), v.vehicle_model || '']));

  const fins = await liveDb.collection('driver_financial_settings')
    .find({}, { projection: { driver_id: 1, 'bank.pix': 1 } }).maxTimeMS(MT).toArray();
  const pixByDriver = new Map(fins.map((f) => [S(f.driver_id), (f.bank && f.bank.pix) || '']));

  const drivers = await liveDb.collection('drivers')
    .find({}, { projection: DRIVER_PROJ }).maxTimeMS(MT).toArray();

  const statusHist = {};
  let kmWithData = 0;
  const normalized = drivers.map((d) => {
    const dc = dcByDriver.get(S(d._id));
    const apiShape = {
      ...d,
      _id: S(d._id),
      pix: pixByDriver.get(S(d._id)) || '',
      avatar: '',
      kmHistoricalTotal: kmHistoricalByDriver.get(S(d._id)) || 0,
      campaign: dc ? {
        driver_campaign_id: S(dc._id),
        campaign_id: S(dc.campaign_id),
        current_campaign_status: dc.current_campaign_status || '',
        created_at: dc.created_at instanceof Date ? dc.created_at.toISOString() : (dc.created_at || null),
        vehicle_id: dc.vehicle_id ? S(dc.vehicle_id) : '',
        vehicle_plate: dc.vehicle_id ? (plateByVehicle.get(S(dc.vehicle_id)) || '') : '',
        vehicle_model: dc.vehicle_id ? (modelByVehicle.get(S(dc.vehicle_id)) || '') : '',
        totalKms: kmByDc.get(S(dc._id)) || 0,
        totalScans: scansByDc.get(S(dc._id)) || 0,
      } : null,
    };
    const norm = normalizeDriver(apiShape);
    if (dc && norm.campaignData) {
      const filialId = S(dc.filial_id).toLowerCase();
      norm.campaignData.filialId = filialId;
      norm.campaignData.filialName = filialNameById.get(filialId) || '';
    }
    statusHist[norm.status] = (statusHist[norm.status] || 0) + 1;
    if (norm.campaignData && norm.campaignData.totalKms > 0) kmWithData++;
    return norm;
  });

  return { normalized, statusHist, withCampaign: dcByDriver.size, kmWithData };
}

async function upsertAll(appDb, collName, docs, stamp) {
  if (!docs.length) return 0;
  const ops = docs.map((d) => ({
    replaceOne: {
      filter: { _id: d.id },
      replacement: { ...d, _id: d.id, _syncedAt: stamp },
      upsert: true,
    },
  }));
  const BATCH = 500;
  for (let i = 0; i < ops.length; i += BATCH) {
    await appDb.collection(collName).bulkWrite(ops.slice(i, i + BATCH), { ordered: false });
  }
  return docs.length;
}

async function pruneStale(appDb, collName, stamp, wroteCount) {
  if (!wroteCount) return 0;
  const res = await appDb.collection(collName).deleteMany({ _syncedAt: { $lt: stamp } });
  return res.deletedCount || 0;
}

export async function runMirrorOnce(opts = {}) {
  const { dryRun = false, log = console.log } = opts;
  const now = opts.now || Date.now();
  const start = Date.now();

  const campColl = dryRun ? 'api_campaigns_test' : 'api_campaigns';
  const drvColl = dryRun ? 'api_drivers_test' : 'api_drivers';

  let appDb;
  try {
    appDb = opts.appDb || await getAppDb();
  } catch (err) {
    log('[mirror] appDb indisponível, erro não registrável: ' + (err?.message || err));
    throw err;
  }

  let phase = 'configuration';
  try {
    log(`[mirror] início (${dryRun ? 'DRY-RUN → ' + campColl + '/' + drvColl : 'PROD'})`);
    const filialIds = resolveMirrorFilialIds();

    phase = 'connect';
    const liveDb = opts.liveDb || await getLiveDb();

    phase = 'validateFiliais';
    const filialNameById = await validateConfiguredFiliais(liveDb, filialIds);

    phase = 'buildCampaigns';
    const { normalized: campaigns, foreignFilial } = await buildCampaigns(liveDb, filialIds, filialNameById);
    phase = 'buildDrivers';
    const { normalized: drivers, statusHist, withCampaign, kmWithData } = await buildDrivers(liveDb, filialIds, filialNameById);

    phase = 'write';
    const stamp = start;
    const campCount = await upsertAll(appDb, campColl, campaigns, stamp);
    const drvCount = await upsertAll(appDb, drvColl, drivers, stamp);

    phase = 'prune';
    const prunedCampaigns = await pruneStale(appDb, campColl, stamp, campCount);
    const prunedDrivers = await pruneStale(appDb, drvColl, stamp, drvCount);

    const durationMs = Date.now() - start;
    const result = {
      dryRun, campaigns: campCount, drivers: drvCount, withCampaign, kmWithData,
      filialCount: filialIds.length,
      prunedCampaigns, prunedDrivers,
      foreignFilial, statusHist, durationMs, timestamp: now,
      collections: { campaigns: campColl, drivers: drvColl },
    };

    try {
      await appDb.collection('api_sync_log').insertOne({
        _id: new Date(now).toISOString() + (dryRun ? '-dryrun' : ''),
        type: dryRun ? 'mirror-dryrun' : 'mirror',
        source: 'oddrive-mirror.js',
        campaigns: campCount, drivers: drvCount, driversWithCampaign: withCampaign, kmWithData,
        filialCount: filialIds.length,
        foreignFilial, statusHist, durationMs, timestamp: now,
      });
    } catch (err) {
      log('[mirror] aviso: falha ao gravar api_sync_log: ' + (err?.message || err));
    }

    if (foreignFilial > 0) log(`[mirror] ${foreignFilial} campanhas com filial_id estranho`);
    log(`[mirror] fim: ${campCount} campanhas, ${drvCount} motoristas, ${filialIds.length} filial(is) (${withCampaign} com campanha, ${kmWithData} com km) em ${durationMs}ms`);
    return result;
  } catch (err) {
    const durationMs = Date.now() - start;
    log(`[mirror] erro em ${phase}: ${err?.message || err}`);
    try {
      await appDb.collection('api_sync_log').insertOne({
        type: 'mirror-error',
        source: 'oddrive-mirror.js',
        dryRun,
        phase,
        error: String(err?.message || err),
        code: err?.code || err?.codeName || null,
        stack: String(err?.stack || '').split('\n').slice(0, 4).join(' | '),
        durationMs,
        timestamp: Date.now(),
      });
    } catch (logErr) {
      log('[mirror] falha ao registrar mirror-error: ' + (logErr?.message || logErr));
    }
    throw err;
  }
}

let timer = null;

export function startMirrorScheduler({ log = console.log } = {}) {
  if (process.env.MIRROR_ENABLED !== '1') {
    log('[mirror] desabilitado (MIRROR_ENABLED != 1)');
    return null;
  }
  const minutes = Math.max(1, Number(process.env.MIRROR_INTERVAL_MIN) || 2);
  const intervalMs = minutes * 60 * 1000;
  const tick = () => runMirrorOnce({ log }).catch((e) => log('[mirror] erro no ciclo: ' + (e?.message || e)));
  tick();
  timer = setInterval(tick, intervalMs);
  if (timer.unref) timer.unref();
  log(`[mirror] scheduler ativo (intervalo ${minutes}min)`);
  return timer;
}

export function stopMirrorScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
}
