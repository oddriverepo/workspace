import { claudeJsonRequest } from "../claude-client.js";
import { randomUUID } from "crypto";

const SYSTEM_PROMPT = `Você é o construtor de fluxos de automação do Disparador ODDrive.
O usuário descreve em linguagem natural o fluxo que quer criar e você gera a estrutura completa.

ESTRUTURA DO FLUXO:
Um fluxo tem "nodes" (etapas) e "edges" (conexões entre etapas).

TIPOS DE NÓS (type):
- "start" - Nó inicial (obrigatório, sempre o primeiro)
- "dispatch" - Envia template de mensagem (runtimeConfig.kind = "dispatch")
- "wait" - Espera evento do contato (runtimeConfig.kind = "wait", runtimeConfig.waitEvent = tipo)
- "delay" - Espera tempo (runtimeConfig.kind = "delay", runtimeConfig.timeoutMinutes = N)
- "condition" - Decisão sim/não (runtimeConfig.kind = "condition")
- "action" - Ação do sistema
- "ai-reply" - Resposta inteligente via IA (runtimeConfig.kind = "ai-reply")
- "end" - Nó final (runtimeConfig.kind = "end")

ESTRUTURA DE NÓ:
{
  "id": "node_XXXX",
  "t": "Título do nó",
  "s": "Subtítulo",
  "d": "Descrição detalhada",
  "type": "tipo do nó",
  "x": posição X no canvas,
  "y": posição Y no canvas,
  "runtimeConfig": {
    "kind": "dispatch|wait|delay|condition|end|ai-reply",
    "templateName": "nome_template",
    "autoStart": true/false,
    "waitEvent": "inbound.text|inbound.button",
    "timeoutMinutes": N,
    "timeoutNextNodeId": "node_X",
    "aiInstructions": "Instruções para o agente IA"
  }
}

ESTRUTURA DE ARESTA:
{
  "id": "edge_XXXX",
  "f": "node_origem",
  "t": "node_destino",
  "l": "label da aresta",
  "k": "event_key"
}

REGRAS:
1. Todo fluxo DEVE começar com um nó "start".
2. Todo fluxo DEVE terminar com pelo menos um nó "end".
3. Nós de condição DEVEM ter exatamente 2 arestas: uma com label "Sim" e outra "Não".
4. Distribua nós no canvas de forma visualmente organizada.
5. IDs devem ser únicos e descritivos.
6. Gere o campo "key" do fluxo: slug em minúsculas com underscores.

FORMATO DE RESPOSTA (JSON estrito):
{
  "key": "slug_do_fluxo",
  "name": "Nome do Fluxo",
  "description": "Descrição do que o fluxo faz",
  "definition": {
    "nodes": [...],
    "edges": [...]
  },
  "explanation": "Explicação passo a passo do fluxo gerado",
  "suggestedTemplates": [
    {
      "name": "nome_template",
      "bodyText": "Texto sugerido para o template usado neste fluxo"
    }
  ]
}

Responda SOMENTE com JSON.`;

export async function generateFlow(userDescription) {
  const result = await claudeJsonRequest({
    systemPrompt: SYSTEM_PROMPT,
    messages: userDescription,
    maxTokens: 8192,
    temperature: 0.3,
  });

  const flow = result.data;

  if (!flow.key || !flow.definition?.nodes?.length) {
    const error = new Error("Fluxo gerado pela IA está incompleto.");
    error.code = "AI_FLOW_INCOMPLETE";
    error.statusCode = 422;
    throw error;
  }

  flow.key = String(flow.key).toLowerCase().replace(/[^a-z0-9_-]/g, "_").replace(/_{2,}/g, "_").replace(/^_|_$/g, "");
  flow.definition.nodes.forEach((node) => { if (!node.id) node.id = `node_${randomUUID().slice(0, 8)}`; });
  flow.definition.edges.forEach((edge) => { if (!edge.id) edge.id = `edge_${randomUUID().slice(0, 8)}`; });

  return {
    flow: { key: flow.key, name: flow.name, description: flow.description || "", definition: flow.definition },
    explanation: flow.explanation || "",
    suggestedTemplates: flow.suggestedTemplates || [],
    usage: result.usage,
  };
}

export async function improveFlow(currentFlow, instructions) {
  const prompt = `Fluxo atual:\n${JSON.stringify(currentFlow, null, 2)}\n\nInstruções de melhoria: ${instructions}`;

  const result = await claudeJsonRequest({
    systemPrompt: SYSTEM_PROMPT,
    messages: prompt,
    maxTokens: 8192,
    temperature: 0.3,
  });

  const flow = result.data;
  flow.key = String(flow.key || currentFlow.key).toLowerCase().replace(/[^a-z0-9_-]/g, "_").replace(/_{2,}/g, "_").replace(/^_|_$/g, "");
  flow.definition.nodes.forEach((node) => { if (!node.id) node.id = `node_${randomUUID().slice(0, 8)}`; });
  flow.definition.edges.forEach((edge) => { if (!edge.id) edge.id = `edge_${randomUUID().slice(0, 8)}`; });

  return {
    flow: { key: flow.key, name: flow.name || currentFlow.name, description: flow.description || currentFlow.description || "", definition: flow.definition },
    explanation: flow.explanation || "",
    suggestedTemplates: flow.suggestedTemplates || [],
    usage: result.usage,
  };
}
