import { Router } from "express";
import { z } from "zod";
import { env } from "../config.js";
import {
  createOnboardingSession,
  completeOnboardingSession,
  getOnboardingSession,
} from "../store/memory-store.js";
import {
  exchangeCodeForAccessToken,
  testMetaConnection,
  listPhoneNumbers,
  clearTokenCache,
} from "../services/meta-client.js";
import { setRuntimeConfig } from "../store/runtime-config.repo.js";

const router = Router();

const createSessionSchema = z.object({
  redirectUri: z.string().url().optional(),
});

function buildMetaOnboardingUrl(state, redirectUri) {
  const params = new URLSearchParams();
  params.set("state", state);
  if (env.metaAppId) params.set("app_id", env.metaAppId);
  if (env.metaConfigId) params.set("config_id", env.metaConfigId);
  if (redirectUri) params.set("redirect_uri", redirectUri);
  return `https://www.facebook.com/${env.metaApiVersion}/dialog/oauth?${params.toString()}`;
}

function validateMetaOnboardingSetup() {
  const missing = [];
  if (!env.metaAppId) missing.push("META_APP_ID");
  if (!env.metaConfigId) missing.push("META_CONFIG_ID");

  if (!missing.length) {
    if (!/^\d+$/.test(String(env.metaAppId))) {
      return { ok: false, missing: [], invalid: ["META_APP_ID"] };
    }
    return { ok: true, missing: [], invalid: [] };
  }

  return { ok: false, missing, invalid: [] };
}

function summarizeTokenExchange(tokenExchange) {
  if (!tokenExchange) return null;
  return {
    tokenType: tokenExchange.token_type || tokenExchange.tokenType || "",
    expiresIn: tokenExchange.expires_in || tokenExchange.expiresIn || null,
    hasAccessToken: Boolean(tokenExchange.access_token || tokenExchange.accessToken),
  };
}

function summarizeTokenExchangeError(error = {}) {
  if (!error) return null;
  return {
    code: error.code || "TOKEN_EXCHANGE_ERROR",
    message: error.message || "Falha ao trocar code por access token na Meta.",
  };
}

function sanitizeOnboardingSession(session = {}) {
  if (!session || typeof session !== "object") return session;
  const callback = session.callback && typeof session.callback === "object"
    ? {
        ...session.callback,
        tokenExchange: summarizeTokenExchange(session.callback.tokenExchange),
        tokenExchangeError: summarizeTokenExchangeError(session.callback.tokenExchangeError),
      }
    : session.callback;
  return { ...session, callback };
}

router.post("/meta/onboarding/session", async (req, res) => {
  const parsed = createSessionSchema.parse(req.body || {});
  const setup = validateMetaOnboardingSetup();

  if (!setup.ok) {
    return res.status(400).json({
      ok: false,
      error: {
        code: "META_SETUP_MISSING",
        message: "Configuracao da Meta incompleta para gerar o link oficial.",
        details: { missing: setup.missing, invalid: setup.invalid },
      },
      hint: "Preencha META_APP_ID e META_CONFIG_ID no backend/.env com os valores reais do app da Meta.",
    });
  }

  const session = await createOnboardingSession({
    redirectUri: parsed.redirectUri || `${env.appBaseUrl}/api/disparador/meta/onboarding/callback`,
    requestId: req.requestId,
  });

  const startUrl = buildMetaOnboardingUrl(session.state, session.payload.redirectUri);

  return res.status(201).json({
    ok: true,
    item: {
      state: session.state,
      redirectUri: session.payload.redirectUri,
      startUrl,
      note: "Use esta URL para iniciar o fluxo oficial da Meta (Embedded Signup/Facebook Login for Business).",
    },
  });
});

router.get("/meta/onboarding/callback", async (req, res) => {
  const querySchema = z.object({
    code: z.string().optional(),
    state: z.string().optional(),
    error: z.string().optional(),
    error_description: z.string().optional(),
  });

  const parsed = querySchema.parse(req.query || {});
  const stateValue = parsed.state || "";

  if (!stateValue) {
    return res.status(400).json({ ok: false, error: { code: "MISSING_STATE", message: "Parametro state ausente no callback." } });
  }

  const session = await getOnboardingSession(stateValue);
  if (!session) {
    return res.status(404).json({ ok: false, error: { code: "SESSION_NOT_FOUND", message: "Sessao de onboarding nao encontrada para o state informado." } });
  }

  let tokenExchange = null;
  let tokenExchangeError = null;
  let tokenPersisted = false;

  if (parsed.code) {
    try {
      tokenExchange = await exchangeCodeForAccessToken({
        code: parsed.code,
        redirectUri: session.payload.redirectUri,
      });

      // Persist token to MongoDB so it survives restarts
      if (tokenExchange && tokenExchange.access_token) {
        try {
          await setRuntimeConfig("META_SYSTEM_USER_TOKEN", tokenExchange.access_token);
          clearTokenCache();
          tokenPersisted = true;
          console.log("[META ONBOARDING] Token persistido com sucesso.");
        } catch (persistErr) {
          console.error("[META ONBOARDING] Falha ao persistir token:", persistErr.message);
        }
      }
    } catch (err) {
      tokenExchangeError = {
        code: err.code || "TOKEN_EXCHANGE_ERROR",
        message: err.message,
        meta: err.meta || null,
      };
    }
  }

  const completed = await completeOnboardingSession(stateValue, {
    code: parsed.code || "",
    error: parsed.error || "",
    errorDescription: parsed.error_description || "",
    query: req.query,
    tokenExchange: summarizeTokenExchange(tokenExchange),
    tokenExchangeError: summarizeTokenExchangeError(tokenExchangeError),
  });

  return res.json({
    ok: true,
    item: {
      state: completed.state,
      status: completed.status,
      completedAt: completed.completedAt,
      hasCode: Boolean(completed.callback.code),
      tokenExchangeOk: Boolean(tokenExchange && tokenExchange.access_token),
      tokenPersisted,
    },
    tokenExchange: summarizeTokenExchange(tokenExchange),
    tokenExchangeError: summarizeTokenExchangeError(tokenExchangeError),
  });
});

router.get("/meta/onboarding/session/:state", async (req, res) => {
  const session = await getOnboardingSession(req.params.state);
  if (!session) {
    return res.status(404).json({ ok: false, error: { code: "SESSION_NOT_FOUND", message: "Sessao nao encontrada." } });
  }
  return res.json({ ok: true, item: sanitizeOnboardingSession(session) });
});

router.get("/meta/connection/test", async (req, res) => {
  const setup = validateMetaOnboardingSetup();
  if (!setup.ok) {
    return res.status(400).json({
      ok: false,
      error: {
        code: "META_SETUP_MISSING",
        message: "Configuracao da Meta incompleta para testar conexao.",
        details: { missing: setup.missing, invalid: setup.invalid },
      },
      hint: "Verifique META_APP_ID, META_CONFIG_ID, META_WABA_ID e META_SYSTEM_USER_TOKEN no backend/.env.",
    });
  }

  const waba = await testMetaConnection();
  const phones = await listPhoneNumbers();
  return res.json({ ok: true, waba, phones });
});

export { router as metaOnboardingRouter };
