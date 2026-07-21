import { Router } from "express";
import { z } from "zod";
import {
  createFlow,
  updateFlow,
  publishFlow,
  listFlows,
  getFlowById,
  getFlowByKey,
} from "../store/memory-store.js";

const router = Router();

const flowNodeSchema = z.object({
  id: z.string().min(1),
  s: z.string().optional(),
  t: z.string().optional(),
  m: z.string().optional(),
  d: z.string().optional(),
  type: z.string().optional(),
  x: z.coerce.number().optional(),
  y: z.coerce.number().optional(),
  runtimeConfig: z.record(z.any()).optional(),
}).catchall(z.any());

const flowEdgeSchema = z.object({
  id: z.string().optional(),
  f: z.string().min(1),
  t: z.string().min(1),
  l: z.string().optional(),
  k: z.string().optional(),
}).catchall(z.any());

const flowDefinitionSchema = z.object({
  name: z.string().optional(),
  summary: z.string().optional(),
  quick: z.array(z.string()).optional(),
  tour: z.array(z.string()).optional(),
  nodes: z.array(flowNodeSchema).min(1),
  edges: z.array(flowEdgeSchema).default([]),
}).catchall(z.any());

const flowCreateSchema = z.object({
  key: z.string().min(2).max(80).regex(/^[a-z0-9_-]+$/, "Use apenas minusculas, numeros, underscore e hifen."),
  name: z.string().min(2).max(120),
  description: z.string().max(400).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  definition: flowDefinitionSchema,
});

const flowUpdateSchema = z.object({
  key: z.string().min(2).max(80).regex(/^[a-z0-9_-]+$/, "Use apenas minusculas, numeros, underscore e hifen.").optional(),
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(400).optional(),
  status: z.enum(["draft", "published", "archived"]).optional(),
  definition: flowDefinitionSchema.optional(),
});

function isSameFlow(a, b) {
  return a && b && a.id === b.id;
}

router.get("/flows", async (req, res) => {
  const statusFilter = String(req.query.status || "").trim().toLowerCase();
  const keyFilter = String(req.query.key || "").trim().toLowerCase();

  let items = await listFlows();
  if (statusFilter) {
    items = items.filter((item) => String(item.status || "").toLowerCase() === statusFilter);
  }
  if (keyFilter) {
    items = items.filter((item) => String(item.key || "").toLowerCase() === keyFilter);
  }

  return res.json({ ok: true, items });
});

router.get("/flows/:id", async (req, res) => {
  const item = await getFlowById(req.params.id);
  if (!item) {
    return res.status(404).json({ ok: false, error: { code: "FLOW_NOT_FOUND", message: "Fluxo nao encontrado." } });
  }
  return res.json({ ok: true, item });
});

router.post("/flows", async (req, res) => {
  const parsed = flowCreateSchema.parse(req.body || {});
  const existing = await getFlowByKey(parsed.key);
  if (existing) {
    return res.status(409).json({ ok: false, error: { code: "FLOW_KEY_ALREADY_EXISTS", message: "Ja existe um fluxo com essa chave." } });
  }
  const item = await createFlow(parsed);
  return res.status(201).json({ ok: true, item });
});

router.put("/flows/:id", async (req, res) => {
  const parsed = flowUpdateSchema.parse(req.body || {});
  const current = await getFlowById(req.params.id);
  if (!current) {
    return res.status(404).json({ ok: false, error: { code: "FLOW_NOT_FOUND", message: "Fluxo nao encontrado." } });
  }

  if (parsed.key) {
    const existing = await getFlowByKey(parsed.key);
    if (existing && !isSameFlow(existing, current)) {
      return res.status(409).json({ ok: false, error: { code: "FLOW_KEY_ALREADY_EXISTS", message: "Ja existe um fluxo com essa chave." } });
    }
  }

  const item = await updateFlow(current.id, parsed);
  return res.json({ ok: true, item });
});

router.post("/flows/:id/publish", async (req, res) => {
  const current = await getFlowById(req.params.id);
  if (!current) {
    return res.status(404).json({ ok: false, error: { code: "FLOW_NOT_FOUND", message: "Fluxo nao encontrado." } });
  }
  if (!current.definition || !Array.isArray(current.definition.nodes) || !current.definition.nodes.length) {
    return res.status(400).json({ ok: false, error: { code: "FLOW_EMPTY", message: "Fluxo sem etapas para publicar." } });
  }
  const item = await publishFlow(current.id);
  return res.json({ ok: true, item });
});

export { router as flowsRouter };
