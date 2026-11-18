/**
 * Socket.io listener for the vertical slice test.
 * Run in the Frappe container alongside vertical_slice.py:
 *   node tests/e2e/socket_listener.mjs &
 *   python tests/e2e/vertical_slice.py
 */
import { io } from 'socket.io-client';
import http from 'http';

const SITE = 'development.localhost';
const API_HOST = 'development.localhost';
const API_PORT = 8000;
const SIO_PORT = 9000;
const OUT_FILE = process.env.SOCKET_OUT || '/tmp/e2e_socket_events.jsonl';

function fetchCookie(callback) {
  const req = http.get(
    `http://${API_HOST}:${API_PORT}/api/method/kibbutz_dining.pos.api.get_diner_types`,
    { headers: { Host: SITE } },
    (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        const setCookie = res.headers['set-cookie'];
        if (!setCookie) return callback(new Error('No set-cookie from guest endpoint'));
        const sid = setCookie.find((c) => c.includes('sid='));
        callback(null, sid ? sid.split(';')[0] : null);
      });
    }
  );
  req.on('error', callback);
}

import fs from 'fs';

function record(event, payload) {
  const line = JSON.stringify({ t: new Date().toISOString(), event, payload }) + '\n';
  fs.appendFileSync(OUT_FILE, line);
}

fetchCookie((err, cookie) => {
  if (err || !cookie) {
    console.error('Failed to obtain guest session cookie:', err?.message || 'empty');
    process.exit(1);
  }

  const socket = io(`http://${API_HOST}:${SIO_PORT}/${SITE}`, {
    transports: ['polling'],
    withCredentials: true,
    extraHeaders: {
      Cookie: cookie,
      Origin: `http://${SITE}:5174`,
    },
  });

  socket.on('connect', () => {
    record('connect', { socketId: socket.id });
  });

  socket.on('item_update', (payload) => {
    record('item_update', payload);
  });

  socket.on('item_out_of_stock', (payload) => {
    record('item_out_of_stock', payload);
  });

  socket.on('connect_error', (err) => {
    record('connect_error', { message: err.message });
  });

  socket.on('disconnect', (reason) => {
    record('disconnect', { reason });
  });

  // Keep alive until explicitly killed
});
