function toInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  nodeEnv: process.env.NODE_ENV || "development",
  corsOrigin: process.env.CORS_ORIGIN || "*",
  maxUploadMb: Math.max(1, toInt(process.env.MAX_UPLOAD_MB, 10)),
  appBaseUrl: process.env.APP_BASE_URL || "http://localhost:10000",
  webhookVerifyToken: process.env.META_WEBHOOK_VERIFY_TOKEN || "",
  integrationIngestKey: process.env.INTEGRATION_INGEST_KEY || "",
  metaAppId: process.env.META_APP_ID || "",
  metaAppSecret: process.env.META_APP_SECRET || "",
  metaConfigId: process.env.META_CONFIG_ID || "",
  metaBusinessId: process.env.META_BUSINESS_ID || "",
  metaWabaId: process.env.META_WABA_ID || "",
  metaPhoneNumberId: process.env.META_PHONE_NUMBER_ID || "",
  metaSystemUserToken: process.env.META_SYSTEM_USER_TOKEN || "",
  metaApiVersion: process.env.META_API_VERSION || "v22.0",
  campaignSendLimit: Math.max(1, toInt(process.env.CAMPAIGN_SEND_LIMIT, 500)),
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || "",
  anthropicModel: process.env.ANTHROPIC_MODEL || "claude-sonnet-4-20250514",
};
