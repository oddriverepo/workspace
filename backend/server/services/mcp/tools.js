/**
 * MCP tool implementations for the OD Drive agent (GPT Maker).
 *
 * SECURITY POLICY (READ ONLY):
 *  - Every tool here is read-only. No mutation helpers may be imported.
 *  - Hard-blocked fields never leave this layer: cpf, pix, email, photo URLs,
 *    raw documents, internal Mongo ids, password hashes, driverTarget number,
 *    other drivers' personal data.
 *  - Outputs are pre-formatted "summary" strings whenever possible so the
 *    agent has no incentive to extract individual fields.
 *  - On any error we return a generic safe payload — never the stack/error.
 */

import * as db from '../db.js';
import { getCampaignSettingsByIds, getDb } from '../mongo.js';

// ── helpers ────────────────────────────────────────────────────────────

function digitsOnly(s) {
  return String(s ?? '').replace(/\D/g, '');
}

function phoneSuffix(s) {
  const d = digitsOnly(s);
  return d.length >= 8 ? d.slice(-9) : '';
}

function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();
}

// Aliases populares de cidades brasileiras → nome canônico normalizado
const CITY_ALIASES = {
  'floripa':          'florianopolis',
  'sampa':            'sao paulo',
  'sp':               'sao paulo',
  'bh':               'belo horizonte',
  'poa':              'porto alegre',
  'ssa':              'salvador',
  'fortal':           'fortaleza',
  'manaus':           'manaus',
  'goiania':          'goiania',
  'belem':            'belem',
  'cps':              'campinas',
  'curitiba':         'curitiba',
  'recife':           'recife',
  'natal':            'natal',
  'maceio':           'maceio',
  'joao pessoa':      'joao pessoa',
  'jp':               'joao pessoa',
  'joinville':        'joinville',
  'jlle':             'joinville',
  'bsb':              'brasilia',
  'df':               'brasilia',
  'rio':              'rio de janeiro',
  'rj':               'rio de janeiro',
  'guarapari':        'guarapari',
  'ribeirao preto':   'ribeirao preto',
  'rp':               'ribeirao preto',
  'sao jose sc':      'sao jose',
  'aracaju':          'aracaju',
  'tubarao':          'tubarao',
};

function resolveCity(raw) {
  const norm = normalizeText(raw);
  return CITY_ALIASES[norm] || norm;
}

async function getCampaignName(campaignId) {
  if (!campaignId) return '';
  try {
    const camp = await db.fetchCampaignById(campaignId);
    return camp?.name || '';
  } catch {
    return '';
  }
}

/** Iterate all campaign graphics tables and return the first matching graphic. */
async function findGraphicAcrossCampaigns(predicate) {
  let campaigns = [];
  try {
    campaigns = await db.fetchCampaigns();
  } catch {
    return null;
  }
  for (const camp of campaigns || []) {
    let rows = [];
    try {
      rows = await db.listCampaignGraphicsRecords({
        id: String(camp._id || camp.id),
        name: camp.name,
      });
    } catch {
      continue;
    }
    for (const row of rows || []) {
      if (predicate(row)) {
        return {
          name: row['GRAFICA NOME'] || '',
          campaignName: camp.name || '',
        };
      }
    }
  }
  return null;
}

async function findGraphicByPhone(phone) {
  const suffix = phoneSuffix(phone);
  if (!suffix) return null;
  return findGraphicAcrossCampaigns((row) => {
    const candidates = [
      row['GRAFICA TELEFONE'],
      row['RESPONSAVEL 1 TELEFONE'],
      row['RESPONSAVEL 2 TELEFONE'],
    ];
    return candidates.some((p) => p && phoneSuffix(p) === suffix);
  });
}

async function findGraphicByName(name) {
  const target = normalizeText(name);
  if (!target || target.length < 3) return null;
  return findGraphicAcrossCampaigns((row) => {
    const candidates = [
      row['GRAFICA NOME'],
      row['RESPONSAVEL 1 NOME'],
      row['RESPONSAVEL 2 NOME'],
    ];
    return candidates.some(
      (n) => n && normalizeText(n).includes(target),
    );
  });
}

async function isCampaignOpen(campaignId, settingsMap) {
  const id = String(campaignId);
  let target = 0;
  if (settingsMap?.has(id)) {
    target = Number(settingsMap.get(id)?.driverTarget || 0);
  } else {
    try {
      const map = await getCampaignSettingsByIds([id]);
      target = Number(map.get(id)?.driverTarget || 0);
    } catch {
      target = 0;
    }
  }
  if (!target || target <= 0) return true; // sem meta = considerado aberto
  let count = 0;
  try {
    const drivers = await db.fetchDriversByCampaign(id);
    count = Array.isArray(drivers) ? drivers.length : 0;
  } catch {
    return true;
  }
  return count < target;
}

async function summarizeDriverProgress(driver) {
  const driverId = String(driver?._id || driver?.id || '');
  if (!driverId) return 'Sem dados de envio.';
  try {
    const database = await getDb();
    const evidences = await database
      .collection('evidence')
      .find({ driver_id: driverId })
      .project({ step: 1 })
      .toArray();
    const steps = new Set(
      (evidences || []).map((e) => normalizeText(e.step || '')),
    );
    if (steps.size === 0) return 'Ainda não enviou nenhuma foto.';
    return `Já enviou ${steps.size} tipo(s) de evidência.`;
  } catch {
    return 'Status de envio indisponível no momento.';
  }
}

// ── Tools ──────────────────────────────────────────────────────────────

/**
 * lookup_contact
 * Identifica se um telefone/nome/instagram corresponde a um motorista
 * cadastrado, a um responsável de gráfica ou a um lead desconhecido.
 */
export async function lookup_contact({ phone, name, instagram_handle } = {}) {
  try {
    if (phone) {
      const driver = await db.findDriverByPhone(phone);
      if (driver) {
        const campaignName = await getCampaignName(driver.campaignId);
        return {
          found: true,
          type: 'driver',
          summary:
            'Motorista já está cadastrado' +
            (campaignName ? ` na campanha ${campaignName}` : '') +
            (driver.status ? ` (status: ${driver.status})` : '') +
            '.',
        };
      }
      const g = await findGraphicByPhone(phone);
      if (g) {
        return {
          found: true,
          type: 'graphic',
          summary: `Contato consta como gráfica/responsável da campanha ${g.campaignName}.`,
        };
      }
    }

    if (name) {
      // Identidade de motorista exige NOME + TELEFONE juntos.
      // Sem telefone, findDriverByIdentity retornaria o primeiro match por
      // nome — o que permitiria enumeração de PII (campanha/status) por
      // qualquer um com o token. Bloqueamos esse caminho.
      if (phone) {
        const driver = await db.findDriverByIdentity({ name, phone });
        if (driver) {
          const campaignName = await getCampaignName(driver.campaignId);
          return {
            found: true,
            type: 'driver',
            summary:
              'Motorista já está cadastrado' +
              (campaignName ? ` na campanha ${campaignName}` : '') +
              (driver.status ? ` (status: ${driver.status})` : '') +
              '.',
          };
        }
      }
      // Para gráfica aceitamos só nome, mas com mínimo de 5 chars
      // (findGraphicByName já exige >= 3; reforçamos aqui para evitar
      // varredura com fragmentos muito curtos).
      if (name.trim().length >= 5) {
        const g = await findGraphicByName(name);
        if (g) {
          return {
            found: true,
            type: 'graphic',
            summary: `Contato consta como gráfica/responsável da campanha ${g.campaignName}.`,
          };
        }
      }
    }

    // instagram_handle: ainda não temos esse campo armazenado.
    // Caímos no caminho de "lead desconhecido" sem expor a ausência da tabela.
    void instagram_handle;

    return {
      found: false,
      type: 'lead_unknown',
      summary:
        'Nenhum cadastro encontrado para o contato informado. Trate como lead novo.',
    };
  } catch (err) {
    console.error('[MCP][lookup_contact] erro:', err?.message);
    return {
      found: false,
      type: 'lead_unknown',
      summary: 'Não foi possível consultar agora. Trate como lead novo.',
    };
  }
}

/**
 * get_driver_details
 * Devolve dados básicos do motorista a partir do telefone.
 * Nunca expõe CPF, PIX, e-mail, fotos, ids internos.
 */
export async function get_driver_details({ phone } = {}) {
  try {
    if (!phone) {
      return { found: false, summary: 'Telefone é obrigatório.' };
    }
    const driver = await db.findDriverByPhone(phone);
    if (!driver) {
      return {
        found: false,
        summary: 'Nenhum motorista encontrado para este telefone.',
      };
    }
    const campaignName = await getCampaignName(driver.campaignId);
    const progress = await summarizeDriverProgress(driver);
    return {
      found: true,
      name: driver.name || '',
      city: driver.city || '',
      campaign_name: campaignName,
      status: driver.status || '',
      progress_summary: progress,
    };
  } catch (err) {
    console.error('[MCP][get_driver_details] erro:', err?.message);
    return { found: false, summary: 'Consulta indisponível no momento.' };
  }
}

/**
 * search_campaigns_by_city
 * Lista campanhas ATIVAS na cidade informada e indica se ainda aceitam
 * novos motoristas (compara qtd cadastrada vs. driverTarget).
 */
export async function search_campaigns_by_city({ city } = {}) {
  try {
    // resolveCity: remove acentos, lowercase, e resolve aliases (ex: "floripa" → "florianopolis")
    const target = resolveCity(city);
    if (!target) return [];
    const campaigns = (await db.fetchCampaigns()) || [];
    const matching = campaigns.filter((c) => {
      // Exclui apenas campanhas explicitamente encerradas; aceita 'ativa', 'pausada'
      // e qualquer status desconhecido (evita falsos negativos por mapeamento incorreto)
      if (c.status === 'encerrada') return false;
      const cityField = c.apiData?.city || c.city || '';
      // Aplica resolveCity também no campo armazenado (normaliza acento + alias)
      const cityNorm = resolveCity(cityField);
      // Suporta formatos: "Fortaleza", "Fortaleza CE", "Fortaleza / CE"
      const cityBase = resolveCity(cityField.split('/')[0]);
      return cityNorm === target || cityBase === target || cityBase.startsWith(target) || cityNorm.startsWith(target);
    });
    if (matching.length === 0) return [];

    const ids = matching.map((c) => String(c._id || c.id));
    let settingsMap = new Map();
    try {
      settingsMap = await getCampaignSettingsByIds(ids);
    } catch {
      settingsMap = new Map();
    }

    const out = [];
    for (const c of matching) {
      const open = await isCampaignOpen(c._id || c.id, settingsMap);
      out.push({
        campaign_name: c.name || '',
        open,
      });
    }
    return out;
  } catch (err) {
    console.error('[MCP][search_campaigns_by_city] erro:', err?.message);
    return [];
  }
}

/**
 * lookup_graphic
 * Procura uma gráfica parceira por telefone ou nome.
 */
export async function lookup_graphic({ phone, name } = {}) {
  try {
    if (phone) {
      const g = await findGraphicByPhone(phone);
      if (g) {
        return {
          found: true,
          name: g.name,
          campaign_name: g.campaignName,
          summary: `${g.name} é gráfica parceira na campanha ${g.campaignName}.`,
        };
      }
    }
    if (name) {
      const g = await findGraphicByName(name);
      if (g) {
        return {
          found: true,
          name: g.name,
          campaign_name: g.campaignName,
          summary: `${g.name} é gráfica parceira na campanha ${g.campaignName}.`,
        };
      }
    }
    return { found: false, summary: 'Nenhuma gráfica encontrada.' };
  } catch (err) {
    console.error('[MCP][lookup_graphic] erro:', err?.message);
    return { found: false, summary: 'Consulta indisponível no momento.' };
  }
}

/**
 * list_active_campaigns
 * Lista todas as campanhas ATIVAS com cidade e disponibilidade.
 */
export async function list_active_campaigns() {
  try {
    const campaigns = (await db.fetchCampaigns()) || [];
    const active = campaigns.filter((c) => c.status === 'ativa');
    if (active.length === 0) return [];

    const ids = active.map((c) => String(c._id || c.id));
    let settingsMap = new Map();
    try {
      settingsMap = await getCampaignSettingsByIds(ids);
    } catch {
      settingsMap = new Map();
    }

    const out = [];
    for (const c of active) {
      const cityField = c.apiData?.city || c.city || '';
      const open = await isCampaignOpen(c._id || c.id, settingsMap);
      out.push({
        name: c.name || '',
        cities: cityField ? [cityField] : [],
        open,
      });
    }
    return out;
  } catch (err) {
    console.error('[MCP][list_active_campaigns] erro:', err?.message);
    return [];
  }
}

export const TOOLS = {
  lookup_contact,
  get_driver_details,
  search_campaigns_by_city,
  lookup_graphic,
  list_active_campaigns,
};
