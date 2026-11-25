'use strict';
// Contrato de generación: la capa «Carta de mostrador» de index.html (regiones CARTA_V2 y CARTA_JS) se genera con tools/carta-v2/apply.py.
// Editar esas regiones solo en index.html las pierde en la próxima regeneración; esta prueba falla si index.html y las fuentes divergen.
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const path = require('node:path');
const {test} = require('node:test');
const root = path.resolve(__dirname, '..');
const py = ['python', 'python3', 'py'].find(c => spawnSync(c, ['--version']).status === 0);
test('index.html coincide con las fuentes de tools/carta-v2 (apply.py --check, no escribe)', {skip: py ? false : 'sin Python en este equipo'}, () => {
  const r = spawnSync(py, [path.join(root, 'tools/carta-v2/apply.py'), '--check'], {encoding: 'utf8'});
  assert.equal(r.stdout.trim(), 'COINCIDE', 'index.html difiere de las fuentes: edite tools/carta-v2/* y regenere, no solo index.html');
  assert.equal(r.status, 0);
});
