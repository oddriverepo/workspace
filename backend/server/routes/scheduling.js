/**
 * scheduling.js — Backend routes for the graphic scheduling system
 *
 * Collections:
 *   scheduling_configs   — slot configurations set by the admin (periods + time ranges)
 *   scheduling_slots     — individual time slots generated from configs
 *   scheduling_bookings  — driver reservations
 *
 * Route prefix: /api/scheduling  (mounted in index.js)
 */

import { Router } from 'express';
import crypto from 'crypto';
import { authenticateAdmin } from '../middleware/authenticate-admin.js';
import { authenticateSession } from '../middleware/authenticate-session.js';
import { getDb } from '../services/mongo.js';
import { loadLegacyDb } from '../services/legacyStore.js';

// Try to import sendTextMessage from disparador — if not available, notifications will silently skip
let sendTextMessage = null;
try {
  const metaClient = await import('../disparador/services/meta-client.js');
  sendTextMessage = metaClient.sendTextMessage;
} catch {
  console.warn('[scheduling] meta-client not available — WhatsApp notifications disabled');
}

const router = Router();

const COL_CONFIGS  = 'scheduling_configs';
const COL_SLOTS    = 'scheduling_slots';
const COL_BOOKINGS = 'scheduling_bookings';

function validatePortalScope(req, res, allowedTypes = []) {
  const session = req.userSession || {};
  if (allowedTypes.length && !allowedTypes.includes(session.type)) {
    res.status(403).json({ error: 'Perfil nao autorizado.' });
    return false;
  }
  if (String(session.campaignId || '') !== String(req.params.campaignId || '')) {
    res.status(403).json({ error: 'Acesso nao autorizado para esta campanha.' });
    return false;
  }
  return true;
}

// ══════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════

function generateId() {
  // CSPRNG: 12 bytes → 16 chars base64url, sem colisões previsíveis.
  return Date.now().toString(36) + crypto.randomBytes(6).toString('hex');
}

function parseIsoDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const timestamp = Date.parse(`${text}T00:00:00.000Z`);
  if (!Number.isFinite(timestamp)) return null;
  return new Date(timestamp).toISOString().slice(0, 10) === text ? timestamp : null;
}

function timeToMinutes(value) {
  const match = String(value || '').match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function validateConfigInput({ dateStart, dateEnd, slotDurationMinutes, timeRanges }) {
  const startAt = parseIsoDate(dateStart);
  const endAt = parseIsoDate(dateEnd);
  if (startAt === null || endAt === null || endAt < startAt) {
    return { error: 'Periodo de datas invalido.' };
  }
  if ((endAt - startAt) / 86400000 > 366) {
    return { error: 'O periodo nao pode ultrapassar 366 dias.' };
  }

  const duration = Number(slotDurationMinutes);
  if (!Number.isInteger(duration) || duration < 5 || duration > 480) {
    return { error: 'Duracao de horario invalida.' };
  }
  if (!Array.isArray(timeRanges) || !timeRanges.length || timeRanges.length > 20) {
    return { error: 'Informe entre 1 e 20 faixas de horario.' };
  }

  const ranges = [];
  for (const range of timeRanges) {
    const start = timeToMinutes(range?.start);
    const end = timeToMinutes(range?.end);
    if (start === null || end === null || end <= start || end - start < duration) {
      return { error: 'Faixa de horario invalida ou menor que a duracao selecionada.' };
    }
    ranges.push({ start: range.start, end: range.end });
  }
  return { duration, ranges };
}

/**
 * Given a config block, generate individual slot documents.
 * Each slot = one bookable time window on a specific date.
 */
function generateSlotsFromConfig(config) {
  const slots = [];
  const generatedKeys = new Set();
  const startDate = new Date(config.dateStart + 'T00:00:00');
  const endDate = new Date(config.dateEnd + 'T23:59:59');

  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().slice(0, 10); // "YYYY-MM-DD"

    for (const range of config.timeRanges) {
      const [startH, startM] = range.start.split(':').map(Number);
      const [endH, endM] = range.end.split(':').map(Number);
      const rangeStartMin = startH * 60 + startM;
      const rangeEndMin = endH * 60 + endM;
      const interval = config.slotDurationMinutes || 60;

      for (let min = rangeStartMin; min + interval <= rangeEndMin; min += interval) {
        const slotStart = `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
        const slotEnd = `${String(Math.floor((min + interval) / 60)).padStart(2, '0')}:${String((min + interval) % 60).padStart(2, '0')}`;
        const slotKey = `${dateStr}|${slotStart}|${slotEnd}`;
        if (generatedKeys.has(slotKey)) continue;
        generatedKeys.add(slotKey);

        slots.push({
          _id: generateId(),
          configId: config._id,
          campaignId: config.campaignId,
          graphicId: config.graphicId,
          type: config.type, // 'installation' or 'removal'
          date: dateStr,
          startTime: slotStart,
          endTime: slotEnd,
          status: 'available', // available | booked | cancelled
          bookedBy: null,
          bookedByName: null,
          bookedAt: null,
          createdAt: Date.now(),
        });
      }
    }
  }

  return slots;
}

// ══════════════════════════════════════════
//  ENSURE INDEXES
// ══════════════════════════════════════════

let indexesCreated = false;
async function ensureIndexes() {
  if (indexesCreated) return true;
  const db = await getDb();
  try {
    await db.collection(COL_SLOTS).createIndex({ campaignId: 1, graphicId: 1, date: 1 });
    await db.collection(COL_SLOTS).createIndex({ campaignId: 1, status: 1, type: 1 });
    await db.collection(COL_BOOKINGS).createIndex({ campaignId: 1, driverId: 1 });
    await db.collection(COL_BOOKINGS).createIndex({ campaignId: 1, graphicId: 1 });
    await db.collection(COL_BOOKINGS).createIndex({ slotId: 1, status: 1 });
    await db.collection(COL_BOOKINGS).createIndex(
      { campaignId: 1, driverId: 1, type: 1 },
      {
        unique: true,
        name: 'uniq_confirmed_booking_per_driver_type',
        partialFilterExpression: { status: 'confirmed' },
      },
    );
    await db.collection(COL_CONFIGS).createIndex({ campaignId: 1, graphicId: 1 });
    indexesCreated = true;
    return true;
  } catch (err) {
    console.warn('[scheduling] index creation error:', err?.message);
    return false;
  }
}

// ══════════════════════════════════════════
//  RECENT BOOKINGS (workspace overview card)
// ══════════════════════════════════════════

/**
 * GET /api/scheduling/overview/recent-bookings
 * Returns the most recent confirmed bookings across all campaigns.
 * Used by the workspace "Visão Operacional" dashboard.
 * IMPORTANT: Must be declared BEFORE :campaignId routes to avoid param conflict.
 */
router.get('/overview/recent-bookings', authenticateAdmin, async (req, res) => {
  try {
    await ensureIndexes();
    const db = await getDb();

    const bookings = await db.collection(COL_BOOKINGS)
      .find({ status: 'confirmed' })
      .sort({ createdAt: -1 })
      .limit(20)
      .toArray();

    if (!bookings.length) {
      return res.json({ bookings: [] });
    }

    // Resolve campaign + graphic names from legacy store
    const legacyDb = loadLegacyDb();
    const campaignsMap = {};
    for (const c of (legacyDb.campaigns || [])) {
      campaignsMap[c.id] = c;
    }

    const enriched = bookings.map(b => {
      const campaign = campaignsMap[b.campaignId];
      const campaignName = campaign?.name || b.campaignId || '—';
      const graphics = Array.isArray(campaign?.graphics) ? campaign.graphics : [];
      const graphic = graphics.find(g => g.id === b.graphicId);
      const graphicName = graphic?.name || '—';
      const [y, m, d] = (b.date || '').split('-');
      const dateBR = (y && m && d) ? `${d}/${m}/${y}` : b.date || '—';

      return {
        _id: b._id,
        campaignId: b.campaignId,
        campaignName,
        graphicName,
        driverName: b.driverName || 'Motorista',
        type: b.type,
        date: b.date,
        dateBR,
        startTime: b.startTime,
        endTime: b.endTime,
        createdAt: b.createdAt,
      };
    });

    res.json({ bookings: enriched });
  } catch (err) {
    console.error('[scheduling:recent-bookings]', err);
    res.status(500).json({ error: 'Erro ao carregar reservas recentes.' });
  }
});

// ══════════════════════════════════════════
//  ADMIN ROUTES (Gerenciador)
// ══════════════════════════════════════════

/**
 * GET /api/scheduling/:campaignId/graphics/:graphicId/configs
 * List all scheduling configs for a graphic
 */
router.get('/:campaignId/graphics/:graphicId/configs', authenticateAdmin, async (req, res) => {
  await ensureIndexes();
  const db = await getDb();
  const configs = await db.collection(COL_CONFIGS)
    .find({ campaignId: req.params.campaignId, graphicId: req.params.graphicId })
    .sort({ dateStart: 1 })
    .toArray();
  res.json({ configs });
});

/**
 * POST /api/scheduling/:campaignId/graphics/:graphicId/configs
 * Create a new scheduling config block and auto-generate slots
 *
 * Body: {
 *   type: 'installation' | 'removal',
 *   dateStart: 'YYYY-MM-DD',
 *   dateEnd: 'YYYY-MM-DD',
 *   slotDurationMinutes: 60,
 *   timeRanges: [ { start: 'HH:MM', end: 'HH:MM' }, ... ]
 * }
 */
router.post('/:campaignId/graphics/:graphicId/configs', authenticateAdmin, async (req, res) => {
  await ensureIndexes();
  const { type, dateStart, dateEnd, slotDurationMinutes, timeRanges } = req.body || {};

  if (!type || !['installation', 'removal'].includes(type)) {
    return res.status(400).json({ error: 'Tipo inválido. Use "installation" ou "removal".' });
  }
  const validation = validateConfigInput({ dateStart, dateEnd, slotDurationMinutes, timeRanges });
  if (validation.error) return res.status(400).json({ error: validation.error });

  if (!dateStart || !dateEnd) {
    return res.status(400).json({ error: 'Datas obrigatórias (dateStart, dateEnd).' });
  }
  if (!Array.isArray(timeRanges) || !timeRanges.length) {
    return res.status(400).json({ error: 'Pelo menos uma faixa de horário obrigatória.' });
  }

  const config = {
    _id: generateId(),
    campaignId: req.params.campaignId,
    graphicId: req.params.graphicId,
    type,
    dateStart,
    dateEnd,
    slotDurationMinutes: validation.duration,
    timeRanges: validation.ranges,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const slots = generateSlotsFromConfig(config);
  if (!slots.length || slots.length > 10000) {
    return res.status(400).json({ error: 'A configuracao deve gerar entre 1 e 10000 horarios.' });
  }

  const db = await getDb();
  await db.collection(COL_CONFIGS).insertOne(config);
  if (slots.length) {
    await db.collection(COL_SLOTS).insertMany(slots);
  }

  res.status(201).json({ config, slotsGenerated: slots.length });
});

/**
 * DELETE /api/scheduling/:campaignId/graphics/:graphicId/configs/:configId
 * Delete a config and all its non-booked slots. Booked slots become cancelled.
 */
router.delete('/:campaignId/graphics/:graphicId/configs/:configId', authenticateAdmin, async (req, res) => {
  const db = await getDb();
  const configId = req.params.configId;

  // Cancel booked slots (don't delete them — preserve booking history)
  await db.collection(COL_SLOTS).updateMany(
    { configId, status: 'booked' },
    { $set: { status: 'cancelled', cancelledAt: Date.now(), cancelledBy: 'admin' } },
  );

  // Delete available (unbooked) slots
  await db.collection(COL_SLOTS).deleteMany({ configId, status: 'available' });

  // Cancel associated bookings
  await db.collection(COL_BOOKINGS).updateMany(
    { configId },
    { $set: { status: 'cancelled', cancelledAt: Date.now(), cancelledBy: 'admin' } },
  );

  // Delete config
  await db.collection(COL_CONFIGS).deleteOne({ _id: configId });

  res.json({ ok: true });
});

/**
 * GET /api/scheduling/:campaignId/graphics/:graphicId/slots
 * List all slots for a graphic (admin view — shows all statuses)
 * Query: ?type=installation|removal&date=YYYY-MM-DD
 */
router.get('/:campaignId/graphics/:graphicId/slots', authenticateAdmin, async (req, res) => {
  await ensureIndexes();
  const db = await getDb();
  const query = {
    campaignId: req.params.campaignId,
    graphicId: req.params.graphicId,
  };
  if (req.query.type) query.type = req.query.type;
  if (req.query.date) query.date = req.query.date;

  const slots = await db.collection(COL_SLOTS)
    .find(query)
    .sort({ date: 1, startTime: 1 })
    .toArray();
  res.json({ slots });
});

/**
 * GET /api/scheduling/:campaignId/bookings
 * All bookings for a campaign (admin view)
 */
router.get('/:campaignId/bookings', authenticateAdmin, async (req, res) => {
  await ensureIndexes();
  const db = await getDb();
  const bookings = await db.collection(COL_BOOKINGS)
    .find({ campaignId: req.params.campaignId })
    .sort({ createdAt: -1 })
    .toArray();
  res.json({ bookings });
});

// ══════════════════════════════════════════
//  PUBLIC ROUTES (Driver + Graphic portals)
// ══════════════════════════════════════════

/**
 * GET /api/scheduling/:campaignId/available
 * List available slots for a campaign (driver view — only available ones)
 * Query: ?type=installation|removal
 */
router.get('/:campaignId/available', authenticateSession, async (req, res) => {
  if (!validatePortalScope(req, res, ['driver'])) return;
  await ensureIndexes();
  const db = await getDb();
  const query = {
    campaignId: req.params.campaignId,
    status: 'available',
    date: { $gte: new Date().toISOString().slice(0, 10) }, // only future/today
  };
  if (req.query.type) query.type = req.query.type;

  const slots = await db.collection(COL_SLOTS)
    .find(query)
    .sort({ date: 1, startTime: 1 })
    .toArray();

  // Group by graphic for the driver to see per-gráfica
  const graphicIds = [...new Set(slots.map(s => s.graphicId))];

  // Fetch graphic names from the legacy store (where graphics actually live)
  const graphicsMap = {};
  if (graphicIds.length) {
    const legacyDb = loadLegacyDb();
    const campaign = (legacyDb.campaigns || []).find(c => c.id === req.params.campaignId);
    const allGraphics = Array.isArray(campaign?.graphics) ? campaign.graphics : [];
    allGraphics.forEach(g => { if (graphicIds.includes(g.id)) graphicsMap[g.id] = g; });
  }

  const grouped = {};
  for (const slot of slots) {
    const gId = slot.graphicId;
    if (!grouped[gId]) {
      const g = graphicsMap[gId];
      grouped[gId] = {
        graphicId: gId,
        graphicName: g?.name || g?.['GRAFICA NOME'] || '—',
        slots: [],
      };
    }
    grouped[gId].slots.push({
      _id: slot._id,
      type: slot.type,
      date: slot.date,
      startTime: slot.startTime,
      endTime: slot.endTime,
    });
  }

  res.json({ graphics: Object.values(grouped) });
});

/**
 * POST /api/scheduling/:campaignId/book
 * Driver books a slot
 * Body: { slotId, driverId, driverName, driverPhone, driverPlate }
 */
router.post('/:campaignId/book', authenticateSession, async (req, res) => {
  if (!validatePortalScope(req, res, ['driver'])) return;
  const indexesReady = await ensureIndexes();
  if (!indexesReady) {
    return res.status(503).json({ error: 'Agendamento temporariamente indisponivel. Tente novamente.' });
  }
  // SECURITY: driverId must come from the authenticated session, never from the body.
  // Accepting driverId from req.body would allow any logged-in driver to book a slot
  // on behalf of a different driver (IDOR).
  const driverId = req.userSession.userId;
  const { slotId, driverName, driverPhone, driverPlate } = req.body || {};

  if (!slotId) {
    return res.status(400).json({ error: 'slotId é obrigatório.' });
  }

  const db = await getDb();

  // Atomic update: only book if still available
  const result = await db.collection(COL_SLOTS).findOneAndUpdate(
    { _id: slotId, campaignId: req.params.campaignId, status: 'available' },
    {
      $set: {
        status: 'booked',
        bookedBy: driverId,
        bookedByName: req.userSession.name || null,
        bookedAt: Date.now(),
      },
    },
    { returnDocument: 'after' },
  );

  const slot = result?.value || result;
  if (!slot || slot.status !== 'booked') {
    return res.status(409).json({ error: 'Horário não está mais disponível.' });
  }

  // Check if driver already has a booking of the same type for this campaign
  const existingBooking = await db.collection(COL_BOOKINGS).findOne({
    campaignId: req.params.campaignId,
    driverId,
    type: slot.type,
    status: 'confirmed',
  });

  if (existingBooking) {
    // Revert the slot booking
    await db.collection(COL_SLOTS).updateOne(
      { _id: slotId, campaignId: req.params.campaignId, bookedBy: driverId },
      { $set: { status: 'available', bookedBy: null, bookedByName: null, bookedAt: null } },
    );
    return res.status(409).json({
      error: `Você já tem um agendamento de ${slot.type === 'installation' ? 'instalação' : 'retirada'} confirmado.`,
      existingBooking,
    });
  }

  // Create booking record
  const booking = {
    _id: generateId(),
    slotId: slot._id,
    configId: slot.configId,
    campaignId: req.params.campaignId,
    graphicId: slot.graphicId,
    driverId,
    driverName: req.userSession.name || driverName || null,
    driverPhone: driverPhone || null,
    driverPlate: driverPlate || null,
    type: slot.type,
    date: slot.date,
    startTime: slot.startTime,
    endTime: slot.endTime,
    status: 'confirmed',
    createdAt: Date.now(),
  };

  try {
    await db.collection(COL_BOOKINGS).insertOne(booking);
  } catch (err) {
    await db.collection(COL_SLOTS).updateOne(
      { _id: slotId, bookedBy: driverId },
      { $set: { status: 'available', bookedBy: null, bookedByName: null, bookedAt: null } },
    );
    if (err?.code === 11000) {
      return res.status(409).json({ error: 'Voce ja possui um agendamento confirmado deste tipo.' });
    }
    console.error('[scheduling] booking insert error:', err?.message || err);
    return res.status(500).json({ error: 'Nao foi possivel concluir o agendamento.' });
  }

  // Auto-fill driver's adhesion schedule fields
  syncBookingToDriverSchedule(db, booking).catch(err => {
    console.warn('[scheduling] schedule sync error:', err?.message);
  });

  // Send WhatsApp notification to graphic
  notifyGraphicOfBooking(db, booking).catch(err => {
    console.warn('[scheduling] notification error:', err?.message);
  });

  res.status(201).json({ booking, slot });
});

/**
 * DELETE /api/scheduling/:campaignId/book/:bookingId
 * Driver cancels a booking
 * Body: { driverId }
 */
router.delete('/:campaignId/book/:bookingId', authenticateSession, async (req, res) => {
  if (!validatePortalScope(req, res, ['driver'])) return;
  // SECURITY: enforce that the cancelling user owns the booking.
  // Using req.userSession.userId (server-authoritative) instead of req.body.driverId
  // (user-controlled) prevents IDOR cancellation of other drivers' bookings.
  const driverId = req.userSession.userId;

  const db = await getDb();
  const result = await db.collection(COL_BOOKINGS).findOneAndUpdate(
    {
      _id: req.params.bookingId,
      campaignId: req.params.campaignId,
      driverId,
      status: 'confirmed',
    },
    { $set: { status: 'cancelled', cancelledAt: Date.now(), cancelledBy: 'driver' } },
    { returnDocument: 'before' },
  );
  const booking = result?.value || result;

  if (!booking) {
    return res.status(404).json({ error: 'Reserva não encontrada ou já cancelada.' });
  }

  // Free the slot back to available
  await db.collection(COL_SLOTS).updateOne(
    {
      _id: booking.slotId,
      campaignId: req.params.campaignId,
      bookedBy: driverId,
      status: 'booked',
    },
    { $set: { status: 'available', bookedBy: null, bookedByName: null, bookedAt: null } },
  );

  // Clear the driver's adhesion schedule field
  clearBookingFromDriverSchedule(db, booking).catch(err => {
    console.warn('[scheduling] schedule clear error:', err?.message);
  });

  res.json({ ok: true, booking: { ...booking, status: 'cancelled' } });
});

/**
 * GET /api/scheduling/:campaignId/driver/:driverId/bookings
 * Driver's own bookings
 */
router.get('/:campaignId/driver/:driverId/bookings', authenticateSession, async (req, res) => {
  // SECURITY: a driver may only view their own bookings.
  // A graphic session (type === 'graphic') may view bookings for any driver
  // in their campaign (needed to display the schedule in the graphic portal).
  const isGraphicSession = req.userSession.type === 'graphic';
  const isOwnBookings = req.userSession.userId === req.params.driverId;
  if (!validatePortalScope(req, res, ['driver', 'graphic'])) return;
  if (!isOwnBookings && !isGraphicSession) {
    return res.status(403).json({ error: 'Acesso não autorizado.' });
  }
  // Graphic sessions are further scoped to their own campaign.
  if (isGraphicSession && req.userSession.campaignId !== req.params.campaignId) {
    return res.status(403).json({ error: 'Acesso não autorizado.' });
  }
  await ensureIndexes();
  const db = await getDb();
  const bookings = await db.collection(COL_BOOKINGS)
    .find({
      campaignId: req.params.campaignId,
      driverId: req.params.driverId,
    })
    .sort({ date: 1, startTime: 1 })
    .toArray();
  res.json({ bookings });
});

/**
 * GET /api/scheduling/:campaignId/graphic/:graphicId/bookings
 * Graphic's bookings (for the graphic portal)
 */
router.get('/:campaignId/graphic/:graphicId/bookings', authenticateSession, async (req, res) => {
  if (!validatePortalScope(req, res, ['graphic'])) return;
  // SECURITY: enforce that the requesting user is the graphic that owns this schedule.
  if (req.userSession.userId !== req.params.graphicId) {
    return res.status(403).json({ error: 'Acesso não autorizado.' });
  }
  await ensureIndexes();
  const db = await getDb();
  const bookings = await db.collection(COL_BOOKINGS)
    .find({
      campaignId: req.params.campaignId,
      graphicId: req.params.graphicId,
      status: 'confirmed',
    })
    .sort({ date: 1, startTime: 1 })
    .toArray();
  res.json({ bookings });
});

// ══════════════════════════════════════════
//  DRIVER SCHEDULE SYNC (adhesion columns)
// ══════════════════════════════════════════

/**
 * When a driver books a slot, write the datetime to the MongoDB drivers collection.
 * Note: the legacy in-memory store is not updated here — the operator will see
 * it reflected the next time the Gerenciador reloads the campaign.
 */
async function syncBookingToDriverSchedule(db, booking) {
  const datetimeValue = `${booking.date}T${booking.startTime}`;
  const dateObj = new Date(datetimeValue);

  const setFields = booking.type === 'installation'
    ? { adhesion_start_at: dateObj, adhesion_start_raw: datetimeValue, scheduling_booked_at: new Date() }
    : { adhesion_end_at: dateObj, adhesion_end_raw: datetimeValue, scheduling_booked_at: new Date() };

  await db.collection('drivers').updateOne(
    { _id: booking.driverId, campaign_id: booking.campaignId },
    { $set: setFields },
  );
}

/**
 * When a driver cancels, clear the corresponding adhesion field in the drivers collection.
 */
async function clearBookingFromDriverSchedule(db, booking) {
  const unsetFields = booking.type === 'installation'
    ? { adhesion_start_at: '', adhesion_start_raw: '' }
    : { adhesion_end_at: '', adhesion_end_raw: '' };

  await db.collection('drivers').updateOne(
    { _id: booking.driverId, campaign_id: booking.campaignId },
    { $unset: unsetFields },
  );
}

// ══════════════════════════════════════════
//  NOTIFICATION HELPER
// ══════════════════════════════════════════

async function notifyGraphicOfBooking(db, booking) {
  if (!sendTextMessage) return;

  // Graphics are stored in the legacy store (JSON), not in MongoDB campaigns
  const legacyDb = loadLegacyDb();
  const campaign = (legacyDb.campaigns || []).find(c => c.id === booking.campaignId);
  if (!campaign) return;

  const graphics = Array.isArray(campaign.graphics) ? campaign.graphics : [];
  const graphic = graphics.find(g => g.id === booking.graphicId);
  if (!graphic) return;

  // Try phone fields: phoneDigits, responsible1PhoneDigits, responsible2PhoneDigits
  const phone = graphic.phoneDigits || graphic.responsible1PhoneDigits || graphic.responsible2PhoneDigits;
  if (!phone || phone.length < 10) return;

  // Format phone to E.164 (Brazilian)
  const cleanPhone = phone.replace(/\D/g, '');
  const e164 = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;

  const typeLabel = booking.type === 'installation' ? 'Instalação (Adesivagem)' : 'Retirada (Remoção)';
  const [y, m, d] = (booking.date || '').split('-');
  const dateFormatted = `${d}/${m}/${y}`;

  const text = `📅 *Novo agendamento OD Drive*\n\n` +
    `Tipo: ${typeLabel}\n` +
    `Motorista: ${booking.driverName || 'Não informado'}\n` +
    `Data: ${dateFormatted}\n` +
    `Horário: ${booking.startTime} às ${booking.endTime}\n\n` +
    `Campanha: ${campaign.name || booking.campaignId}`;

  await sendTextMessage({ to: e164, text });
  console.log(`[scheduling] notification sent to ${e164} for booking ${booking._id}`);
}

// ══════════════════════════════════════════
//  SCHEDULING STATUS (admin summary card)
// ══════════════════════════════════════════

/**
 * GET /api/scheduling/:campaignId/status
 * Returns two lists: drivers who have booked and drivers who haven't.
 */
router.get('/:campaignId/status', authenticateAdmin, async (req, res) => {
  try {
    await ensureIndexes();
    const db = await getDb();
    const { campaignId } = req.params;

    // Get all confirmed bookings for this campaign
    const bookings = await db.collection(COL_BOOKINGS)
      .find({ campaignId, status: 'confirmed' })
      .sort({ date: 1, startTime: 1 })
      .toArray();

    // Get all drivers from legacy store (drivers are a top-level array, not nested in campaign)
    const legacyDb = loadLegacyDb();
    const drivers = (legacyDb.drivers || []).filter(d => d.campaignId === campaignId);

    // Get graphics map for names (graphics are also top-level)
    const graphicsArr = (legacyDb.graphics || []).filter(g => g.campaignId === campaignId);
    const campaign = (legacyDb.campaigns || []).find(c => c.id === campaignId);
    // Some setups store graphics inside the campaign object too
    const campaignGraphics = Array.isArray(campaign?.graphics) ? campaign.graphics : [];
    const allGraphics = [...graphicsArr, ...campaignGraphics];
    const graphicMap = {};
    allGraphics.forEach(g => { if (g.id) graphicMap[g.id] = g; });

    // Build set of driver IDs who have booked
    const bookedDriverIds = new Set(bookings.map(b => b.driverId));

    // Scheduled drivers (with their booking details)
    const scheduled = [];
    const unscheduled = [];

    for (const driver of drivers) {
      const driverBookings = bookings.filter(b => b.driverId === driver.id);
      if (driverBookings.length > 0) {
        scheduled.push({
          id: driver.id,
          name: driver.name || 'Motorista',
          phone: driver.phone || '',
          bookings: driverBookings.map(b => ({
            type: b.type,
            date: b.date,
            startTime: b.startTime,
            endTime: b.endTime,
            graphicName: graphicMap[b.graphicId]?.name || '—',
          })),
        });
      } else {
        unscheduled.push({
          id: driver.id,
          name: driver.name || 'Motorista',
          phone: driver.phone || '',
        });
      }
    }

    res.json({
      ok: true,
      totalDrivers: drivers.length,
      scheduledCount: scheduled.length,
      unscheduledCount: unscheduled.length,
      scheduled,
      unscheduled,
    });
  } catch (err) {
    console.error('[scheduling:status]', err);
    res.status(500).json({ ok: false, error: 'Erro ao carregar status de agendamento.' });
  }
});

export default router;
