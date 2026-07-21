const TIMEOUT = 10000;

const PORT = process.env.TEST_PORT || process.env.PORT || 5173;

async function request(path, opts = {}){
  const url = `http://localhost:${PORT}${path}`;
  try{
    const controller = new AbortController();
    const id = setTimeout(()=>controller.abort(), TIMEOUT);
    const res = await fetch(url, { signal: controller.signal, ...opts });
    clearTimeout(id);
    const contentType = res.headers.get('content-type') || '';
    let body;
    try{
      if (contentType.includes('application/json')) body = await res.json();
      else body = await res.text();
    }catch(e){ body = `<unreadable: ${e.message}>`; }
    return { ok: res.ok, status: res.status, body };
  }catch(e){
    return { ok:false, error: e.message };
  }
}

(async ()=>{
  console.log('Iniciando testes automatizados locais...');

  const tests = [
    { name: 'GET / (static)', fn: ()=> request('/') },
    { name: 'GET /api/config (public)', fn: ()=> request('/api/config/') },
    { name: 'GET /api/campaigns (lista)', fn: ()=> request('/api/campaigns') },
    { name: 'GET /api/session/me without token (deve 401)', fn: ()=> request('/api/session/me') },
    { name: 'POST /api/admin/login empty body (deve 400)', fn: ()=> request('/api/admin/login', { method: 'POST', headers:{ 'content-type':'application/json'}, body: JSON.stringify({}) }) },
    { name: 'POST /api/session/driver sample (pode responder 404 se motorista inexistente)', fn: ()=> request('/api/session/driver', { method:'POST', headers:{ 'content-type':'application/json'}, body: JSON.stringify({ name: 'Teste Motorista', phone: '11999999999' }) }) },
    { name: 'GET /api/storage/invalid-id (autenticacao admin requerida -> 401)', fn: ()=> request('/api/storage/invalid-id') },
  ];

  for (const t of tests){
    process.stdout.write(`${t.name} ... `);
    const out = await t.fn();
    if (out.error){
      console.log(`ERROR -> ${out.error}`);
    } else {
      console.log(`${out.status} ${out.ok ? 'OK' : 'FAIL'}`);
      // print short body summary
      if (typeof out.body === 'string'){
        const s = out.body.replace(/\n/g,' ').slice(0,240);
        console.log('  body:', s.length ? s : '<empty>');
      } else {
        const summary = JSON.stringify(out.body, null, 2).slice(0,800);
        console.log('  body (json):', summary);
      }
    }
  }

  console.log('Testes concluídos.');
})();
