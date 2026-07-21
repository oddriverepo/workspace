import { claudeRequest } from "../claude-client.js";

const BASE_SYSTEM_PROMPT = `Você é um assistente de atendimento via WhatsApp, operando dentro de um fluxo automatizado.
Responda de forma natural, educada e objetiva. Use linguagem informal mas profissional.

REGRAS:
1. Respostas CURTAS (máx 3 parágrafos). WhatsApp não é email.
2. NUNCA invente informações que não foram fornecidas nas instruções.
3. Se não souber responder, diga que vai encaminhar para um atendente humano.
4. NUNCA peça dados sensíveis (CPF, senha, cartão de crédito).
5. Se o contato pedir para sair/cancelar/opt-out, respeite imediatamente.
6. Use emojis com moderação (máx 2 por mensagem).
7. Responda no mesmo idioma do contato (padrão: português brasileiro).

Responda SOMENTE com o texto da mensagem. Sem JSON, sem formatação especial.`;

export async function generateReply({
  inboundText,
  nodeInstructions = "",
  conversationHistory = [],
  contactName = "",
  businessContext = "",
}) {
  const systemPrompt = [
    BASE_SYSTEM_PROMPT,
    nodeInstructions ? `\nINSTRUÇÕES ESPECÍFICAS DO NÓ:\n${nodeInstructions}` : "",
    businessContext ? `\nCONTEXTO DO NEGÓCIO:\n${businessContext}` : "",
    contactName ? `\nNome do contato: ${contactName}` : "",
  ].filter(Boolean).join("\n");

  const messages = [];

  if (conversationHistory.length) {
    for (const msg of conversationHistory.slice(-10)) {
      messages.push({
        role: msg.direction === "inbound" ? "user" : "assistant",
        content: msg.text || msg.templateName || "[mensagem sem texto]",
      });
    }
  }

  messages.push({ role: "user", content: inboundText });

  const result = await claudeRequest({
    systemPrompt,
    messages,
    maxTokens: 1024,
    temperature: 0.5,
  });

  return { replyText: result.text.trim(), usage: result.usage };
}
