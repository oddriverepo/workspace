# Evidências recebidas pelo GPT Maker

## Endpoints usados pelo agente

### Consulta por telefone

`POST /api/agent/search-campaign-status-by-contact`

Payload:

```json
{
  "phone": "5511999999999"
}
```

Essa consulta usa correspondência exata de DDD e número. Ela não consulta cidade
e não carrega o histórico de evidências.

### Registro de imagem

`POST /api/agent/evidences/register-image`

Autenticação:

```http
Authorization: Bearer <AGENT_WEBHOOK_SECRET>
Content-Type: application/json
```

Payload:

```json
{
  "phone": "5511999999999",
  "chat_id": "ID_DO_CHAT",
  "message_id": "ID_DA_MENSAGEM",
  "image_url": "https://...",
  "media_type": "IMAGE",
  "message_time": 1784049551189,
  "caption": "texto opcional",
  "evidence_type": "odometro"
}
```

Se `image_url` não estiver disponível, `chat_id` é obrigatório. O backend consulta
a mensagem na API do GPT Maker e obtém a URL sem expô-la na resposta.

Tipos reconhecidos:

- `odometro`
- `frontal`
- `traseira`
- `lateral_esquerda`
- `lateral_direita`
- `comprovante`
- `outro`
- `desconhecido`

O agente deve responder ao motorista somente com o campo `safe_reply`.
Os dois endpoints usam a mesma autenticação Bearer descrita acima.

### Evento automático do GPT Maker

O processamento principal das imagens recebidas usa:

`POST /api/agent/evidences/on-new-message`

Para descobrir o formato real enviado pela conta do GPT Maker sem expor dados
pessoais, use temporariamente:

`POST /api/agent/evidences/on-new-message-debug`

As duas rotas aceitam `Authorization: Bearer <AGENT_WEBHOOK_SECRET>` ou o
cabeçalho `X-Agent-Webhook-Secret`. Como o evento automático do GPT Maker não
permite configurar cabeçalhos, somente essas duas rotas também aceitam
`?secret=<AGENT_WEBHOOK_SECRET>` ou
`?webhook_secret=<AGENT_WEBHOOK_SECRET>`. O segredo é removido da URL da
requisição após a autenticação e o logger HTTP da aplicação não registra query
strings.

Os eventos automáticos possuem limite separado das consultas do agente. O
valor padrão é 300 eventos por minuto, configurável por
`AGENT_EVIDENCE_EVENT_RATE_LIMIT_PER_MINUTE`, para que mensagens simultâneas do
mesmo IP do GPT Maker não consumam o limite das consultas convencionais.

Temporariamente, a rota de diagnóstico registra um snapshot sanitizado do
corpo recebido para mapear a estrutura real do evento. O snapshot mantém nomes
de chaves e a estrutura de objetos, limita arrays aos três primeiros itens e
mascara strings, telefones, URLs, mídias e identificadores longos. Credenciais,
segredos, senhas e dados pessoais conhecidos são substituídos por
`[REDACTED]`. O valor do segredo da URL e os cabeçalhos de autenticação nunca
são incluídos nesse log.

O evento definitivo:

1. ignora mensagens do agente e mensagens que não sejam imagens;
2. extrai telefone, chat e mensagem de formatos conhecidos do payload;
3. usa o telefone no final do `chatId` quando o campo não vier separado;
4. consulta a API do GPT Maker quando faltar telefone, `imageUrl` ou
   `messageId`, reaproveitando uma única resposta para completar os campos;
5. delega a gravação ao mesmo fluxo idempotente usado por `register-image`.

A rota `register-image` permanece como apoio conversacional. O evento
`on-new-message` é a fonte principal para capturar a mídia recebida.

## Variáveis

```env
AGENT_WEBHOOK_SECRET=
GOOGLE_DRIVE_EVIDENCE_FOLDER_ID=
GPTMAKER_API_TOKEN=
AGENT_EVIDENCE_MAX_IMAGE_BYTES=12582912
AGENT_EVIDENCE_DOWNLOAD_TIMEOUT_MS=20000
AGENT_EVIDENCE_EVENT_RATE_LIMIT_PER_MINUTE=300
```

O Google OAuth já utilizado pelo gerador precisa estar conectado e possuir o
escopo do Drive. A pasta informada permanece privada; a visualização ocorre por
uma rota autenticada do backend.

## Comportamento

1. Normaliza o telefone e procura o motorista no mirror local.
2. Usa a campanha ativa quando existir; motorista cadastrado sem campanha
   também pode enviar imagens para validação.
3. Reserva `message_id` de forma idempotente.
4. Valida e baixa a imagem com limite de tamanho e bloqueio de rede privada.
5. Organiza o arquivo por campanha, motorista e data no Google Drive.
6. Registra a evidência no MongoDB.
7. A galeria atual da campanha passa a exibir a imagem sem expor o Drive.

O sistema não persiste a URL assinada original da imagem, pois ela pode conter
credenciais temporárias. Apenas o host de origem é mantido para auditoria.
