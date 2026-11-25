'use strict';
// Contrato de dependencias locales. Sin descargas ni instalaciones: si algo falta o no coincide, falla cerrado.
// Rutas: E2E_PLAYWRIGHT_DIR / E2E_CHROME las sustituyen; el valor por defecto es la caché local de esta máquina.
const fs = require('node:fs'), path = require('node:path');
const PLAYWRIGHT_VERSION = '1.64.0-alpha-1789764292000';
const CHROMIUM_REVISION = '1243';   // la ruta debe contener este directorio; Playwright se lanza con executablePath explícito
function resolverDependencias(env = process.env) {
  const base = env.LOCALAPPDATA;
  const playwrightDir = env.E2E_PLAYWRIGHT_DIR || (base && path.join(base, 'npm-cache/_npx/9833c18b2d85bc59/node_modules/playwright'));
  const chrome = env.E2E_CHROME || (base && path.join(base, `ms-playwright/chromium-${CHROMIUM_REVISION}/chrome-win64/chrome.exe`));
  if (!playwrightDir || !chrome) throw new Error('DEPENDENCIA_SIN_RUTA');
  let pkg; try { pkg = JSON.parse(fs.readFileSync(path.join(playwrightDir, 'package.json'), 'utf8')); } catch (_) { throw new Error('PLAYWRIGHT_AUSENTE'); }
  if (pkg.name !== 'playwright' || pkg.version !== PLAYWRIGHT_VERSION) throw new Error(`PLAYWRIGHT_VERSION_INESPERADA:${pkg.version}`);
  if (!chrome.split(/[\\/]/).includes(`chromium-${CHROMIUM_REVISION}`)) throw new Error('CHROMIUM_REVISION_INESPERADA');
  if (!fs.existsSync(chrome) || !fs.statSync(chrome).isFile()) throw new Error('CHROMIUM_AUSENTE');
  return {playwrightDir, chrome};
}
function cargarPlaywright(env = process.env) {
  const {playwrightDir, chrome} = resolverDependencias(env);
  return {chromium: require(playwrightDir).chromium, chrome};
}
module.exports = {resolverDependencias, cargarPlaywright, PLAYWRIGHT_VERSION, CHROMIUM_REVISION};
