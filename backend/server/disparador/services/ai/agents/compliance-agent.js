import { claudeJsonRequest } from "../claude-client.js";

const SYSTEM_PROMPT = `Você é o guardião de compliance do Disparador ODDrive.
Sua tarefa é analisar templates e campanhas ANTES do envio e verificar conformidade com as regras da Meta/WhatsApp.

REGRAS DA META QUE DEVEM SER VERIFICADAS:
1. PROIBIDO linguagem urgente ou de pressão
2. PROIBIDO conteúdo enganoso ou promessas falsas
3. PROIBIDO ameaças ou intimidação
4. PROIBIDO solicitar dados sensíveis (CPF, senha, cartão)
5. PROIBIDO conteúdo discriminatório
6. PROIBIDO spam ou mensagens sem valor para o destinatário
7. Templates de MARKETING devem ter opção de opt-out
8. OBRIGATÓRIO respeitar janela de 24h (fora dela, só template aprovado)
9. Variáveis {{N}} devem ser usadas corretamente
10. Botões devem ter texto claro e URLs válidas

REGRAS LGPD/COMPLIANCE:
11. Contatos DEVEM ter opt-in registrado antes do envio
12. Opt-out deve ser processado imediatamente
13. Dados pessoais no template devem ser minimizados

FORMATO DE RESPOSTA (JSON estrito):
{
  "approved": true|false,
  "score": 0 a 100,
  "issues": [
    {
      "severity": "critical|warning|info",
      "rule": "número ou nome da regra violada",
      "description": "Descrição do problema",
      "suggestion": "Como corrigir"
    }
  ],
  "summary": "Resumo da análise em 1-2 frases",
  "autoFixable": true|false,
  "fixedTemplate": null
}

approved=false se qualquer issue "critical" existir.
Responda SOMENTE com JSON.`;

export async function analyzeTemplate(template) {
  const prompt = `Analise este template de WhatsApp:\n${JSON.stringify(template, null, 2)}`;

  const result = await claudeJsonRequest({
    systemPrompt: SYSTEM_PROMPT,
    messages: prompt,
    maxTokens: 2048,
    temperature: 0.1,
  });

  return { analysis: result.data, usage: result.usage };
}

export async function analyzeCampaign({ template, list, contactCount, eligibleCount, blockedCount }) {
  const prompt = `Analise esta campanha antes do disparo:

TEMPLATE:
${JSON.stringify(template, null, 2)}

DADOS DA CAMPANHA:
- Total de contatos na lista: ${contactCount}
- Elegíveis (com opt-in): ${eligibleCount}
- Bloqueados (sem opt-in ou opt-out): ${blockedCount}
- Nome da lista: ${list?.name || "N/A"}

Verifique:
1. O template está em conformidade?
2. A taxa de bloqueados é preocupante?
3. Há riscos de spam ou denúncia?`;

  const result = await claudeJsonRequest({
    systemPrompt: SYSTEM_PROMPT,
    messages: prompt,
    maxTokens: 2048,
    temperature: 0.1,
  });

  return { analysis: result.data, usage: result.usage };
}
