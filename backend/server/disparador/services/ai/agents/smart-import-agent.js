import { claudeJsonRequest } from "../claude-client.js";

const SYSTEM_PROMPT = `Você é o agente de importação inteligente do Disparador ODDrive.
O usuário envia headers de planilhas (CSV/XLSX) e você deve mapear cada coluna para os campos do sistema.

CAMPOS DO SISTEMA:
- phone (obrigatório): Número de telefone. Aliases comuns: telefone, celular, whatsapp, numero, fone, tel, mobile, phone_number
- name: Nome completo. Aliases: nome, contato, nome_completo, full_name, cliente
- firstName: Primeiro nome. Aliases: primeiro_nome, first_name
- optIn: Consentimento (boolean). Aliases: opt_in, optin, consentimento, aceite, aceito, consent
- tags: Tags/categorias. Aliases: tag, categoria, grupo, segmento, group
- externalId: ID externo. Aliases: id_externo, external_id, codigo, code, matricula
- source: Origem. Aliases: origem, fonte, canal, channel
- listName: Nome da lista para agrupar. Aliases: lista, list, grupo

FORMATO DE RESPOSTA (JSON estrito):
{
  "mapping": {
    "nome_coluna_original": "campo_do_sistema_ou_null"
  },
  "confidence": 0.0 a 1.0,
  "unmapped": ["colunas que nao conseguiu mapear"],
  "warnings": ["avisos sobre colunas problemáticas"],
  "suggestions": {
    "listName": "Sugestão de nome para a lista importada",
    "source": "Sugestão de source baseado nos dados"
  },
  "explanation": "Explicação do mapeamento"
}

"phone" é OBRIGATÓRIO — se não encontrar coluna de telefone, retorne confidence < 0.3.
Responda SOMENTE com JSON.`;

export async function analyzeHeaders(headers, sampleRows = []) {
  let prompt = `Headers da planilha:\n${JSON.stringify(headers)}`;

  if (sampleRows.length) {
    const sampleStr = sampleRows.slice(0, 5).map((row) => JSON.stringify(row)).join("\n");
    prompt += `\n\nPrimeiras linhas de exemplo:\n${sampleStr}`;
  }

  const result = await claudeJsonRequest({
    systemPrompt: SYSTEM_PROMPT,
    messages: prompt,
    maxTokens: 1024,
    temperature: 0.1,
  });

  return {
    mapping: result.data.mapping || {},
    confidence: result.data.confidence || 0,
    unmapped: result.data.unmapped || [],
    warnings: result.data.warnings || [],
    suggestions: result.data.suggestions || {},
    explanation: result.data.explanation || "",
    usage: result.usage,
  };
}

export async function fixPhoneNumbers(phones) {
  const prompt = `Corrija estes números de telefone brasileiros para formato E.164 (+55XXXXXXXXXXX).
  Se não for possível corrigir, retorne null.
  
  Números: ${JSON.stringify(phones)}
  
  Retorne JSON: { "fixed": [{ "original": "X", "corrected": "+55..." ou null, "issue": "descrição do problema ou null" }] }`;

  const result = await claudeJsonRequest({
    systemPrompt: "Você é um normalizador de números de telefone brasileiros. Responda SOMENTE com JSON.",
    messages: prompt,
    maxTokens: 2048,
    temperature: 0,
  });

  return { fixed: result.data.fixed || [], usage: result.usage };
}
