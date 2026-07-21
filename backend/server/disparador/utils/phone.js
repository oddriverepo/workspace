const E164_REGEX = /^\+[1-9]\d{7,14}$/;

export function normalizePhone(input) {
  if (input === null || input === undefined) return "";
  const raw = String(input).trim();
  if (!raw) return "";

  const keepPlusAndDigits = raw.replace(/[^\d+]/g, "");
  const onlyDigits = keepPlusAndDigits.replace(/\D/g, "");

  let e164 = "";
  if (keepPlusAndDigits.startsWith("+")) {
    e164 = `+${onlyDigits}`;
  } else {
    if (onlyDigits.length === 10 || onlyDigits.length === 11) {
      e164 = `+55${onlyDigits}`;
    } else {
      e164 = `+${onlyDigits}`;
    }
  }

  if (!E164_REGEX.test(e164)) return "";
  return e164;
}

export function parseBooleanLike(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "boolean") return value;

  const normalized = String(value).trim().toLowerCase();
  if (["1", "true", "sim", "yes", "y", "ok", "aceito", "consentido"].includes(normalized)) return true;
  if (["0", "false", "nao", "não", "no", "n", "optout", "opt-out"].includes(normalized)) return false;
  return fallback;
}

export { E164_REGEX };
