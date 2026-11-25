'use strict';
// Validación de la clave pública que acepta el formulario local de login de staging. Sin red ni navegador.
const assert = require('node:assert/strict');
const os = require('node:os'), path = require('node:path'), fs = require('node:fs');
const {test} = require('node:test');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'colo-login-'));
Object.assign(process.env, {E2E_REPO: path.resolve(__dirname, '..'), E2E_FROZEN: 'x', E2E_STATE: path.join(tmp, 'state'), E2E_EVID: path.join(tmp, 'evid')});
const {validAnonKey} = require('../tools/staging-ola1/harness/lib.cjs');
const jwt = p => ['eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9', Buffer.from(JSON.stringify(p)).toString('base64url'), 'firma'].join('.');
test('acepta la anon clásica de staging y la publishable', () => {
  assert.equal(validAnonKey(jwt({role: 'anon', ref: 'wjymdgfqmqutihadffec'})), true);
  assert.equal(validAnonKey('  sb_publishable_' + 'A1b2C3d4E5f6G7h8I9j0K1l2 '), true);
});
test('rechaza service_role, secret, otro proyecto (incluida producción), vacío y basura', () => {
  assert.equal(validAnonKey(jwt({role: 'service_role', ref: 'wjymdgfqmqutihadffec'})), false);
  assert.equal(validAnonKey(jwt({role: 'anon', ref: 'xhtpahjsddfkwsytubgu'})), false);
  for (const k of ['sb_secret_' + 'A1b2C3d4E5f6G7h8I9j0K1l2', 'sb_publishable_corta', '', null, undefined, 'esto-no-es-una-clave', 'a.b.c']) assert.equal(validAnonKey(k), false, String(k));
});
