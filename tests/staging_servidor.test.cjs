'use strict';
// El servidor del arnés de staging entrega los bytes EXACTOS del commit (no los del disco, que en Windows difieren por autocrlf). Sin red ni navegador.
const assert = require('node:assert/strict');
const crypto = require('node:crypto'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const {execFileSync} = require('node:child_process');
const {test} = require('node:test');
const root = path.resolve(__dirname, '..'), tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'colo-srv-'));
Object.assign(process.env, {E2E_REPO: root, E2E_FROZEN: 'x', E2E_STATE: path.join(tmp, 'state'), E2E_EVID: path.join(tmp, 'evid')});
const {paqueteDeCommit} = require('../tools/staging-ola1/harness/lib.cjs');
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const paquete = paqueteDeCommit(root, 'HEAD');
test('el paquete incluye exactamente los archivos que publica static.yml, y nada de tools/tests/sql', () => {
  const yml = fs.readFileSync(path.join(root, '.github/workflows/static.yml'), 'utf8');
  const lista = /cp -r (.+) _site\//.exec(yml)[1].split(/\s+/);
  for (const f of lista) assert.ok([...paquete.keys()].some(k => k === f || k.startsWith(f + '/')), `falta ${f}`);
  for (const k of paquete.keys()) assert.ok(!/^(tools|tests|\.)/.test(k) && !k.endsWith('.sql'), `no debe servirse ${k}`);
});
test('cada archivo se entrega con los bytes del commit (incluidos los que en disco están en CRLF) y su hash coincide', () => {
  for (const [rel, f] of paquete) {
    const delCommit = execFileSync('git', ['-C', root, 'show', `HEAD:${rel}`], {maxBuffer: 64 * 1024 * 1024});
    assert.equal(f.sha256, sha(delCommit), rel); assert.ok(delCommit.equals(f.buf), rel);
  }
  assert.ok(!paquete.get('manifest.json').buf.includes(13), 'manifest.json del commit está en LF');   // en disco con autocrlf suele estar en CRLF: eso causaba el HTTP 500
});
test('el index.html servido es el del commit actual (contiene las correcciones B1 y B4)', () => {
  const html = paquete.get('index.html').buf.toString('utf8');
  assert.match(html, /getActiveStoreRoleEstricto/); assert.match(html, /pedirEliminarCat\(/);
});
