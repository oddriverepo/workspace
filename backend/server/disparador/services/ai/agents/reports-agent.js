import { claudeRequest } from "../claude-client.js";
import {
  listContacts,
  listLists,
  listTemplates,
  listCampaigns,
  listFlows,
  listFlowRuns,
  listInboxConversations,
} from "../../../store/memory-store.js";

const SYSTEM_PROMPT = `Você é o analista de dados do Disparador ODDrive.
O usuário pede relatórios em linguagem natural e você analisa os dados do sistema para gerar insights.

REGRAS:
1. Responda em português brasileiro, de forma clara e direta.
2. Use números concretos sempre que possível.
3. Compare com períodos anteriores quando houver dados suficientes.
4. Identifique padrões e tendências.
5. Dê recomendações actionáveis.
6. Formate a resposta de forma legível (use bullet points, negrito, etc).
7. Se não houver dados suficientes para uma análise, diga isso claramente.

Responda em texto formatado (Markdown leve). NÃO responda em JSON.`;

function buildSystemSnapshot() {
  const contacts = listContacts();
  const lists = listLists();
  const templates = listTemplates();
  const campaigns = listCampaigns();
  const flows = listFlows();
  const flowRuns = listFlowRuns();
  const conversations = listInboxConversations({});

  const optInCount = contacts.filter((c) => c.optIn === true).length;
  const optOutCount = contacts.filter((c) => !!c.optOutAt).length;

  const campaignsByStatus = {};
  campaigns.forEach((c) => { campaignsByStatus[c.status] = (campaignsByStatus[c.status] || 0) + 1; });

  const totalSent = campaigns.reduce((sum, c) => sum + (c.metrics?.sent || 0), 0);
  const totalDelivered = campaigns.reduce((sum, c) => sum + (c.metrics?.delivered || 0), 0);
  const totalFailed = campaigns.reduce((sum, c) => sum + (c.metrics?.failed || 0), 0);

  const templatesByStatus = {};
  templates.forEach((t) => { templatesByStatus[t.status] = (templatesByStatus[t.status] || 0) + 1; });

  const flowRunsByStatus = {};
  flowRuns.forEach((r) => { flowRunsByStatus[r.status] = (flowRunsByStatus[r.status] || 0) + 1; });

  const unreadConversations = conversations.filter((c) => c.unreadCount > 0).length;

  return `SNAPSHOT DO SISTEMA:

CONTATOS:
- Total: ${contacts.length}
- Com opt-in: ${optInCount}
- Com opt-out: ${optOutCount}
- Sem decisão: ${contacts.length - optInCount - optOutCount}
- Fontes: ${[...new Set(contacts.map((c) => c.source))].join(", ") || "N/A"}
- Tags: ${[...new Set(contacts.flatMap((c) => c.tags || []))].join(", ") || "nenhuma"}

LISTAS:
- Total: ${lists.length}
${lists.map((l) => `- "${l.name}": ${l.contactsCount || l.contactIds?.length || 0} contatos`).join("\n")}

TEMPLATES:
- Total: ${templates.length}
- Por status: ${JSON.stringify(templatesByStatus)}
${templates.map((t) => `- "${t.name}" [${t.status}] categoria: ${t.category}`).join("\n")}

CAMPANHAS:
- Total: ${campaigns.length}
- Por status: ${JSON.stringify(campaignsByStatus)}
- Total enviadas: ${totalSent}
- Total entregues: ${totalDelivered}
- Total falhas: ${totalFailed}
- Taxa de entrega: ${totalSent > 0 ? ((totalDelivered / totalSent) * 100).toFixed(1) + "%" : "N/A"}

FLUXOS:
- Total: ${flows.length}
${flows.map((f) => `- "${f.name}" [${f.status}] v${f.version}`).join("\n")}

EXECUÇÕES DE FLUXO:
- Total: ${flowRuns.length}
- Por status: ${JSON.stringify(flowRunsByStatus)}

INBOX:
- Conversas: ${conversations.length}
- Não lidas: ${unreadConversations}`;
}

export async function generateReport(userQuestion) {
  const snapshot = buildSystemSnapshot();
  const prompt = `${snapshot}\n\nPERGUNTA DO USUÁRIO:\n${userQuestion}`;

  const result = await claudeRequest({
    systemPrompt: SYSTEM_PROMPT,
    messages: prompt,
    maxTokens: 4096,
    temperature: 0.3,
  });

  return { report: result.text, usage: result.usage };
}
