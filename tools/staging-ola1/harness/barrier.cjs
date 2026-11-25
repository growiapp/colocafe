'use strict';
// Barreras de retención de solicitudes (stall) con timeout explícito, liberación incondicional y verificación de cero retenidas.
// Pura respecto de Playwright: `route` es cualquier objeto con continue()/abort(). Se prueba offline.
const dormir = ms => new Promise(r => setTimeout(r, ms));
const MAX_MS_DEFECTO = 45000;

// Lo llama lib.cjs dentro del handler de ruta. Liberada → la solicitud sale al servidor. Cancelada o vencida → se ABORTA (no sale).
async function manejarRetencion(state, fault, route, log = () => {}) {
  fault.reached = true;
  state.held = (state.held || 0) + 1;
  let timer;
  try {
    const venc = new Promise(r => { timer = setTimeout(() => r('TIMEOUT'), fault.maxMs ?? MAX_MS_DEFECTO); });
    const r = await Promise.race([Promise.resolve(fault.until).then(() => 'FIN'), venc]);
    if (r === 'TIMEOUT') { fault.timedOut = true; log({result:'STALL_TIMEOUT'}); return await route.abort('timedout'); }
    if (fault.cancelled) { log({result:'STALL_CANCELLED'}); return await route.abort('aborted'); }
    return await route.continue();
  } finally { clearTimeout(timer); state.held -= 1; }
}

function crearBarrera(device, {method, path, match, maxMs = 30000}) {
  let resolver; const until = new Promise(r => { resolver = r; });
  const f = {kind:'stall', method, path, match, until, maxMs, reached:false, released:false, cancelled:false, timedOut:false};
  device.state.faults.push(f);
  const api = {
    fault:f,
    liberar() { if (f.cancelled || f.released) return; f.released = true; resolver(); },
    cancelar() { if (f.released) return; f.cancelled = true; f.done = true; resolver(); },
    // Espera con timeout propio: si no llega, error (nunca se sigue como si hubiera llegado).
    async esperarRetenida(ms = 15000) {
      const fin = Date.now() + ms;
      while (!f.reached && Date.now() < fin) await dormir(25);
      if (!f.reached) throw new Error('BARRERA_NO_ALCANZADA');
      if (f.timedOut) throw new Error('BARRERA_TIMEOUT');
    },
    cerrar() { if (!f.released) this.cancelar(); f.done = true; },
  };
  f.cancelFn = () => api.cancelar();   // lo usa gate.cerrar() (quit) para cancelar con seguridad
  return api;
}

// Ejecuta fn(crear) y, pase lo que pase, libera o cancela todas las barreras creadas.
async function conBarreras(fn) {
  const creadas = [];
  const crear = (device, spec) => { const b = crearBarrera(device, spec); creadas.push(b); return b; };
  try { return await fn(crear); }
  finally { for (const b of creadas) b.cerrar(); }
}

// Al terminar: 0 solicitudes retenidas y ninguna barrera vencida. Si no, lanza.
async function verificarSinRetenidas(devices, ms = 3000) {
  const lista = () => Object.values(devices);
  const fin = Date.now() + ms;
  while (lista().some(d => (d.state.held || 0) > 0) && Date.now() < fin) await dormir(25);
  const retenidas = lista().reduce((s, d) => s + (d.state.held || 0), 0);
  const vencidas = lista().flatMap(d => d.state.faults.filter(f => f.timedOut)).length;
  if (retenidas) throw new Error(`SOLICITUDES_RETENIDAS:${retenidas}`);
  if (vencidas) throw new Error(`BARRERA_TIMEOUT:${vencidas}`);
  return {retenidas:0, vencidas:0};
}
async function verificarSinSolicitudes(devices, ms = 3000) {
  const pendientes = () => Object.values(devices).reduce((n,d) => n + (d.state.inflight?.size || 0), 0);
  const fin = Date.now() + ms;
  while (pendientes() && Date.now() < fin) await dormir(25);
  if (pendientes()) throw new Error(`SOLICITUDES_EN_VUELO:${pendientes()}`);
}
module.exports = {manejarRetencion, crearBarrera, conBarreras, verificarSinRetenidas, verificarSinSolicitudes, MAX_MS_DEFECTO};
