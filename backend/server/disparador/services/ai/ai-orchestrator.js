import { claudeJsonRequest, claudeRequest } from "./claude-client.js";
import { generateTemplate, improveTemplate } from "./agents/template-agent.js";
import { planCampaign } from "./agents/campaign-agent.js";
import { generateFlow, improveFlow } from "./agents/flow-builder-agent.js";
import { classifyMessage, classifyBatch } from "./agents/inbox-classifier.js";
import { generateReply } from "./agents/chatbot-agent.js";
import { analyzeTemplate, analyzeCampaign } from "./agents/compliance-agent.js";
import { generateReport } from "./agents/reports-agent.js";
import { analyzeHeaders, fixPhoneNumbers } from "./agents/smart-import-agent.js";

const ROUTER_SYSTEM_PROMPT = `Você é o roteador central de intenções do Disparador ODDrive.
Analise a mensagem do usuário e determine qual agente especializado deve tratar o pedido.

AGENTES DISPONÍVEIS:
1. "template" — Criar, melhorar ou editar templates de mensagem
2. "campaign" — Planejar, criar ou executar campanhas de disparo
3. "flow" — Criar, editar ou melhorar fluxos de automação
4. "classify" — Classificar mensagens recebidas de contatos
5. "chatbot" — Gerar resposta automática para contato
6. "compliance" — Verificar compliance de template ou campanha
7. "report" — Gerar relatórios e análises sobre dados do sistema
8. "import" — Ajudar com importação de planilhas/contatos
9. "general" — Conversa geral, dúvidas sobre o sistema, help

FORMATO DE RESPOSTA (JSON):
{
  "agent": "nome_do_agente",
  "confidence": 0.0 a 1.0,
  "extractedParams": {},
  "reasoning": "Por que escolheu esse agente"
}

Responda SOMENTE com JSON.`;

const GENERAL_SYSTEM_PROMPT = `Você é o assistente central do Disparador ODDrive, uma plataforma de disparo de mensagens WhatsApp via Meta Business API.

Você conhece todas as funcionalidades:
- Gerenciamento de contatos (importação CSV/XLSX/Push, opt-in/opt-out, tags)
- Listas de contatos
- Templates de mensagem HSM (criação, submissão à Meta, aprovação)
- Campanhas de disparo (para listas com templates aprovados)
- Fluxos de automação (editor visual com nós e arestas)
- Execução de fluxos (flow runs por contato)
- Inbox (conversas e mensagens)
- Webhooks Meta (recepção de eventos)
- Onboarding Meta (OAuth para conectar conta)

Responda de forma clara, objetiva e em português brasileiro.
Ajude o usuário a entender e usar a plataforma.`;

export async function routeIntent(userMessage) {
  const result = await claudeJsonRequest({
    systemPrompt: ROUTER_SYSTEM_PROMPT,
    messages: userMessage,
    maxTokens: 256,
    temperature: 0.1,
  });
  return result.data;
}

export async function handleMessage(userMessage, context = {}) {
  const routing = await routeIntent(userMessage);
  const agent = routing.agent || "general";
  const params = routing.extractedParams || {};

  let response;

  switch (agent) {
    case "template": {
      if (context.currentTemplate) {
        response = await improveTemplate(context.currentTemplate, userMessage);
        return { agent, action: "improve_template", ...response };
      }
      response = await generateTemplate(userMessage);
      return { agent, action: "generate_template", ...response };
    }
    case "campaign": {
      response = await planCampaign(userMessage);
      return { agent, ...response };
    }
    case "flow": {
      if (context.currentFlow) {
        response = await improveFlow(context.currentFlow, userMessage);
        return { agent, action: "improve_flow", ...response };
      }
      response = await generateFlow(userMessage);
      return { agent, action: "generate_flow", ...response };
    }
    case "classify": {
      const textToClassify = params.messageText || context.messageText || userMessage;
      response = await classifyMessage(textToClassify, context.conversationContext || "");
      return { agent, action: "classify_message", ...response };
    }
    case "chatbot": {
      response = await generateReply({
        inboundText: params.inboundText || context.inboundText || userMessage,
        nodeInstructions: context.nodeInstructions || "",
        conversationHistory: context.conversationHistory || [],
        contactName: context.contactName || "",
        businessContext: context.businessContext || "",
      });
      return { agent, action: "chatbot_reply", ...response };
    }
    case "compliance": {
      if (context.campaign) {
        response = await analyzeCampaign(context.campaign);
      } else if (context.template || context.currentTemplate) {
        response = await analyzeTemplate(context.template || context.currentTemplate);
      } else {
        return { agent, action: "need_context", message: "Envie o template ou campanha que deseja analisar." };
      }
      return { agent, action: "compliance_check", ...response };
    }
    case "report": {
      response = await generateReport(userMessage);
      return { agent, action: "report", ...response };
    }
    case "import": {
      if (context.headers) {
        response = await analyzeHeaders(context.headers, context.sampleRows || []);
        return { agent, action: "analyze_headers", ...response };
      }
      if (context.phones) {
        response = await fixPhoneNumbers(context.phones);
        return { agent, action: "fix_phones", ...response };
      }
      return { agent, action: "need_context", message: "Envie os headers da planilha ou os dados para analisar." };
    }
    case "general":
    default: {
      const result = await claudeRequest({
        systemPrompt: GENERAL_SYSTEM_PROMPT,
        messages: userMessage,
        maxTokens: 2048,
        temperature: 0.4,
      });
      return { agent: "general", action: "general_reply", reply: result.text, usage: result.usage };
    }
  }
}

export {
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
};
