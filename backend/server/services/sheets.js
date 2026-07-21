import { google } from 'googleapis';

const auth = new google.auth.GoogleAuth({
  credentials: {
    client_email: process.env.GOOGLE_CLIENT_EMAIL,
    private_key: (process.env.GOOGLE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  },
  scopes: [
    'https://www.googleapis.com/auth/spreadsheets',
    'https://www.googleapis.com/auth/drive',
  ],
});

async function getSheetsClient() {
  return google.sheets({ version: 'v4', auth: await auth.getClient() });
}

function formatSheetRange(sheetName, range) {
  const safeName = sheetName.includes("'")
    ? `'${sheetName.replace(/'/g, "''")}'`
    : sheetName.includes(' ')
    ? `'${sheetName}'`
    : sheetName;
  return `${safeName}!${range}`;
}

export async function readSheetByRange(spreadsheetId, rangeA1) {
  const sheets = await getSheetsClient();
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: rangeA1,
  });
  const [header = [], ...rows] = data.values || [];
  return rows.map((row, index) => {
    const entry = Object.fromEntries(
      header.map((col, i) => [String(col || '').trim(), row[i] ?? '']),
    );
    entry.__rowNumber = index + 2; // inclui cabecalho
    return entry;
  });
}

export async function readSheetHeader(spreadsheetId, sheetName) {
  const sheets = await getSheetsClient();
  const range = formatSheetRange(sheetName, '1:1');
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });
  const headerRow = (data.values && data.values[0]) || [];
  return headerRow.map(col => String(col || '').trim());
}

export async function appendSheetRow(spreadsheetId, sheetName, values) {
  const sheets = await getSheetsClient();
  const range = formatSheetRange(sheetName, 'A1');
  const response = await sheets.spreadsheets.values.append({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [values] },
  });
  return response.data.updates;
}

async function getSheetMeta(spreadsheetId, sheetName) {
  const sheets = await getSheetsClient();
  const { data } = await sheets.spreadsheets.get({ spreadsheetId });
  const sheet = (data.sheets || []).find(
    s => s.properties && s.properties.title === sheetName,
  );
  if (!sheet) throw new Error(`Sheet ${sheetName} nao encontrada`);
  return sheet.properties;
}

export async function deleteSheetRow(spreadsheetId, sheetName, rowNumberOneBased) {
  const sheetProps = await getSheetMeta(spreadsheetId, sheetName);
  const sheets = await getSheetsClient();
  const startIndex = Math.max(0, rowNumberOneBased - 1);
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId: sheetProps.sheetId,
              dimension: 'ROWS',
              startIndex,
              endIndex: startIndex + 1,
            },
          },
        },
      ],
    },
  });
  return { sheetId: sheetProps.sheetId };
}

export async function getSheetId(spreadsheetId, sheetName) {
  const props = await getSheetMeta(spreadsheetId, sheetName);
  return props.sheetId;
}

function columnIndexToLetter(index) {
  let result = '';
  let current = index + 1;
  while (current > 0) {
    const modulo = (current - 1) % 26;
    result = String.fromCharCode(65 + modulo) + result;
    current = Math.floor((current - modulo) / 26);
  }
  return result;
}

export async function updateSheetRow(spreadsheetId, sheetName, rowNumberOneBased, values) {
  if (rowNumberOneBased < 1) throw new Error('Indice de linha invalido');
  const sheets = await getSheetsClient();

  const lastColumnLetter = columnIndexToLetter(Math.max(values.length - 1, 0));
  const range = formatSheetRange(
    sheetName,
    values.length ? `A${rowNumberOneBased}:${lastColumnLetter}${rowNumberOneBased}` : `A${rowNumberOneBased}`,
  );

  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [values],
    },
  });

  return { range };
}

// New helpers for master sheet/tab management
export async function getSpreadsheetMeta(spreadsheetId) {
  const sheets = await getSheetsClient();
  const { data } = await sheets.spreadsheets.get({ spreadsheetId });
  return data;
}

export async function listSheets(spreadsheetId) {
  const meta = await getSpreadsheetMeta(spreadsheetId);
  return (meta.sheets || []).map(s => ({
    title: s?.properties?.title,
    sheetId: s?.properties?.sheetId,
    index: s?.properties?.index,
  }));
}

export async function ensureSheetTab(spreadsheetId, title) {
  const sheets = await getSheetsClient();
  const existing = await listSheets(spreadsheetId);
  const found = existing.find(s => s.title === title);
  if (found) return found;
  const { data } = await sheets.spreadsheets.batchUpdate({
    spreadsheetId,
    requestBody: {
      requests: [
        { addSheet: { properties: { title } } },
      ],
    },
  });
  const reply = (data.replies || []).find(r => r.addSheet && r.addSheet.properties);
  return {
    title,
    sheetId: reply?.addSheet?.properties?.sheetId,
    index: reply?.addSheet?.properties?.index,
  };
}

export async function setSheetHeader(spreadsheetId, sheetName, header) {
  const sheets = await getSheetsClient();
  const range = formatSheetRange(sheetName, '1:1');
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [header] },
  });
  return { header };
}

export async function clearSheetData(spreadsheetId, sheetName) {
  const sheets = await getSheetsClient();
  const range = formatSheetRange(sheetName, '2:100000');
  await sheets.spreadsheets.values.clear({ spreadsheetId, range });
  return { cleared: true };
}

export async function updateSheetRows(spreadsheetId, sheetName, startRowOneBased, headerLength, rows) {
  const sheets = await getSheetsClient();
  const lastColLetter = columnIndexToLetter(Math.max(headerLength - 1, 0));
  const endRow = Math.max(startRowOneBased, startRowOneBased + (rows?.length || 0) - 1);
  const range = formatSheetRange(sheetName, `${rows && rows.length ? `A${startRowOneBased}:${lastColLetter}${endRow}` : `A${startRowOneBased}`}`);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: rows },
  });
  return { range };
}
