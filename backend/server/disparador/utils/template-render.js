function replaceTemplateVars(text = "", parameters = []) {
  const str = String(text || "");
  const list = Array.isArray(parameters) ? parameters : [];
  // Detecta named ({{nome}}) vs positional ({{1}}). Quando named, substitui na ordem de aparicao.
  const hasPositional = /\{\{\s*\d+\s*\}\}/.test(str);
  if (!hasPositional && /\{\{\s*[A-Za-z_]/.test(str)) {
    let i = 0;
    return str.replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g, (match) => {
      const value = list[i++];
      if (value === undefined || value === null || value === "") return match;
      return String(value);
    });
  }
  return str.replace(/\{\{\s*(\d+)\s*\}\}/g, (match, rawIndex) => {
    const index = Number(rawIndex) - 1;
    const value = list[index];
    if (value === undefined || value === null || value === "") return match;
    return String(value);
  });
}

function normalizeButtons(buttons = []) {
  return Array.isArray(buttons)
    ? buttons
        .map((item) => ({
          type: String(item?.type || "").trim().toLowerCase(),
          text: String(item?.text || "").trim(),
          url: String(item?.url || "").trim(),
          phoneNumber: String(item?.phoneNumber || "").trim(),
        }))
        .filter((item) => item.text)
    : [];
}

export function buildTemplateSnapshot(template = {}) {
  return {
    id: String(template.id || "").trim(),
    name: String(template.name || "").trim(),
    language: String(template.language || "").trim(),
    headerType: String(template.headerType || "none").trim().toLowerCase(),
    headerText: String(template.headerText || "").trim(),
    bodyText: String(template.bodyText || "").trim(),
    footerText: String(template.footerText || "").trim(),
    buttons: normalizeButtons(template.buttons),
  };
}

export function renderTemplateMessageText(template = {}, parameters = [], options = {}) {
  const snapshot = buildTemplateSnapshot(template);
  const parts = [];

  if (snapshot.headerType === "text" && snapshot.headerText) {
    parts.push(replaceTemplateVars(snapshot.headerText, parameters));
  } else if (snapshot.headerType === "image") {
    parts.push("[imagem]");
  }

  if (snapshot.bodyText) {
    parts.push(replaceTemplateVars(snapshot.bodyText, parameters));
  }

  if (snapshot.footerText) {
    parts.push(replaceTemplateVars(snapshot.footerText, parameters));
  }

  const buttonLabels = snapshot.buttons.map((item) => item.text).filter(Boolean);
  if (buttonLabels.length) {
    parts.push(`Botoes: ${buttonLabels.join(" | ")}`);
  }

  const rendered = parts.filter(Boolean).join("\n").trim();
  return rendered || String(options.fallbackText || snapshot.name || "").trim();
}
