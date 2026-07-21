import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const svc = resolve(__dirname, '..', 'services');
const WRITE_OPS = /(insertOne|insertMany|updateOne|updateMany|deleteOne|deleteMany|replaceOne|bulkWrite|findOneAndUpdate|findOneAndDelete|findOneAndReplace|renameCollection|createIndex|drop)\s*\(/;
const HEAVY = /collection\(\s*['"]driver_routes(?!_resume)/;

const violations = [];
const read = (f) => readFileSync(resolve(svc, f), 'utf8').split(/\r?\n/);

read('oddrive-live-client.js').forEach((line, i) => {
  if (WRITE_OPS.test(line)) violations.push(`oddrive-live-client.js:${i + 1} write op proibida -> ${line.trim()}`);
  if (HEAVY.test(line)) violations.push(`oddrive-live-client.js:${i + 1} ref driver_routes proibida -> ${line.trim()}`);
});

read('oddrive-mirror.js').forEach((line, i) => {
  if (WRITE_OPS.test(line) && /liveDb/.test(line)) {
    violations.push(`oddrive-mirror.js:${i + 1} escrita no liveDb proibida -> ${line.trim()}`);
  }
  if (HEAVY.test(line)) violations.push(`oddrive-mirror.js:${i + 1} ref driver_routes proibida -> ${line.trim()}`);
});

if (violations.length) {
  console.error('MIRROR GUARD: FAIL');
  for (const v of violations) console.error('  ' + v);
  process.exit(1);
}
console.log('MIRROR GUARD: PASS (live client read-only; sem driver_routes)');
