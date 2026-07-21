import { claudeJsonRequest } from "../claude-client.js";

const SYSTEM_PROMPT = `Você é o assistente de criação de templates HSM para WhatsApp Business API (Meta).
Sua tarefa é gerar templates com base na descrição em linguagem natural do usuário.

REGRAS OBRIGATÓRIAS:
1. O campo "name" deve ter APENAS letras minúsculas, números e underscore. Sem espaços, acentos ou caracteres especiais.
2. O campo "language" sempre PT_BR salvo indicação contrária.
3. Categorias válidas: marketing, utility, authentication, service.
4. bodyText é o texto principal do template. Use {{1}}, {{2}}, etc para variáveis.
5. headerText é opcional (máx 60 chars). headerType pode ser "none", "text" ou "image".
6. footerText é opcional (máx 60 chars).
7. buttons é um array (máx 3). Cada botão tem: type (quick_reply, url, phone_number), text (máx 25 chars), url (se type=url), phoneNumber (se type=phone_number).
8. NUNCA use linguagem urgente ou pressão ("ÚLTIMA CHANCE", "URGENTE", "AGORA OU NUNCA") - a Meta rejeita.
9. Sempre inclua opção de opt-out quando for marketing (ex: botão "Não quero receber").
10. Respeite a política da Meta: sem conteúdo enganoso, sem ameaças, sem dados sensíveis.

FORMATO DE RESPOSTA (JSON estrito):
{
  "name": "nome_do_template",
  "language": "pt_BR",
  "category": "marketing|utility|authentication|service",
  "headerType": "none|text|image",
  "headerText": "",
  "bodyText": "Texto principal com {{1}} variáveis",
  "footerText": "",
  "buttons": [
    { "type": "quick_reply", "text": "Texto do botão" }
  ],
  "explanation": "Breve explicação do que o template faz e por que foi estruturado assim"
}

Responda SOMENTE com o JSON. Nenhum texto antes ou depois.`;

export async function generateTemplate(userDescription) {
  const result = await claudeJsonRequest({
    systemPrompt: SYSTEM_PROMPT,
    messages: userDescription,
    maxTokens: 2048,
    temperature: 0.4,
  });

  const template = result.data;

  if (!template.name || !template.bodyText) {
    const error = new Error("Template gerado pela IA está incompleto.");
    error.code = "AI_TEMPLATE_INCOMPLETE";
    error.statusCode = 422;
    throw error;
  }

  template.name = String(template.name)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "");

  return {
    template: {
      name: template.name,
      language: template.language || "pt_BR",
      category: template.category || "marketing",
      headerType: template.headerType || "none",
      headerText: template.headerText || "",
      bodyText: template.bodyText,
      footerText: template.footerText || "",
      buttons: Array.isArray(template.buttons) ? template.buttons.slice(0, 3) : [],
    },
    explanation: template.explanation || "",
    usage: result.usage,
  };
}

export async function improveTemplate(currentTemplate, instructions) {
  const prompt = `Template atual:\n${JSON.stringify(currentTemplate, null, 2)}\n\nInstruções de melhoria: ${instructions}`;

  const result = await claudeJsonRequest({
    systemPrompt: SYSTEM_PROMPT,
    messages: prompt,
    maxTokens: 2048,
    temperature: 0.3,
  });

  const template = result.data;
  template.name = String(template.name)
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_{2,}/g, "_")
    .replace(/^_|_$/g, "");

  return {
    template: {
      name: template.name,
      language: template.language || "pt_BR",
      category: template.category || currentTemplate.category || "marketing",
      headerType: template.headerType || "none",
      headerText: template.headerText || "",
      bodyText: template.bodyText,
      footerText: template.footerText || "",
      buttons: Array.isArray(template.buttons) ? template.buttons.slice(0, 3) : [],
    },
    explanation: template.explanation || "",
    usage: result.usage,
  };
}
