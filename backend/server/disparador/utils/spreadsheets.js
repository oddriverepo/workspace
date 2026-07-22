import { parse } from "csv-parse/sync";

export function parseCsvBuffer(buffer) {
  const content = buffer.toString("utf8");
  return parse(content, {
    bom: true,
    columns: true,
    skip_empty_lines: true,
    trim: true,
  });
}

export async function parseXlsxBuffer(buffer) {
  const { default: ExcelJS } = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const rows = [];
  let headers = [];

  worksheet.eachRow((row, rowNumber) => {
    const rawValues = row.values || [];
    const values = rawValues
      .slice(1)
      .map((value) => (value === null || value === undefined ? "" : String(value).trim()));

    if (rowNumber === 1) {
      headers = values;
      return;
    }

    const rowObj = {};
    headers.forEach((header, idx) => {
      const key = header || `column_${idx + 1}`;
      rowObj[key] = values[idx] || "";
    });

    rows.push(rowObj);
  });

  return rows;
}

export function pickField(row, aliases) {
  const entries = Object.entries(row || {});
  const normalizedMap = new Map(entries.map(([k, v]) => [normalizeHeaderKey(k), v]));
  for (const alias of aliases) {
    const found = normalizedMap.get(normalizeHeaderKey(alias));
    if (found !== undefined && String(found).trim() !== "") {
      return found;
    }
  }
  return "";
}

function normalizeHeaderKey(value) {
  return String(value || "")
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}
