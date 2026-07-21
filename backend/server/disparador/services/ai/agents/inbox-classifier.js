import { claudeJsonRequest } from "../claude-client.js";

const SYSTEM_PROMPT = `Você é o classificador de mensagens do Disparador ODDrive.
Sua tarefa é analisar mensagens recebidas de contatos via WhatsApp e classificar a intenção.

CATEGORIAS DE INTENÇÃO:
- "interested" — Contato demonstra interesse
- "purchase_intent" — Intenção de compra
- "question" — Pergunta genérica
- "positive" — Resposta positiva genérica
- "negative" — Resposta negativa
- "opt_out" — Quer sair/parar
- "complaint" — Reclamação
- "support" — Precisa de ajuda/suporte
- "greeting" — Saudação
- "thanks" — Agradecimento
- "unclear" — Não foi possível classificar

FORMATO DE RESPOSTA (JSON estrito):
{
  "intent": "categoria",
  "confidence": 0.0 a 1.0,
  "sentiment": "positive|neutral|negative",
  "suggestedAction": "reply|escalate|opt_out|advance_flow|none",
  "suggestedReply": "Sugestão de resposta se aplicável",
  "summary": "Resumo de 1 frase do que o contato quer",
  "flowEventType": "inbound.text|inbound.button|opt_out.requested|null"
}

Responda SOMENTE com JSON.`;

export async function classifyMessage(messageText, conversationContext = "") {
  const prompt = conversationContext
    ? `Contexto da conversa:\n${conversationContext}\n\nMensagem a classificar:\n"${messageText}"`
    : `Mensagem a classificar:\n"${messageText}"`;

  const result = await claudeJsonRequest({
    systemPrompt: SYSTEM_PROMPT,
    messages: prompt,
    maxTokens: 512,
    temperature: 0.1,
  });

  return { classification: result.data, usage: result.usage };
}

export async function classifyBatch(messages) {
  const items = messages.map((msg, i) => `[${i + 1}] "${msg.text}" (de: ${msg.from || "desconhecido"})`).join("\n");
  const prompt = `Classifique CADA mensagem abaixo. Retorne um array JSON com uma classificação por mensagem, na mesma ordem.\n\n${items}`;

  const result = await claudeJsonRequest({
    systemPrompt: SYSTEM_PROMPT + "\n\nPara classificação em lote, retorne um ARRAY de objetos no mesmo formato.",
    messages: prompt,
    maxTokens: 2048,
    temperature: 0.1,
  });

  const classifications = Array.isArray(result.data) ? result.data : [result.data];
  return { classifications, usage: result.usage };
}
