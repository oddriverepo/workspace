export const STATUS = ['agendado','confirmado','instalado','aguardando','cadastrando','problema','revisar'];

export function normalizeStatus(s) {
  const v = String(s || '').trim().toLowerCase();
  const map = {
    'agendada':'agendado','confirmada':'confirmado','instalada':'instalado',
    'pendente':'aguardando','em cadastro':'cadastrando',
  };
  const cand = map[v] || v;
  return STATUS.includes(cand) ? cand : 'revisar';
}

export function normalizeName(n) {
  return String(n || '')
    .normalize('NFD').replace(/\p{Diacritic}/gu,'')
    .replace(/\s+/g,' ').trim().toLowerCase();
}
