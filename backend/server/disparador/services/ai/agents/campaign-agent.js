import { claudeJsonRequest } from "../claude-client.js";
import {
  listContacts,
  listLists,
  listTemplates,
  getListById,
  getTemplateById,
} from "../../../store/memory-store.js";

const SYSTEM_PROMPT = `Você é o agente de campanhas do Disparador ODDrive.
O usuário descreve em linguagem natural o que quer fazer e você monta o plano da campanha.

Você tem acesso ao estado atual do sistema (listas, templates, contatos) que será fornecido no contexto.

Sua tarefa é interpretar a intenção do usuário e retornar um plano de campanha que o sistema pode executar.

FORMATO DE RESPOSTA (JSON estrito):
{
  "action": "create_campaign",
  "plan": {
    "name": "Nome da campanha",
    "listId": "ID da lista existente OU null se precisa criar",
    "listName": "Nome da lista (se precisa criar/usar por nome)",
    "templateId": "ID do template existente OU null se precisa criar",
    "templateDescription": "Se templateId=null, descreve o template que deve ser gerado pela IA",
    "filters": {
      "tags": ["tag1"],
      "optInOnly": true,
      "contactIds": []
    },
    "simulate": true,
    "dryRun": false
  },
  "steps": [
    "Passo 1: Descrição do que será feito",
    "Passo 2: ..."
  ],
  "warnings": ["Avisos importantes, se houver"],
  "explanation": "Explicação do plano em linguagem natural"
}

Se o usuário pedir algo impossível ou sem dados suficientes, retorne:
{
  "action": "need_info",
  "questions": ["O que precisa saber"],
  "explanation": "Por que precisa dessa informação"
}

Responda SOMENTE com JSON.`;

function buildContext() {
  const contacts = listContacts();
  const lists = listLists();
  const templates = listTemplates();

  return `ESTADO ATUAL DO SISTEMA:
- Contatos: ${contacts.length} total (${contacts.filter((c) => c.optIn).length} com opt-in)
- Listas: ${lists.map((l) => `"${l.name}" (${l.contactsCount || l.contactIds?.length || 0} contatos, id: ${l.id})`).join(", ") || "nenhuma"}
- Templates: ${templates.map((t) => `"${t.name}" [${t.status}] (categoria: ${t.category}, id: ${t.id})`).join(", ") || "nenhum"}
- Tags em uso: ${[...new Set(contacts.flatMap((c) => c.tags || []))].join(", ") || "nenhuma"}`;
}

export async function planCampaign(userDescription) {
  const context = buildContext();
  const prompt = `${context}\n\nSOLICITAÇÃO DO USUÁRIO:\n${userDescription}`;

  const result = await claudeJsonRequest({
    systemPrompt: SYSTEM_PROMPT,
    messages: prompt,
    maxTokens: 2048,
    temperature: 0.2,
  });

  const plan = result.data;

  if (plan.action === "need_info") {
    return { action: "need_info", questions: plan.questions, explanation: plan.explanation, usage: result.usage };
  }

  if (plan.plan?.listId) {
    const list = getListById(plan.plan.listId);
    if (!list) plan.plan.listId = null;
  }

  if (plan.plan?.templateId) {
    const template = getTemplateById(plan.plan.templateId);
    if (!template) plan.plan.templateId = null;
  }

  return {
    action: plan.action || "create_campaign",
    plan: plan.plan,
    steps: plan.steps || [],
    warnings: plan.warnings || [],
    explanation: plan.explanation || "",
    usage: result.usage,
  };
}
