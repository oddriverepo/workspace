import { env } from "../../config.js";

const CLAUDE_API_URL = "https://api.anthropic.com/v1/messages";
export const DEFAULT_MODEL = "claude-sonnet-4-20250514";
const ANTHROPIC_VERSION = "2023-06-01";

function getApiKey() {
  const key = env.anthropicApiKey;
  if (!key) {
    const error = new Error("ANTHROPIC_API_KEY nao configurada.");
    error.code = "MISSING_ANTHROPIC_KEY";
    error.statusCode = 400;
    throw error;
  }
  return key;
}

export async function claudeRequest({
  systemPrompt,
  messages,
  model,
  maxTokens = 4096,
  temperature = 0.3,
}) {
  const apiKey = getApiKey();
  const finalModel = model || env.anthropicModel || DEFAULT_MODEL;

  const formattedMessages = typeof messages === "string"
    ? [{ role: "user", content: messages }]
    : messages;

  const body = {
    model: finalModel,
    max_tokens: maxTokens,
    temperature,
    messages: formattedMessages,
  };

  if (systemPrompt) {
    body.system = systemPrompt;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  let response;
  try {
    response = await fetch(CLAUDE_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (fetchErr) {
    clearTimeout(timeout);
    if (fetchErr.name === "AbortError") {
      const error = new Error("Timeout: Claude API nao respondeu em 60 segundos.");
      error.code = "CLAUDE_TIMEOUT";
      error.statusCode = 504;
      throw error;
    }
    throw fetchErr;
  } finally {
    clearTimeout(timeout);
  }

  const payload = await response.json();

  if (!response.ok) {
    const error = new Error(
      `Erro Claude API (${response.status}): ${payload?.error?.message || "Erro desconhecido"}`
    );
    error.code = "CLAUDE_API_ERROR";
    error.statusCode = response.status;
    error.meta = payload;
    throw error;
  }

  const textContent = (payload.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");

  return {
    text: textContent,
    usage: payload.usage || {},
    model: payload.model || finalModel,
    stopReason: payload.stop_reason || "",
  };
}

export async function claudeJsonRequest(options) {
  const result = await claudeRequest({
    ...options,
    temperature: options.temperature ?? 0.1,
  });

  const raw = result.text.trim();

  const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    try {
      return { data: JSON.parse(jsonMatch[1].trim()), raw, usage: result.usage };
    } catch (_) { /* fall through */ }
  }

  try {
    return { data: JSON.parse(raw), raw, usage: result.usage };
  } catch (_) { /* fall through */ }

  const bracketMatch = raw.match(/([{\[][\s\S]*[}\]])/);
  if (bracketMatch) {
    try {
      return { data: JSON.parse(bracketMatch[1]), raw, usage: result.usage };
    } catch (_) { /* fall through */ }
  }

  const error = new Error("Claude retornou resposta que nao e JSON valido.");
  error.code = "CLAUDE_INVALID_JSON";
  error.statusCode = 502;
  error.meta = { rawText: raw };
  throw error;
}
