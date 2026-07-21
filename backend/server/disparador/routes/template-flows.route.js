import { randomUUID } from "crypto";
import { Router } from "express";

import { getTemplateById } from "../store/memory-store.js";
import {
  findFlowById,
  findFlowByTemplateId,
  insertVersion,
  listFlows,
  listVersionsByFlowId,
  upsertFlow,
} from "../services/mongo/template-flows.repo.js";

const router = Router();

const NODE_TYPES = [
  "send_text",
  "send_image",
  "send_buttons",
  "send_template",
  "update_driver_status",
  "add_tag",
  "handoff_human",
  "end",
];

const MATCH_TYPES = ["button", "list", "fallback", "free_text"];

function validateSubBranch(b, path) {
  if (!b || typeof b !== "object") return `${path}: invalido.`;
  if (!b.id || typeof b.id !== "string") return `${path}: 'id' obrigatorio.`;
  const nodes = Array.isArray(b.nodes) ? b.nodes : [];
  if (nodes.length > 200) return `${path}: maximo de 200 nodes.`;
  for (let j = 0; j < nodes.length; j++) {
    const n = nodes[j];
    if (!n || typeof n !== "object") return `${path} Node ${j}: invalido.`;
    if (!n.id || typeof n.id !== "string") return `${path} Node ${j}: 'id' obrigatorio.`;
    if (!NODE_TYPES.includes(n.type)) return `${path} Node ${j}: type invalido '${n.type}'.`;
  }
  const children = Array.isArray(b.children) ? b.children : [];
  if (children.length > 20) return `${path}: maximo de 20 sub-branches.`;
  for (let k = 0; k < children.length; k++) {
    const err = validateSubBranch(children[k], `${path} > Sub ${k}`);
    if (err) return err;
  }
  return null;
}

function validateFlowSavePayload(body) {
  if (!body || typeof body !== "object") return "Body vazio ou invalido.";
  const snapshot = body.snapshot;
  if (!snapshot || typeof snapshot !== "object") return "Campo 'snapshot' obrigatorio.";
  if (!Array.isArray(snapshot.branches) || snapshot.branches.length === 0) return "Pelo menos um branch e obrigatorio.";
  if (snapshot.branches.length > 40) return "Maximo de 40 branches.";

  for (let i = 0; i < snapshot.branches.length; i++) {
    const b = snapshot.branches[i];
    if (!b || typeof b !== "object") return `Branch ${i}: invalido.`;
    if (!b.id || typeof b.id !== "string") return `Branch ${i}: 'id' obrigatorio.`;
    if (!b.label || typeof b.label !== "string") return `Branch ${i}: 'label' obrigatorio.`;
    if (!b.match || typeof b.match !== "object") return `Branch ${i}: 'match' obrigatorio.`;
    if (!MATCH_TYPES.includes(b.match.type)) return `Branch ${i}: match.type invalido '${b.match.type}'.`;
    const nodes = Array.isArray(b.nodes) ? b.nodes : [];
    if (nodes.length > 200) return `Branch ${i}: maximo de 200 nodes.`;
    for (let j = 0; j < nodes.length; j++) {
      const n = nodes[j];
      if (!n || typeof n !== "object") return `Branch ${i} Node ${j}: invalido.`;
      if (!n.id || typeof n.id !== "string") return `Branch ${i} Node ${j}: 'id' obrigatorio.`;
      if (!NODE_TYPES.includes(n.type)) return `Branch ${i} Node ${j}: type invalido '${n.type}'.`;
    }
    const children = Array.isArray(b.children) ? b.children : [];
    if (children.length > 20) return `Branch ${i}: maximo de 20 sub-branches.`;
    for (let k = 0; k < children.length; k++) {
      const err = validateSubBranch(children[k], `Branch ${i} > Sub ${k}`);
      if (err) return err;
    }
  }
  return null;
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

function defaultNodeTitle(type) {
  switch (type) {
    case "send_text":
      return "Mensagem";
    case "send_image":
      return "Imagem";
    case "send_template":
      return "Template";
    case "update_driver_status":
      return "Atualizar status";
    case "add_tag":
      return "Adicionar tag";
    case "handoff_human":
      return "Encaminhar operador";
    case "end":
      return "Encerrar";
    default:
      return "Etapa";
  }
}

function normalizeNode(node) {
  const type = NODE_TYPES.includes(String(node?.type || "")) ? String(node.type) : "send_text";
  const config = node?.config && typeof node.config === "object" ? deepClone(node.config) : {};
  return {
    id: String(node?.id || randomUUID()),
    type,
    title: String(node?.title || defaultNodeTitle(type)).trim().slice(0, 120) || defaultNodeTitle(type),
    config,
  };
}

function extractTemplateButtons(template) {
  const buttons = Array.isArray(template?.buttons) ? template.buttons : [];
  return buttons
    .map((button, index) => {
      const text = String(button?.text || "").trim();
      if (!text) return null;
      return {
        id: `btn-${index + 1}-${normalizeText(text) || "opcao"}`,
        text,
        type: String(button?.type || "quick_reply"),
      };
    })
    .filter(Boolean);
}

function cleanChoiceLabel(value) {
  return String(value || "")
    .replace(/\{\{\d+\}\}/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function buildChoiceAliases(token, label) {
  const aliases = new Set();
  const rawToken = String(token || "").trim();
  const rawLabel = cleanChoiceLabel(label);
  if (rawToken) {
    aliases.add(rawToken);
    aliases.add(`opcao ${rawToken}`);
  }
  if (rawLabel) {
    aliases.add(rawLabel);
  }
  return [...aliases].filter(Boolean);
}

function extractTemplateTextChoices(template) {
  const bodyText = String(template?.bodyText || "");
  if (!bodyText) return [];

  const lines = bodyText
    .split(/\r?\n+/g)
    .map((line) => String(line || "").trim())
    .filter(Boolean);

  const choices = [];
  const seen = new Set();

  for (const line of lines) {
    let match = line.match(/^(?:opcao|op\u00e7\u00e3o)?\s*([0-9]{1,2}|[a-z])\s*[\)\.\-:]\s+(.+)$/i);
    if (!match) {
      match = line.match(/^(?:digite|responda|escreva|envie|tecle|pressione)\s+([0-9]{1,2}|[a-z])\s+(?:para|pra)\s+(.+)$/i);
    }
    if (!match) continue;

    const rawToken = String(match[1] || "").trim();
    const token = rawToken.toUpperCase();
    const label = cleanChoiceLabel(match[2]);
    if (!token || !label) continue;

    const choiceKey = normalizeText(rawToken) || normalizeText(label) || `choice-${choices.length + 1}`;
    if (seen.has(choiceKey)) continue;
    seen.add(choiceKey);

    choices.push({
      id: `option:${choiceKey}`,
      label,
      trigger: rawToken,
      aliases: buildChoiceAliases(rawToken, label),
      source: "template_text_option",
      match: {
        type: "free_text",
        value: buildChoiceAliases(rawToken, label).join("|"),
      },
      meta: {
        source: "template_text_option",
        triggerToken: rawToken,
        aliases: buildChoiceAliases(rawToken, label),
      },
    });
  }

  return choices;
}

function extractTemplateChoices(template) {
  const buttons = extractTemplateButtons(template);
  if (buttons.length) {
    return buttons.map((button) => ({
      id: `button:${button.id}`,
      label: button.text,
      trigger: button.text,
      aliases: [button.text],
      source: "template_button",
      match: {
        type: button.type === "list" ? "list" : "button",
        value: button.text,
        buttonId: button.id,
      },
      meta: {
        source: "template_button",
        buttonId: button.id,
        aliases: [button.text],
      },
    }));
  }
  return extractTemplateTextChoices(template);
}

function isManualBranchId(value) {
  const raw = String(value || "");
  return raw.startsWith("custom:") || raw.startsWith("manual:");
}

function buildTemplateDescriptor(template) {
  const buttons = extractTemplateButtons(template);
  const choices = extractTemplateChoices(template);
  return {
    id: String(template?.id || ""),
    name: String(template?.name || ""),
    bodyText: String(template?.bodyText || ""),
    status: String(template?.status || ""),
    metaTemplateId: String(template?.metaTemplateId || ""),
    buttons,
    choices: choices.map((choice) => ({
      id: choice.id,
      label: choice.label,
      trigger: choice.trigger,
      source: choice.source,
      aliases: deepClone(choice.aliases || []),
      match: deepClone(choice.match || {}),
      meta: deepClone(choice.meta || {}),
    })),
  };
}

function normalizeSubBranch(sub) {
  const nodes = Array.isArray(sub?.nodes) ? sub.nodes.map(normalizeNode) : [];
  const children = Array.isArray(sub?.children) ? sub.children.map(normalizeSubBranch) : [];
  return {
    id: String(sub?.id || randomUUID()),
    label: String(sub?.label || "").trim(),
    parentNodeId: String(sub?.parentNodeId || "").trim(),
    match: sub?.match && typeof sub.match === "object" ? deepClone(sub.match) : {},
    meta: sub?.meta && typeof sub.meta === "object" ? deepClone(sub.meta) : {},
    nodes,
    ...(children.length ? { children } : {}),
  };
}

function buildBranchFromSource(source, meta) {
  const nodes = Array.isArray(source?.nodes) ? source.nodes.map(normalizeNode) : [];
  const children = Array.isArray(source?.children) ? source.children.map(normalizeSubBranch) : [];
  return {
    id: meta.id,
    label: String(meta.label || "").trim() || "Branch",
    match: deepClone(meta.match || {}),
    meta: {
      ...(source?.meta && typeof source.meta === "object" ? deepClone(source.meta) : {}),
      ...(meta.meta && typeof meta.meta === "object" ? deepClone(meta.meta) : {}),
    },
    nodes,
    ...(children.length ? { children } : {}),
  };
}

function buildSnapshotFromTemplate(template, sourceSnapshot = null) {
  const descriptor = buildTemplateDescriptor(template);
  const sourceBranches = Array.isArray(sourceSnapshot?.branches) ? sourceSnapshot.branches : [];
  const sourceById = new Map(sourceBranches.map((branch) => [String(branch.id || ""), branch]));
  const branches = [];
  const manualBranches = sourceBranches.filter((branch) => isManualBranchId(branch?.id));

  if (descriptor.choices.length) {
    descriptor.choices.forEach((choice) => {
      branches.push(
        buildBranchFromSource(sourceById.get(choice.id), {
          id: choice.id,
          label: choice.label,
          match: choice.match && typeof choice.match === "object" ? choice.match : {
            type: descriptor.buttons.length ? "button" : "free_text",
            value: choice.trigger || choice.label,
          },
          meta: choice.meta && typeof choice.meta === "object" ? choice.meta : {
            source: choice.source,
            aliases: deepClone(choice.aliases || []),
          },
        }),
      );
    });

    if (!descriptor.buttons.length) {
      manualBranches.forEach((branch) => {
        branches.push(
          buildBranchFromSource(branch, {
            id: String(branch?.id || randomUUID()),
            label: String(branch?.label || "Resposta guiada"),
            match: branch?.match && typeof branch.match === "object"
              ? branch.match
              : { type: "free_text", value: "" },
            meta: {
              source: "manual_choice",
            },
          }),
        );
      });
    }

    branches.push(
      buildBranchFromSource(sourceById.get("fallback"), {
        id: "fallback",
        label: "Qualquer outra resposta",
        match: {
          type: "fallback",
          value: "*",
        },
        meta: {
          source: "template_fallback",
        },
      }),
    );
  } else {
    manualBranches.forEach((branch) => {
      branches.push(
        buildBranchFromSource(branch, {
          id: String(branch?.id || randomUUID()),
          label: String(branch?.label || "Opcao guiada"),
          match: branch?.match && typeof branch.match === "object"
            ? branch.match
            : { type: "free_text", value: "" },
          meta: {
            source: "manual_choice",
          },
        }),
      );
    });

    const defaultLabel = manualBranches.length ? "Qualquer outra resposta" : "Qualquer resposta";
    branches.push(
      buildBranchFromSource(sourceById.get("default"), {
        id: "default",
        label: defaultLabel,
        match: {
          type: "free_text",
          value: "*",
        },
        meta: {
          source: "default_catchall",
        },
      }),
    );
  }

  return {
    template: descriptor,
    branches,
    settings: {
      enabled: sourceSnapshot?.settings?.enabled !== false,
      fallbackMode: String(sourceSnapshot?.settings?.fallbackMode || "handoff"),
      ...deepClone(sourceSnapshot?.settings || {}),
    },
    notes: String(sourceSnapshot?.notes || ""),
  };
}

function sanitizeSnapshotInput(snapshot) {
  return {
    branches: Array.isArray(snapshot?.branches) ? deepClone(snapshot.branches) : [],
    settings: snapshot?.settings && typeof snapshot.settings === "object"
      ? deepClone(snapshot.settings)
      : {},
    notes: String(snapshot?.notes || ""),
  };
}

function summarizeFlow(item) {
  const revision = Number(item?.revision || 0);
  const publishedRevision = Number(item?.publishedRevision || 0);
  return {
    id: String(item?.id || ""),
    templateId: String(item?.templateId || ""),
    templateName: String(item?.templateName || ""),
    status: String(item?.status || "draft"),
    revision,
    publishedVersion: Number(item?.publishedVersion || 0),
    publishedRevision,
    hasDraftChanges: revision > publishedRevision,
    updatedAt: item?.updatedAt || null,
    publishedAt: item?.publishedAt || null,
  };
}

async function loadTemplateOrThrow(templateId) {
  const template = await getTemplateById(String(templateId || "").trim());
  if (!template) {
    const err = new Error("Template nao encontrado.");
    err.status = 404;
    err.code = "TEMPLATE_NOT_FOUND";
    throw err;
  }
  return template;
}

router.get("/template-flows", async (req, res) => {
  try {
    const templateId = String(req.query.templateId || "").trim();
    let items = [];

    if (templateId) {
      const single = await findFlowByTemplateId(templateId);
      items = single ? [single] : [];
    } else {
      items = await listFlows();
    }

    return res.json({ ok: true, items: items.map(summarizeFlow) });
  } catch (err) {
    console.error("[TEMPLATE_FLOWS_LIST_FAILED]", err?.message || err);
    return res.status(500).json({
      ok: false,
      error: { code: "TEMPLATE_FLOWS_LIST_FAILED", message: "Falha ao listar fluxos." },
    });
  }
});

router.get("/template-flows/by-template/:templateId", async (req, res) => {
  try {
    const template = await loadTemplateOrThrow(req.params.templateId);
    const stored = await findFlowByTemplateId(template.id);
    const snapshotSource = stored?.currentDraft || stored?.publishedSnapshot || null;
    const snapshot = buildSnapshotFromTemplate(template, snapshotSource);

    const item = stored
      ? { ...stored, currentDraft: snapshot }
      : {
          id: "",
          templateId: template.id,
          templateName: template.name || "",
          status: "draft",
          revision: 0,
          publishedVersion: 0,
          publishedRevision: 0,
          currentDraft: snapshot,
          publishedSnapshot: null,
          createdAt: null,
          updatedAt: null,
          publishedAt: null,
        };

    return res.json({ ok: true, item, summary: summarizeFlow(item) });
  } catch (err) {
    const status = Number(err?.status || 500);
    return res.status(status).json({
      ok: false,
      error: {
        code: err?.code || "TEMPLATE_FLOW_LOAD_FAILED",
        message: err?.message || "Falha ao carregar fluxo do template.",
      },
    });
  }
});

router.put("/template-flows/by-template/:templateId", async (req, res) => {
  try {
    const validationError = validateFlowSavePayload(req.body);
    if (validationError) {
      return res.status(400).json({
        ok: false,
        error: { code: "VALIDATION_ERROR", message: validationError },
      });
    }

    const template = await loadTemplateOrThrow(req.params.templateId);
    const existing = await findFlowByTemplateId(template.id);
    const snapshot = buildSnapshotFromTemplate(template, sanitizeSnapshotInput(req.body.snapshot));
    const now = new Date().toISOString();
    const nextRevision = Number(existing?.revision || 0) + 1;

    const item = {
      id: String(existing?.id || randomUUID()),
      templateId: template.id,
      templateName: template.name || "",
      status: existing?.publishedVersion ? "published" : "draft",
      revision: nextRevision,
      publishedVersion: Number(existing?.publishedVersion || 0),
      publishedRevision: Number(existing?.publishedRevision || 0),
      currentDraft: snapshot,
      publishedSnapshot: existing?.publishedSnapshot || null,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      publishedAt: existing?.publishedAt || null,
    };

    await upsertFlow(item);
    return res.json({ ok: true, item, summary: summarizeFlow(item) });
  } catch (err) {
    console.error("[TEMPLATE_FLOW_SAVE_FAILED]", {
      templateId: String(req.params.templateId || ""),
      message: err?.message || err,
      stack: err?.stack || null,
    });
    const status = Number(err?.status || 500);
    return res.status(status).json({
      ok: false,
      error: {
        code: err?.code || "TEMPLATE_FLOW_SAVE_FAILED",
        message: err?.message || "Falha ao salvar fluxo do template.",
      },
    });
  }
});

router.post("/template-flows/by-template/:templateId/publish", async (req, res) => {
  try {
    const template = await loadTemplateOrThrow(req.params.templateId);
    const existing = await findFlowByTemplateId(template.id);
    const snapshot = buildSnapshotFromTemplate(
      template,
      existing?.currentDraft || existing?.publishedSnapshot || null,
    );
    const now = new Date().toISOString();
    const nextRevision = Number(existing?.revision || 0) + 1;
    const nextPublishedVersion = Number(existing?.publishedVersion || 0) + 1;

    const item = {
      id: String(existing?.id || randomUUID()),
      templateId: template.id,
      templateName: template.name || "",
      status: "published",
      revision: nextRevision,
      publishedVersion: nextPublishedVersion,
      publishedRevision: nextRevision,
      currentDraft: snapshot,
      publishedSnapshot: snapshot,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
      publishedAt: now,
    };

    await upsertFlow(item);
    await insertVersion({
      id: `${item.id}:${nextPublishedVersion}`,
      flowId: item.id,
      templateId: item.templateId,
      templateName: item.templateName,
      version: nextPublishedVersion,
      snapshot,
      createdAt: now,
    });

    return res.json({ ok: true, item, summary: summarizeFlow(item) });
  } catch (err) {
    console.error("[TEMPLATE_FLOW_PUBLISH_FAILED]", {
      templateId: String(req.params.templateId || ""),
      message: err?.message || err,
      stack: err?.stack || null,
    });
    const status = Number(err?.status || 500);
    return res.status(status).json({
      ok: false,
      error: {
        code: err?.code || "TEMPLATE_FLOW_PUBLISH_FAILED",
        message: err?.message || "Falha ao publicar fluxo do template.",
      },
    });
  }
});

router.get("/template-flows/:id/versions", async (req, res) => {
  const item = await findFlowById(String(req.params.id || "").trim());
  if (!item) {
    return res.status(404).json({
      ok: false,
      error: { code: "TEMPLATE_FLOW_NOT_FOUND", message: "Fluxo nao encontrado." },
    });
  }

  const versions = await listVersionsByFlowId(item.id);
  return res.json({
    ok: true,
    item: summarizeFlow(item),
    versions,
  });
});

export { router as templateFlowsRouter };
