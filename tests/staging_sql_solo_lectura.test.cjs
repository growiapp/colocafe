'use strict';
// esquema_gate.sql y politicas_rls.sql: SOLO LECTURA, sin secretos, sin cambios de configuración. Análisis estático (sin base de datos),
// con mutantes que el análisis debe rechazar. La prueba dinámica (sesión read_only + antes/después) está en tools/staging-ola1/verificar_sql.cjs.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const {test} = require('node:test');
const dir = path.resolve(__dirname, '../tools/staging-ola1');
const sinComentarios = sql => sql.replace(/\r\n/g, '\n').replace(/--.*$/gm, '');
const sinLiterales = sql => sinComentarios(sql).replace(/'(?:[^']|'')*'/g, "''");
const PROHIBIDAS = ['insert', 'update', 'delete', 'merge', 'alter', 'create', 'drop', 'truncate', 'grant', 'revoke', 'copy', 'call', 'do', 'vacuum', 'analyze', 'reindex', 'cluster', 'refresh', 'lock', 'comment', 'set', 'reset', 'execute', 'prepare', 'listen', 'notify', 'discard', 'load', 'import', 'begin', 'commit', 'rollback', 'savepoint', 'security', 'into'];
const FUNCIONES_PG_PERMITIDAS = new Set(['pg_get_constraintdef', 'pg_get_functiondef', 'pg_get_triggerdef']);
const FUNCION_PROHIBIDA = /^(pg_read_|pg_ls_|pg_stat_file|lo_|dblink|set_config|current_setting|pg_sleep|pg_terminate|pg_cancel|pg_advisory|nextval|setval|txid_|query_to_xml|pg_reload|pg_rotate|pg_switch|pg_create|pg_drop|pg_logical|pg_replication)/;
const CATALOGO_SENSIBLE = /^(pg_authid|pg_shadow|pg_user_mapping|pg_largeobject|pg_db_role_setting|pg_stat_activity|pg_settings|pg_file_settings|pg_hba_file_rules)$/;

// Devuelve la lista de problemas (vacía = sólo lectura, sólo catálogos, funciones inocuas).
function analizar(crudo, permitidas = []) {
  const sql = sinLiterales(crudo), problemas = [];
  const sentencias = sql.split(';').map(x => x.trim()).filter(Boolean);
  if (sentencias.length !== 1) problemas.push(`no es una única sentencia (${sentencias.length})`);
  if (!/^(with\s+recursive|with|select)\b/i.test(sentencias[0] || '')) problemas.push('no empieza con with/select');
  const palabras = new Set((sql.match(/\b[a-z_][a-z0-9_]*\b/gi) || []).map(w => w.toLowerCase()));
  for (const p of PROHIBIDAS) if (palabras.has(p)) problemas.push(`palabra prohibida: ${p}`);
  const ctes = new Set([...sql.matchAll(/(?:with\s+recursive|with|,)\s*([a-z_][a-z0-9_]*)\s*(?:\([^)]*\))?\s+as\s*\(/gi)].map(m => m[1].toLowerCase()));
  for (const m of sql.matchAll(/\b(?:from|join)\s+([a-z_][a-z0-9_.]*)/gi)) {
    const rel = m[1].toLowerCase().replace(/^pg_catalog\./, '');
    const relSinEsquema = rel.replace(/^public\./, '');
    if (!(/^pg_/.test(rel) || ctes.has(rel) || permitidas.includes(relSinEsquema))) problemas.push(`relación no permitida: ${rel}`);
    if (CATALOGO_SENSIBLE.test(rel)) problemas.push(`catálogo sensible: ${rel}`);
  }
  if (/\b(auth|vault|storage|extensions|net|supabase_functions)\./i.test(sql)) problemas.push('toca esquemas auth/vault/storage');
  // Tablas de negocio permitidas: SOLO agregados (count(*), md5(string_agg(...))) y claves de group by; nunca columnas sueltas ni select *.
  for (const rama of sql.split(/\bunion\s+all\b/i)) {
    const m = new RegExp('\\bfrom\\s+(?:public\\.)?(' + (permitidas.join('|') || '(?!)') + ')\\b', 'i').exec(rama);
    if (!m) continue;
    const lista = (/^\s*select\s+([\s\S]*?)\bfrom\b/i.exec(rama) || [, ''])[1];
    const claves = new Set(((/group\s+by\s+([a-z_,\s]+)/i.exec(rama) || [, ''])[1].match(/[a-z_][a-z0-9_]*/gi) || []).map(x => x.toLowerCase()));
    const alias = new Set([...lista.matchAll(/\bas\s+([a-z_][a-z0-9_]*)/gi)].map(x => x[1].toLowerCase()));
    const resto = lista.replace(/md5\s*\(\s*string_agg\s*\([^)]*\)\s*\)/gi, '').replace(/count\s*\(\s*\*\s*\)/gi, '');
    if (/\*/.test(resto)) problemas.push(`select * sobre tabla de negocio: ${m[1]}`);
    for (const t of resto.match(/\b[a-z_][a-z0-9_]*\b/gi) || []) {
      const w = t.toLowerCase();
      if (['as', 'coalesce', 'text', 'int', 'bigint', 'cast', 'case', 'when', 'then', 'else', 'end'].includes(w) || claves.has(w) || alias.has(w)) continue;
      problemas.push(`columna suelta sobre tabla de negocio (${m[1]}): ${w}`);
    }
  }
  for (const m of sql.matchAll(/\b([a-z_][a-z0-9_]*)\s*\(/gi)) {
    const f = m[1].toLowerCase();
    if (FUNCION_PROHIBIDA.test(f)) problemas.push(`función prohibida: ${f}`);
    else if (f.startsWith('pg_') && !FUNCIONES_PG_PERMITIDAS.has(f)) problemas.push(`función pg_ fuera de la lista permitida: ${f}`);
  }
  return problemas;
}

for (const archivo of ['esquema_gate.sql', 'politicas_rls.sql', 'auditoria_triggers.sql', 'funciones_triggers.sql', 'columnas_fixtures.sql', 'restricciones_fixtures.sql']) {
  test(`${archivo}: es UNA sola consulta de solo lectura sobre catálogos del sistema, sin DDL/DML, sin auth/vault, sin funciones peligrosas`, () => {
    assert.deepEqual(analizar(fs.readFileSync(path.join(dir, archivo), 'utf8')), []);
  });
}
const TABLAS_STORE = ['audit_logs', 'categories', 'customers', 'expenses', 'open_order_dispatches', 'open_order_items', 'open_orders', 'operators', 'products', 'reservations', 'sale_items', 'sale_payments', 'sales', 'shifts', 'stock_ledger', 'stock_store_activation', 'store_users'];
const AGREGADOS = {'stock_paridad.sql': ['stock_store_activation', 'stock_ledger'], 'inventario_sintetico.sql': ['stores', ...TABLAS_STORE], 'linea_base.sql': ['stores', 'profiles', ...TABLAS_STORE]};
for (const [archivo, permitidas] of Object.entries(AGREGADOS)) {
  test(`${archivo}: solo catálogos y AGREGADOS de ${permitidas.join(', ')} (nunca filas, ids ni columnas sueltas)`, () => {
    assert.deepEqual(analizar(fs.readFileSync(path.join(dir, archivo), 'utf8'), permitidas), []);
  });
}
test('modo agregados: RECHAZA leer filas, columnas sueltas, otras tablas de negocio o select *', () => {
  const base = fs.readFileSync(path.join(dir, 'stock_paridad.sql'), 'utf8'), permitidas = AGREGADOS['stock_paridad.sql'];
  const mutantes = {
    'columna suelta': base.replace("select 'LEDGER_FILAS_TOTAL', 'stock_ledger', count(*)::text from public.stock_ledger", "select 'X', store_id::text, 'y' from public.stock_ledger"),
    'select *': base.replace("select 'LEDGER_FILAS_TOTAL', 'stock_ledger', count(*)::text from public.stock_ledger", "select * from public.stock_ledger"),
    'otra tabla de negocio': base.replace("from public.stock_ledger", "from public.sales"),
    'ids por group by distinto': base.replace("count(*)::text from public.stock_store_activation group by status", "count(*)::text, store_id::text from public.stock_store_activation group by status"),
  };
  for (const [nombre, sql] of Object.entries(mutantes)) assert.notDeepEqual(analizar(sql, permitidas), [], `el mutante «${nombre}» no fue detectado`);
  // sin permiso explícito, la misma consulta se rechaza
  assert.notDeepEqual(analizar(base, []), []);
});
test('el análisis RECHAZA mutantes (no es una aprobación vacía)', () => {
  const base = fs.readFileSync(path.join(dir, 'politicas_rls.sql'), 'utf8');
  const mutantes = {
    'insert': base + '\n; insert into public.stores(id) values (gen_random_uuid());',
    'transacción': 'begin;\n' + base + '\ncommit;',
    'update': base.replace('select', 'update public.products set price = 0; select'),
    'tabla de negocio': base.replace('from pg_policies', 'from public.sales'),
    'auth.users': base.replace('from pg_policies', 'from auth.users'),
    'credenciales': base.replace('from pg_policies', 'from pg_authid'),
    'leer archivos': base.replace("left(coalesce(qual, '')", "left(pg_read_file('/etc/passwd')"),
    'configuración': base.replace("select 'POLITICA'", "select set_config('role','postgres',false), 'POLITICA'"),
    'función pg_ no permitida': base.replace("select 'POLITICA'", "select pg_backend_pid(), 'POLITICA'"),
    'dos sentencias': base + '\nselect 1;',
    'ddl': base.replace('select', 'create table x(a int); select'),
  };
  for (const [nombre, sql] of Object.entries(mutantes)) assert.notDeepEqual(analizar(sql), [], `el mutante «${nombre}» no fue detectado`);
});
test('politicas_rls.sql: la salida es texto de definiciones acotado (left(...) sobre qual/with_check y sobre pg_get_functiondef), no datos', () => {
  const t = fs.readFileSync(path.join(dir, 'politicas_rls.sql'), 'utf8');
  assert.match(t, /left\(coalesce\(qual, ''\)[^)]*\), 240\)/); assert.match(t, /left\(pg_get_functiondef\(oid\), 300\)/);
});
