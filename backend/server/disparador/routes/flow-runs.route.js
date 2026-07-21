import { Router } from "express";
import { z } from "zod";
import {
  getFlowById,
  getFlowByKey,
  listFlowRuns,
  getFlowRunById,
  createFlowRun,
  appendFlowRunEvent,
  summarizeFlowRunsByNode,
  getContactById,
} from "../store/memory-store.js";
import {
  enqueueFlowAutomation,
  getFlowAutomationQueueStatus,
} from "../services/flow-automation.service.js";

const router = Router();

const startFlowRunSchema = z.object({
  flowId: z.string().min(1).optional(),
  flowKey: z.string().min(2).optional(),
  contactId: z.string().min(1),
  startNodeId: z.string().min(1).optional(),
  ownerUserId: z.string().optional(),
  allowDraft: z.coerce.boolean().optional(),
  context: z.record(z.any()).optional(),
});

const flowRunEventSchema = z.object({
  type: z.string().min(2),
  source: z.string().optional(),
  payload: z.record(z.any()).optional(),
});

async function resolveFlowFromStartInput(parsed) {
  if (parsed.flowId) return getFlowById(parsed.flowId);
  if (parsed.flowKey) return getFlowByKey(parsed.flowKey);
  return null;
}

router.get("/flow-runs", async (req, res) => {
  const items = await listFlowRuns({
    status: req.query.status,
    flowId: req.query.flowId,
    flowKey: req.query.flowKey,
    contactId: req.query.contactId,
  });
  return res.json({ ok: true, items });
});

router.get("/flow-runs/automation/status", (req, res) => {
  return res.json({ ok: true, item: getFlowAutomationQueueStatus() });
});

router.get("/flow-runs/summary/stages", async (req, res) => {
  const flowId = String(req.query.flowId || "").trim();
  const flow = flowId ? await getFlowById(flowId) : null;
  const items = await summarizeFlowRunsByNode(flowId);

  if (flow && flow.definition && Array.isArray(flow.definition.nodes)) {
    const nodeMap = new Map(flow.definition.nodes.map((node) => [String(node.id), node]));
    const enriched = items.map((item) => {
      const node = nodeMap.get(String(item.nodeId));
      return { ...item, nodeTitle: node ? String(node.t || node.s || item.nodeId) : item.nodeId };
    });
    return res.json({ ok: true, items: enriched });
  }

  return res.json({ ok: true, items });
});

router.get("/flow-runs/:id", async (req, res) => {
  const item = await getFlowRunById(req.params.id);
  if (!item) {
    return res.status(404).json({ ok: false, error: { code: "FLOW_RUN_NOT_FOUND", message: "Execucao de fluxo nao encontrada." } });
  }
  return res.json({ ok: true, item });
});

router.post("/flow-runs/start", async (req, res) => {
  const parsed = startFlowRunSchema.parse(req.body || {});
  const flow = await resolveFlowFromStartInput(parsed);
  if (!flow) {
    return res.status(404).json({ ok: false, error: { code: "FLOW_NOT_FOUND", message: "Fluxo nao encontrado para iniciar execucao." } });
  }

  const allowDraft = parsed.allowDraft === true;
  if (!allowDraft && String(flow.status || "").toLowerCase() !== "published") {
    return res.status(400).json({ ok: false, error: { code: "FLOW_NOT_PUBLISHED", message: "Fluxo precisa estar publicado para iniciar execucao." } });
  }

  const contact = await getContactById(parsed.contactId);
  if (!contact) {
    return res.status(404).json({ ok: false, error: { code: "CONTACT_NOT_FOUND", message: "Contato nao encontrado para iniciar execucao." } });
  }

  const run = await createFlowRun({
    flowId: flow.id,
    contactId: parsed.contactId,
    startNodeId: parsed.startNodeId,
    ownerUserId: parsed.ownerUserId,
    context: parsed.context || {},
  });

  if (!run) {
    return res.status(400).json({ ok: false, error: { code: "FLOW_RUN_START_FAILED", message: "Nao foi possivel iniciar a execucao do fluxo." } });
  }

  const queued = await enqueueFlowAutomation({
    runId: run.id,
    reason: "RUN_STARTED",
    source: "api.flow-runs.start",
    force: false,
  });

  return res.status(201).json({ ok: true, item: run, automation: queued });
});

router.post("/flow-runs/:id/event", async (req, res) => {
  const parsed = flowRunEventSchema.parse(req.body || {});
  const result = await appendFlowRunEvent(req.params.id, {
    type: parsed.type,
    source: parsed.source || "api",
    payload: parsed.payload || {},
  });

  if (!result) {
    return res.status(404).json({ ok: false, error: { code: "FLOW_RUN_NOT_FOUND", message: "Execucao de fluxo nao encontrada para registrar evento." } });
  }

  let automation = { ok: true, queued: false, reason: "NO_TRANSITION" };
  if (result.transition?.moved && String(result.run?.status) === "active") {
    automation = await enqueueFlowAutomation({
      runId: result.run.id,
      reason: "TRANSITION_MOVED",
      source: "api.flow-runs.event",
      force: false,
    });
  }

  return res.json({
    ok: true,
    item: result.run,
    event: result.event,
    transition: result.transition,
    automation,
  });
});

export { router as flowRunsRouter };
