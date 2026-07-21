import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { MongoClient } from 'mongodb';

const __dirname = dirname(fileURLToPath(import.meta.url));

const envPath = resolve(__dirname, '..', '..', '.env');
for (const line of readFileSync(envPath, 'utf8').split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
}

const { runMirrorOnce } = await import('../services/oddrive-mirror.js');

const PII = /name|cpf|phone|email|pix|indication/i;
function redact(o) {
  if (o == null) return o;
  if (Array.isArray(o)) return o.slice(0, 2).map(redact);
  if (typeof o === 'object') {
    const out = {};
    for (const k of Object.keys(o)) out[k] = PII.test(k) && typeof o[k] === 'string' ? '***' : redact(o[k]);
    return out;
  }
  return o;
}

const APP_URI = process.env.MONGO_URI;
const APP_DB = process.env.MONGO_DB_NAME || 'odrive_app';

const res = await runMirrorOnce({ dryRun: true });
console.log('\n=== RESULT ===');
console.log(JSON.stringify(res, null, 2));

const c = new MongoClient(APP_URI, { serverSelectionTimeoutMS: 20000 });
await c.connect();
const db = c.db(APP_DB);
const tCamp = await db.collection('api_campaigns_test').countDocuments();
const tDrv = await db.collection('api_drivers_test').countDocuments();
const pCamp = await db.collection('api_campaigns').countDocuments();
const pDrv = await db.collection('api_drivers').countDocuments();
console.log('\n=== PARIDADE (counts) ===');
console.log(`api_campaigns_test=${tCamp}  (prod api_campaigns=${pCamp})`);
console.log(`api_drivers_test  =${tDrv}  (prod api_drivers  =${pDrv})`);

const sampleDrvWith = await db.collection('api_drivers_test').findOne({ campaignId: { $ne: null } });
const sampleDrvNo = await db.collection('api_drivers_test').findOne({ campaignId: null });
const sampleCamp = await db.collection('api_campaigns_test').findOne({});
console.log('\n=== AMOSTRA campanha (redacted) ===');
console.log(JSON.stringify(redact(sampleCamp), null, 1).slice(0, 900));
console.log('\n=== AMOSTRA motorista COM campanha (redacted) ===');
console.log(JSON.stringify(redact(sampleDrvWith), null, 1).slice(0, 1100));
console.log('\n=== AMOSTRA motorista SEM campanha (redacted) ===');
console.log(JSON.stringify(redact(sampleDrvNo), null, 1).slice(0, 700));

const withKm = await db.collection('api_drivers_test').countDocuments({ 'campaignData.totalKms': { $gt: 0 } });
const withScans = await db.collection('api_drivers_test').countDocuments({ 'campaignData.totalScans': { $gt: 0 } });
const withPix = await db.collection('api_drivers_test').countDocuments({ pix: { $nin: ['', null] } });
const withPlate = await db.collection('api_drivers_test').countDocuments({ plate: { $nin: ['', null] } });
console.log('\n=== ENRIQUECIMENTO ===');
console.log(`drivers c/ totalKms>0: ${withKm} | totalScans>0: ${withScans} | pix: ${withPix} | placa: ${withPlate}`);

await c.close();
process.exit(0);
