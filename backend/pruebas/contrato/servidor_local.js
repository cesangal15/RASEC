#!/usr/bin/env node
/**
 * Servidor HTTP local que expone el backend en `vm` (los .gs reales con hojas en memoria) con las MISMAS
 * rutas que el Worker: /obra, /asistencias, /parte (y /prueba/…). Sirve para dos cosas:
 *   · probar el modo `url` del arnés de contrato sin tocar Google ni Cloudflare:
 *       node backend/pruebas/contrato/servidor_local.js            # escucha en http://127.0.0.1:8787
 *       node backend/pruebas/contrato/correr.js --url=http://127.0.0.1:8787 --usuario=admin --clave=1234 --escribir
 *   · abrir las pantallas contra un backend de mentira (TM2Auth.API_BASE apuntando aquí) para ensayar.
 * No guarda nada en disco: al parar el proceso se pierde todo.
 */
'use strict';
const http = require('http');
const { apiVm } = require('./arnes');
const { semillas } = require('./semillas');

const PUERTO = Number(process.env.PUERTO || process.argv[2] || 8787);
const api = apiVm(semillas());
const RUTAS = { '/obra': 'obra', '/asistencias': 'asistencias', '/parte': 'obra', '/prueba/obra': 'obra', '/prueba/asistencias': 'asistencias', '/prueba/parte': 'obra' };

http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x'); const destino = RUTAS[u.pathname];
  const responder = (status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj)); };
  if (req.method === 'OPTIONS'){ res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'GET,POST' }); return res.end(); }
  if (!destino) return responder(404, { ok: false, error: 'ruta desconocida: ' + u.pathname });
  const params = {}; u.searchParams.forEach((v, k) => { params[k] = v; });
  if (req.method === 'GET') return api[destino].get(params).then(r => responder(200, r)).catch(e => responder(500, { ok: false, error: String(e) }));
  let cuerpo = ''; req.on('data', d => { cuerpo += d; }); req.on('end', () => {
    let body; try { body = JSON.parse(cuerpo || '{}'); } catch (e) { return responder(200, { ok: false, error: 'JSON inválido' }); }
    api[destino].post(body).then(r => responder(200, r)).catch(e => responder(500, { ok: false, error: String(e) }));
  });
}).listen(PUERTO, '127.0.0.1', () => console.log('Backend de banco en http://127.0.0.1:' + PUERTO + '  (rutas /obra /asistencias /parte · usuario admin / clave 1234)'));
