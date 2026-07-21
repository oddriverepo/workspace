const PORT = process.env.TEST_PORT || process.env.PORT || 5174;
const BASE = `http://localhost:${PORT}`;

async function request(path, opts = {}){
  const url = `${BASE}${path}`;
  try{
    const res = await fetch(url, opts);
    const contentType = res.headers.get('content-type') || '';
    let body;
    try{ body = contentType.includes('application/json') ? await res.json() : await res.text(); }catch(e){ body = `<unreadable: ${e.message}>`; }
    return { ok: res.ok, status: res.status, body };
  }catch(e){ return { ok:false, error: e.message }; }
}

(async ()=>{
  console.log('Testando login admin com credenciais fornecidas...');
  const creds = {
    username: process.env.TEST_ADMIN_USER || 'test_admin',
    password: process.env.TEST_ADMIN_PASS || 'change_me',
  };
  const login = await request('/api/admin/login', { method: 'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify(creds) });
  console.log('POST /api/admin/login ->', login.status, login.ok);
  console.log('body:', JSON.stringify(login.body).slice(0,800));

  if (!login.ok || !login.body?.token){
    console.log('Login falhou — não é possível testar endpoints protegidos. Veja o retorno acima.');
    process.exit(login.ok ? 0 : 1);
  }

  const token = login.body.token;
  console.log('Token recebido, testando /api/admin/me...');
  const me = await request('/api/admin/me', { headers: { Authorization: `Bearer ${token}` } });
  console.log('GET /api/admin/me ->', me.status, me.ok, JSON.stringify(me.body).slice(0,500));

  console.log('GET /api/admin/audit-logs -> tentando recuperar (limit curto)');
  const logs = await request('/api/admin/audit-logs?limit=5', { headers: { Authorization: `Bearer ${token}` } });
  console.log('GET /api/admin/audit-logs ->', logs.status, logs.ok);
  if (logs.ok) console.log('logs body:', JSON.stringify(logs.body).slice(0,1000));

  console.log('Teste concluído.');
})();