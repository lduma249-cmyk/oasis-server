/**
 * Oasis Laundry Management System
 * Express server — Glenwood branch
 *
 * Run:  node server.js
 * URL:  http://localhost:3000
 */

const express = require('express');
const path    = require('path');
const fs      = require('fs');

const app  = express();
const PORT = process.env.PORT || 3000;

// ── Middleware ────────────────────────────────────────────────────────────────

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logger
app.use((req, res, next) => {
  const now  = new Date().toLocaleTimeString('en-ZA', { hour12: false });
  const ms   = Date.now();
  res.on('finish', () => {
    const elapsed = Date.now() - ms;
    const code    = res.statusCode;
    const color   = code < 300 ? '\x1b[32m' : code < 400 ? '\x1b[33m' : '\x1b[31m';
    console.log(`  ${color}${code}\x1b[0m  ${req.method.padEnd(6)} ${req.path.padEnd(40)} ${elapsed}ms  [${now}]`);
  });
  next();
});

// Serve static assets (HTML, video, CSS, JS)
app.use(express.static(path.join(__dirname, 'public'), {
  // Stream the background video efficiently
  setHeaders: (res, filePath) => {
    if (path.extname(filePath) === '.mp4') {
      res.setHeader('Accept-Ranges', 'bytes');
      res.setHeader('Cache-Control', 'public, max-age=86400');
    }
    if (path.extname(filePath) === '.html') {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// ── API Routes ────────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', (_req, res) => {
  res.json({
    status:  'ok',
    system:  'Oasis Laundry Management',
    branch:  'Glenwood',
    version: '1.0.0',
    uptime:  Math.floor(process.uptime()) + 's',
    time:    new Date().toISOString()
  });
});

// System info
app.get('/api/info', (_req, res) => {
  res.json({
    name:    'Oasis Laundry — Glenwood',
    roles:   ['Owner', 'Counter', 'Cleaning'],
    pages:   {
      login:    '/',
      owner:    '/owner.html',
      counter:  '/counter.html',
      cleaning: '/cleaning.html'
    },
    node:    process.version,
    pid:     process.pid
  });
});

// ── Page Routes ───────────────────────────────────────────────────────────────

// All role pages are served as static files from /public
// These explicit routes provide a cleaner fallback
const pages = {
  '/owner':    'owner.html',
  '/counter':  'counter.html',
  '/cleaning': 'cleaning.html',
  '/login':    'index.html'
};

Object.entries(pages).forEach(([route, file]) => {
  app.get(route, (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', file));
  });
});

// Root → login
app.get('/', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// 404 fallback
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found', hint: 'Visit / to open the system' });
});

// ── Start ─────────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log('\n');
  console.log('  \x1b[36m╔══════════════════════════════════════════╗\x1b[0m');
  console.log('  \x1b[36m║\x1b[0m   \x1b[1mOasis Laundry Management System\x1b[0m        \x1b[36m║\x1b[0m');
  console.log('  \x1b[36m║\x1b[0m   Glenwood Branch                        \x1b[36m║\x1b[0m');
  console.log('  \x1b[36m╚══════════════════════════════════════════╝\x1b[0m');
  console.log('');
  console.log(`  \x1b[32m▶  Server running\x1b[0m  →  \x1b[4mhttp://localhost:${PORT}\x1b[0m`);
  console.log(`  \x1b[90m   Node ${process.version}  ·  PID ${process.pid}\x1b[0m`);
  console.log('');
  console.log('  Pages:');
  console.log(`  \x1b[90m  /\x1b[0m               Login`);
  console.log(`  \x1b[90m  /owner.html\x1b[0m     Owner dashboard`);
  console.log(`  \x1b[90m  /counter.html\x1b[0m   Counter dashboard`);
  console.log(`  \x1b[90m  /cleaning.html\x1b[0m  Cleaning workstation`);
  console.log('');
  console.log('  API:');
  console.log(`  \x1b[90m  GET /api/health\x1b[0m  System status`);
  console.log(`  \x1b[90m  GET /api/info\x1b[0m    System info`);
  console.log('');
  console.log('  \x1b[90m  Press Ctrl+C to stop\x1b[0m');
  console.log('');
});
