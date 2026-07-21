import { Router } from "express";
import { z } from "zod";
import { env } from "../config.js";
import {
  handleMessage,
  generateTemplate,
  improveTemplate,
  planCampaign,
  generateFlow,
  improveFlow,
  classifyMessage,
  classifyBatch,
  generateReply,
  analyzeTemplate,
  analyzeCampaign,
  generateReport,
  analyzeHeaders,
  fixPhoneNumbers,
} from "../services/ai/ai-orchestrator.js";
import {
  getTemplateById,
  getFlowById,
  getCampaignById,
  getListById,
  getContactById,
} from "../store/memory-store.js";

const router = Router();

// ─── Chat Central (Orchestrator) ────────────────────────────────
const chatSchema = z.object({
  message: z.string().min(1).max(5000),
  context: z.record(z.any()).optional(),
});

router.post("/ai/chat", async (req, res) => {
  const { message, context } = chatSchema.parse(req.body || {});
  const result = await handleMessage(message, context || {});
  return res.json({ ok: true, ...result });
});

// ─── Template Agent ─────────────────────────────────────────────
const templateGenSchema = z.object({
  description: z.string().min(3).max(3000),
});

router.post("/ai/templates/generate", async (req, res) => {
  const { description } = templateGenSchema.parse(req.body || {});
  const result = await generateTemplate(description);
  return res.json({ ok: true, ...result });
});

const templateImproveSchema = z.object({
  templateId: z.string().optional(),
  template: z.record(z.any()).optional(),
  instructions: z.string().min(3).max(3000),
});

router.post("/ai/templates/improve", async (req, res) => {
  const parsed = templateImproveSchema.parse(req.body || {});
  let template = parsed.template;
  if (!template && parsed.templateId) {
    template = await getTemplateById(parsed.templateId);
    if (!template) return res.status(404).json({ ok: false, error: { code: "TEMPLATE_NOT_FOUND", message: "Template nao encontrado." } });
  }
  if (!template) return res.status(400).json({ ok: false, error: { code: "MISSING_TEMPLATE", message: "Envie template ou templateId." } });
  const result = await improveTemplate(template, parsed.instructions);
  return res.json({ ok: true, ...result });
});

// ─── Campaign Agent ─────────────────────────────────────────────
const campaignPlanSchema = z.object({
  description: z.string().min(3).max(3000),
});

router.post("/ai/campaigns/plan", async (req, res) => {
  const { description } = campaignPlanSchema.parse(req.body || {});
  const result = await planCampaign(description);
  return res.json({ ok: true, ...result });
});

// ─── Flow Builder Agent ─────────────────────────────────────────
const flowGenSchema = z.object({
  description: z.string().min(3).max(5000),
});

router.post("/ai/flows/generate", async (req, res) => {
  const { description } = flowGenSchema.parse(req.body || {});
  const result = await generateFlow(description);
  return res.json({ ok: true, ...result });
});

const flowImproveSchema = z.object({
  flowId: z.string().optional(),
  flow: z.record(z.any()).optional(),
  instructions: z.string().min(3).max(5000),
});

router.post("/ai/flows/improve", async (req, res) => {
  const parsed = flowImproveSchema.parse(req.body || {});
  let flow = parsed.flow;
  if (!flow && parsed.flowId) {
    flow = await getFlowById(parsed.flowId);
    if (!flow) return res.status(404).json({ ok: false, error: { code: "FLOW_NOT_FOUND", message: "Fluxo nao encontrado." } });
  }
  if (!flow) return res.status(400).json({ ok: false, error: { code: "MISSING_FLOW", message: "Envie flow ou flowId." } });
  const result = await improveFlow(flow, parsed.instructions);
  return res.json({ ok: true, ...result });
});

// ─── Inbox Classifier ───────────────────────────────────────────
const classifySchema = z.object({
  text: z.string().min(1).max(2000),
  conversationContext: z.string().max(5000).optional(),
});

router.post("/ai/inbox/classify", async (req, res) => {
  const parsed = classifySchema.parse(req.body || {});
  const result = await classifyMessage(parsed.text, parsed.conversationContext || "");
  return res.json({ ok: true, ...result });
});

const classifyBatchSchema = z.object({
  messages: z.array(z.object({
    text: z.string().min(1),
    from: z.string().optional(),
  })).min(1).max(50),
});

router.post("/ai/inbox/classify-batch", async (req, res) => {
  const { messages } = classifyBatchSchema.parse(req.body || {});
  const result = await classifyBatch(messages);
  return res.json({ ok: true, ...result });
});

// ─── Chatbot Agent ──────────────────────────────────────────────
const chatbotSchema = z.object({
  inboundText: z.string().min(1).max(2000),
  nodeInstructions: z.string().max(3000).optional(),
  conversationHistory: z.array(z.object({
    direction: z.enum(["inbound", "outbound"]),
    text: z.string().optional(),
    templateName: z.string().optional(),
  })).optional(),
  contactName: z.string().max(200).optional(),
  businessContext: z.string().max(3000).optional(),
});

router.post("/ai/chatbot/reply", async (req, res) => {
  const parsed = chatbotSchema.parse(req.body || {});
  const result = await generateReply(parsed);
  return res.json({ ok: true, ...result });
});

// ─── Compliance Agent ───────────────────────────────────────────
const complianceTemplateSchema = z.object({
  templateId: z.string().optional(),
  template: z.record(z.any()).optional(),
});

router.post("/ai/compliance/template", async (req, res) => {
  const parsed = complianceTemplateSchema.parse(req.body || {});
  let template = parsed.template;
  if (!template && parsed.templateId) {
    template = await getTemplateById(parsed.templateId);
    if (!template) return res.status(404).json({ ok: false, error: { code: "TEMPLATE_NOT_FOUND", message: "Template nao encontrado." } });
  }
  if (!template) return res.status(400).json({ ok: false, error: { code: "MISSING_TEMPLATE", message: "Envie template ou templateId." } });
  const result = await analyzeTemplate(template);
  return res.json({ ok: true, ...result });
});

const complianceCampaignSchema = z.object({
  campaignId: z.string().min(1),
});

router.post("/ai/compliance/campaign", async (req, res) => {
  const { campaignId } = complianceCampaignSchema.parse(req.body || {});
  const campaign = await getCampaignById(campaignId);
  if (!campaign) return res.status(404).json({ ok: false, error: { code: "CAMPAIGN_NOT_FOUND", message: "Campanha nao encontrada." } });

  const template = await getTemplateById(campaign.templateId);
  const list = await getListById(campaign.listId);
  const contactIds = list?.contactIds || [];
  const contactCount = contactIds.length;

  let eligibleCount = 0;
  let blockedCount = 0;
  for (const cid of contactIds) {
    const contact = await getContactById(cid);
    if (contact && contact.optIn && !contact.optOutAt) {
      eligibleCount++;
    } else {
      blockedCount++;
    }
  }

  const result = await analyzeCampaign({ template, list, contactCount, eligibleCount, blockedCount });
  return res.json({ ok: true, ...result });
});

// ─── Reports Agent ──────────────────────────────────────────────
const reportSchema = z.object({
  question: z.string().min(3).max(3000),
});

router.post("/ai/reports", async (req, res) => {
  const { question } = reportSchema.parse(req.body || {});
  const result = await generateReport(question);
  return res.json({ ok: true, ...result });
});

// ─── Smart Import Agent ─────────────────────────────────────────
const headersSchema = z.object({
  headers: z.array(z.string()).min(1),
  sampleRows: z.array(z.record(z.any())).optional(),
});

router.post("/ai/import/analyze-headers", async (req, res) => {
  const parsed = headersSchema.parse(req.body || {});
  const result = await analyzeHeaders(parsed.headers, parsed.sampleRows || []);
  return res.json({ ok: true, ...result });
});

const fixPhonesSchema = z.object({
  phones: z.array(z.string()).min(1).max(200),
});

router.post("/ai/import/fix-phones", async (req, res) => {
  const { phones } = fixPhonesSchema.parse(req.body || {});
  const result = await fixPhoneNumbers(phones);
  return res.json({ ok: true, ...result });
});

// ─── Status ─────────────────────────────────────────────────────
router.get("/ai/status", (req, res) => {
  const configured = Boolean(env.anthropicApiKey);
  return res.json({
    ok: true,
    ai: {
      configured,
      provider: "anthropic",
      model: env.anthropicModel || "claude-sonnet-4-20250514",
      agents: [
        "template", "campaign", "flow-builder", "inbox-classifier",
        "chatbot", "compliance", "reports", "smart-import",
      ],
    },
  });
});

export { router as aiRouter };
