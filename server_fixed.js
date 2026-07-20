/**
 * Oasis Laundry Management System
 * Express server — Glenwood branch
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3000;

// ── Google Drive backup config (OAuth — personal Gmail account) ─
// oauth-credentials.json = the Desktop app Client ID/Secret from Cloud Console
// token.json             = generated once by running: node authorize_drive.js
// Never commit either file to GitHub (add both to .gitignore).
const OAUTH_CREDENTIALS_PATH = path.join(__dirname, 'oauth-credentials.json');
const OAUTH_TOKEN_PATH       = path.join(__dirname, 'token.json');
const GOOGLE_DRIVE_FOLDER_ID = '1a41k25KqlfJwzOqq0FwsnoWMAJDsvHf5';

let driveClient = null;
function getDriveClient() {
  if (driveClient) return driveClient;

  if (!fs.existsSync(OAUTH_CREDENTIALS_PATH)) {
    console.log('  \x1b[31m\u26a0  oauth-credentials.json not found — Drive upload disabled\x1b[0m');
    return null;
  }
  if (!fs.existsSync(OAUTH_TOKEN_PATH)) {
    console.log('  \x1b[31m\u26a0  token.json not found — run "node authorize_drive.js" once first\x1b[0m');
    return null;
  }

  const raw = JSON.parse(fs.readFileSync(OAUTH_CREDENTIALS_PATH, 'utf8'));
  const creds = raw.installed || raw.web;
  const oAuth2Client = new google.auth.OAuth2(
    creds.client_id,
    creds.client_secret,
    (creds.redirect_uris && creds.redirect_uris[0]) || 'http://localhost'
  );

  const token = JSON.parse(fs.readFileSync(OAUTH_TOKEN_PATH, 'utf8'));
  oAuth2Client.setCredentials(token);

  // If Google rotates the access token, persist the refreshed one
  oAuth2Client.on('tokens', (newTokens) => {
    const merged = { ...token, ...newTokens };
    fs.writeFileSync(OAUTH_TOKEN_PATH, JSON.stringify(merged, null, 2));
  });

  driveClient = google.drive({ version: 'v3', auth: oAuth2Client });
  return driveClient;
}

// Upload the backup JSON to the "Oasis Backups" Drive folder, owned by you.
// Fire-and-forget — called alongside the email step, never blocks the response.
async function uploadBackupToDrive(filePath, stamp) {
  try {
    const drive = getDriveClient();
    if (!drive) return;

    const res = await drive.files.create({
      requestBody: {
        name: `oasis-backup-${stamp}.json`,
        parents: [GOOGLE_DRIVE_FOLDER_ID]
      },
      media: {
        mimeType: 'application/json',
        body: fs.createReadStream(filePath)
      },
      fields: 'id, name, webViewLink'
    });

    console.log('  \x1b[32m\u2601  Backup uploaded to Google Drive:\x1b[0m', res.data.name, '(' + res.data.id + ')');
  } catch (e) {
    console.log('  \x1b[31m\u2601  Drive upload failed:', e.message, '\x1b[0m');
  }
}


// ── Supabase config ────────────────────────────────────────────
const SUPA_URL = 'https://lyzuwgovltrkwexzqtdv.supabase.co';
const SUPA_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx5enV3Z292bHRya3dleHpxdGR2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA0MDcyNDMsImV4cCI6MjA5NTk4MzI0M30.PQD_Y-YkI8Q3Az2Ykeq-jvINqee5IG8f9lpD-5fFz74';
const SUPA_BACKUPS_BUCKET = 'backups';

// Upload the backup JSON to Supabase Storage, in the same project as the data itself.
// Fire-and-forget — called alongside email + Drive, never blocks the response.
async function uploadBackupToSupabase(filePath, stamp) {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const objectName = `backup-${stamp}.json`;

    const res = await fetch(
      `${SUPA_URL}/storage/v1/object/${SUPA_BACKUPS_BUCKET}/${objectName}`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${SUPA_KEY}`,
          'apikey': SUPA_KEY,
          'Content-Type': 'application/json'
        },
        body: fileBuffer
      }
    );

    const text = await res.text();
    if (res.ok) {
      console.log('  \x1b[32m\u25a4  Backup uploaded to Supabase Storage:\x1b[0m', objectName);
    } else {
      console.log('  \x1b[31m\u25a4  Supabase Storage upload failed:', res.status, text, '\x1b[0m');
    }
  } catch (e) {
    console.log('  \x1b[31m\u25a4  Supabase Storage upload failed:', e.message, '\x1b[0m');
  }
}

// ── EmailJS config ─────────────────────────────────────────────
const EMAILJS_SERVICE_ID  = 'service_j5cwdlm';
const EMAILJS_TEMPLATE_ID = 'template_xg61zxr';
const EMAILJS_PUBLIC_KEY  = 'fiaUajbZVYUAQw2-0';

// Send backup summary + full JSON to Gmail via EmailJS REST API.
// Called fire-and-forget after every backup so it never blocks the response.
async function sendBackupEmail(snapshot, rowCounts, errors) {
  try {
    const date = new Date(snapshot.takenAt).toLocaleString('en-ZA', {
      dateStyle: 'full', timeStyle: 'short', timeZone: 'Africa/Johannesburg'
    });
    const tableCount  = Object.keys(snapshot.data).length;
    const recordCount = Object.values(rowCounts)
      .reduce((s, v) => s + (typeof v === 'number' ? v : 0), 0);

    const payload = {
      service_id:  EMAILJS_SERVICE_ID,
      template_id: EMAILJS_TEMPLATE_ID,
      user_id:     EMAILJS_PUBLIC_KEY,
      template_params: {
        backup_date:  date,
        triggered_by: snapshot.trigger === 'manual'
          ? 'Manual (Owner clicked Backup Now)'
          : 'Scheduled (10:00 daily)',
        table_count:  String(tableCount),
        record_count: String(recordCount),
        backup_json:  'Backup saved on server — file is in the backups/ folder on your laptop.\n\nRow counts:\n' +
          Object.entries(rowCounts).map(([t, n]) => `  ${t}: ${n}`).join('\n')
      }
    };

    const res = await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const text = await res.text();
    console.log('  \x1b[33m\u2709  EmailJS response:\x1b[0m', res.status, text);
    if (res.ok) {
      console.log('  \x1b[32m\u2709  Backup email sent via EmailJS\x1b[0m');
    } else {
      console.log('  \x1b[31m\u2709  EmailJS error:', text, '\x1b[0m');
    }
  } catch (e) {
    console.log('  \x1b[31m\u2709  Email send failed:', e.message, '\x1b[0m');
  }
}

// ── Schema (dependency order — referenced tables first) ────────
const SCHEMA = [
  {
    table: 'staff',
    columns: [
      { name: 'id',         type: 'uuid',                     notNull: true, default: 'gen_random_uuid()' },
      { name: 'name',       type: 'text',                     notNull: true },
      { name: 'email',      type: 'text',                     notNull: true },
      { name: 'role',       type: 'text',                     notNull: true },
      { name: 'pin_hash',   type: 'text',                     notNull: true },
      { name: 'active',     type: 'boolean',                  notNull: true, default: 'true' },
      { name: 'created_at', type: 'timestamp with time zone', notNull: true, default: 'now()' }
    ],
    primaryKey: 'id'
  },
  {
    table: 'customers',
    columns: [
      { name: 'id',          type: 'uuid',                     notNull: true, default: 'gen_random_uuid()' },
      { name: 'name',        type: 'text',                     notNull: true },
      { name: 'phone',       type: 'text' },
      { name: 'email',       type: 'text' },
      { name: 'consent',     type: 'boolean',                  notNull: true, default: 'false' },
      { name: 'loyalty_pts', type: 'integer',                  notNull: true, default: '0' },
      { name: 'status',      type: 'text',                     notNull: true, default: "'Active'" },
      { name: 'joined_at',   type: 'timestamp with time zone', notNull: true, default: 'now()' }
    ],
    primaryKey: 'id'
  },
  {
    table: 'prices',
    columns: [
      { name: 'id',         type: 'uuid',                     notNull: true, default: 'gen_random_uuid()' },
      { name: 'service',    type: 'text',                     notNull: true },
      { name: 'price',      type: 'numeric',                  notNull: true },
      { name: 'active',     type: 'boolean',                  notNull: true, default: 'true' },
      { name: 'updated_at', type: 'timestamp with time zone', notNull: true, default: 'now()' }
    ],
    primaryKey: 'id'
  },
  {
    table: 'iot_sensors',
    columns: [
      { name: 'sensor_code',    type: 'text',                     notNull: true },
      { name: 'id',             type: 'uuid',                     notNull: true, default: 'gen_random_uuid()' },
      { name: 'name',           type: 'text',                     notNull: true },
      { name: 'type',           type: 'text',                     notNull: true },
      { name: 'status',         type: 'text',                     notNull: true, default: "'Idle'" },
      { name: 'active',         type: 'boolean',                  notNull: true, default: 'true' },
      { name: 'temp',           type: 'text' },
      { name: 'load',           type: 'text' },
      { name: 'remaining_mins', type: 'integer' },
      { name: 'updated_at',     type: 'timestamp with time zone', notNull: true, default: 'now()' }
    ],
    primaryKey: 'id'
  },
  {
    table: 'inventory',
    columns: [
      { name: 'id',          type: 'uuid',                     notNull: true, default: 'gen_random_uuid()' },
      { name: 'name',        type: 'text',                     notNull: true },
      { name: 'unit',        type: 'text',                     notNull: true, default: "'units'" },
      { name: 'current_qty', type: 'numeric',                  notNull: true, default: '0' },
      { name: 'max_qty',     type: 'numeric',                  notNull: true, default: '10' },
      { name: 'threshold',   type: 'numeric',                  notNull: true, default: '2' },
      { name: 'updated_at',  type: 'timestamp with time zone', notNull: true, default: 'now()' }
    ],
    primaryKey: 'id'
  },
  {
    table: 'audit_logs',
    columns: [
      { name: 'id',        type: 'uuid',                     notNull: true, default: 'gen_random_uuid()' },
      { name: 'staff_id',  type: 'uuid',                     references: { table: 'staff', column: 'id' } },
      { name: 'target_id', type: 'uuid' },
      { name: 'action',    type: 'text',                     notNull: true },
      { name: 'detail',    type: 'text' },
      { name: 'logged_at', type: 'timestamp with time zone', notNull: true, default: 'now()' }
    ],
    primaryKey: 'id'
  },
  {
    table: 'knowledge_base',
    columns: [
      { name: 'id',         type: 'uuid',                     notNull: true, default: 'gen_random_uuid()' },
      { name: 'title',      type: 'text',                     notNull: true },
      { name: 'body',       type: 'text',                     notNull: true },
      { name: 'created_by', type: 'uuid',                     references: { table: 'staff', column: 'id' } },
      { name: 'updated_at', type: 'timestamp with time zone', notNull: true, default: 'now()' }
    ],
    primaryKey: 'id'
  },
  {
    table: 'notifications',
    columns: [
      { name: 'id',         type: 'uuid',                     notNull: true, default: 'gen_random_uuid()' },
      { name: 'staff_id',   type: 'uuid',                     references: { table: 'staff', column: 'id' } },
      { name: 'title',      type: 'text',                     notNull: true },
      { name: 'body',       type: 'text',                     notNull: true },
      { name: 'type',       type: 'text',                     notNull: true, default: "'info'" },
      { name: 'read',       type: 'boolean',                  notNull: true, default: 'false' },
      { name: 'created_at', type: 'timestamp with time zone', notNull: true, default: 'now()' }
    ],
    primaryKey: 'id'
  },
  {
    table: 'messages',
    columns: [
      { name: 'id',            type: 'uuid',                     notNull: true, default: 'gen_random_uuid()' },
      { name: 'from_staff_id', type: 'uuid',                     notNull: true, references: { table: 'staff', column: 'id' } },
      { name: 'to_staff_id',   type: 'uuid',                     references: { table: 'staff', column: 'id' } },
      { name: 'body',          type: 'text',                     notNull: true },
      { name: 'read',          type: 'boolean',                  notNull: true, default: 'false' },
      { name: 'sent_at',       type: 'timestamp with time zone', notNull: true, default: 'now()' }
    ],
    primaryKey: 'id'
  },
  {
    table: 'orders',
    columns: [
      { name: 'id',          type: 'uuid',                     notNull: true, default: 'gen_random_uuid()' },
      { name: 'customer_id', type: 'uuid',                     notNull: true, references: { table: 'customers', column: 'id' } },
      { name: 'staff_id',    type: 'uuid',                     notNull: true, references: { table: 'staff', column: 'id' } },
      { name: 'service',     type: 'text',                     notNull: true },
      { name: 'items',       type: 'text' },
      { name: 'status',      type: 'text',                     notNull: true, default: "'Received'" },
      { name: 'amount',      type: 'numeric',                  notNull: true, default: '0' },
      { name: 'discount',    type: 'numeric',                  notNull: true, default: '0' },
      { name: 'qr_code',     type: 'text' },
      { name: 'notes',       type: 'text' },
      { name: 'created_at',  type: 'timestamp with time zone', notNull: true, default: 'now()' }
    ],
    primaryKey: 'id'
  },
  {
    table: 'sensor_logs',
    columns: [
      { name: 'id',        type: 'uuid',                     notNull: true, default: 'gen_random_uuid()' },
      { name: 'sensor_id', type: 'uuid',                     notNull: true, references: { table: 'iot_sensors', column: 'id' } },
      { name: 'event',     type: 'text',                     notNull: true },
      { name: 'detail',    type: 'text' },
      { name: 'logged_at', type: 'timestamp with time zone', notNull: true, default: 'now()' }
    ],
    primaryKey: 'id'
  },
  {
    table: 'payments',
    columns: [
      { name: 'id',           type: 'uuid',                     notNull: true, default: 'gen_random_uuid()' },
      { name: 'order_id',     type: 'uuid',                     notNull: true, references: { table: 'orders', column: 'id' } },
      { name: 'staff_id',     type: 'uuid',                     references: { table: 'staff', column: 'id' } },
      { name: 'method',       type: 'text',                     notNull: true },
      { name: 'amount',       type: 'numeric',                  notNull: true },
      { name: 'discount_pct', type: 'numeric',                  notNull: true, default: '0' },
      { name: 'total_paid',   type: 'numeric',                  notNull: true },
      { name: 'paid_at',      type: 'timestamp with time zone', notNull: true, default: 'now()' }
    ],
    primaryKey: 'id'
  },
  {
    table: 'machine_usage',
    columns: [
      { name: 'id',         type: 'uuid',                     notNull: true, default: 'gen_random_uuid()' },
      { name: 'sensor_id',  type: 'uuid',                     references: { table: 'iot_sensors', column: 'id' } },
      { name: 'order_id',   type: 'uuid',                     references: { table: 'orders', column: 'id' } },
      { name: 'started_at', type: 'timestamp with time zone', notNull: true, default: 'now()' },
      { name: 'ended_at',   type: 'timestamp with time zone' }
    ],
    primaryKey: 'id'
  }
];

const BACKUP_TABLES = SCHEMA.map(t => t.table);

function buildCreateTableSQL(entry) {
  const lines = entry.columns.map(c => {
    let line = `  "${c.name}" ${c.type}`;
    if (c.default !== undefined) line += ` default ${c.default}`;
    if (c.notNull) line += ' not null';
    if (c.references) line += ` references "${c.references.table}"("${c.references.column}")`;
    return line;
  });
  lines.push(`  primary key ("${entry.primaryKey}")`);
  return `create table "${entry.table}" (\n${lines.join(',\n')}\n);`;
}

const BACKUP_DIR = path.join(__dirname, 'backups');
if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR);

async function fetchTable(table) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${table}?select=*`, {
    headers: { apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY }
  });
  if (!res.ok) throw new Error(`${table}: HTTP ${res.status}`);
  return res.json();
}

async function runBackup(trigger = 'scheduled') {
  const startedAt = new Date();
  const stamp = startedAt.toISOString().replace(/[:.]/g, '-');
  const snapshot = {
    takenAt: startedAt.toISOString(),
    trigger,
    tableOrder: BACKUP_TABLES,
    schema: {},
    data: {}
  };
  const errors = [];

  for (const entry of SCHEMA) {
    snapshot.schema[entry.table] = buildCreateTableSQL(entry);
    try {
      snapshot.data[entry.table] = await fetchTable(entry.table);
    } catch (e) {
      errors.push(e.message);
      snapshot.data[entry.table] = { error: e.message };
    }
  }

  const filePath = path.join(BACKUP_DIR, `backup-${stamp}.json`);
  fs.writeFileSync(filePath, JSON.stringify(snapshot, null, 2));

  const rowCounts = Object.fromEntries(
    Object.entries(snapshot.data).map(([t, rows]) => [t, Array.isArray(rows) ? rows.length : 'ERROR'])
  );

  console.log(`  \x1b[36m📦 Backup (${trigger}) saved →\x1b[0m ${filePath}`);
  console.log('  \x1b[90m   ' + JSON.stringify(rowCounts) + '\x1b[0m');
  if (errors.length) console.log('  \x1b[31m   Errors:', errors.join('; '), '\x1b[0m');

  // Fire-and-forget — none of these calls block the backup API response
  sendBackupEmail(snapshot, rowCounts, errors);
  uploadBackupToDrive(filePath, stamp);
  uploadBackupToSupabase(filePath, stamp);

  return { filePath, rowCounts, errors };
}

async function restoreBackup(snapshot) {
  const tableOrder = snapshot.tableOrder || BACKUP_TABLES;
  const report = { inserted: {}, errors: [] };

  for (const table of tableOrder) {
    const rows = snapshot.data && snapshot.data[table];
    if (!Array.isArray(rows) || rows.length === 0) { report.inserted[table] = 0; continue; }
    try {
      const res = await fetch(`${SUPA_URL}/rest/v1/${table}`, {
        method: 'POST',
        headers: {
          apikey: SUPA_KEY, Authorization: 'Bearer ' + SUPA_KEY,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal,resolution=ignore-duplicates'
        },
        body: JSON.stringify(rows)
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      report.inserted[table] = rows.length;
    } catch (e) {
      report.errors.push(`${table}: ${e.message}`);
      report.inserted[table] = 0;
    }
  }
  return report;
}

function buildSchemaSQLFile() {
  const parts = SCHEMA.map(entry =>
    `-- ${entry.table}\n${buildCreateTableSQL(entry)}`
  );
  return '-- Oasis schema rebuild script\n-- Run top to bottom in the Supabase SQL Editor\n\n' + parts.join('\n\n');
}

// Daily backup at 10:00 server time
cron.schedule('0 10 * * *', () => {
  runBackup('scheduled-10am').catch(e => console.log('  \x1b[31mBackup failed:', e.message, '\x1b[0m'));
});

// Load .env if present
const envPath = path.join(__dirname, '.env');
const envVars = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8').split(/\r?\n/).forEach(line => {
    const m = line.match(/^([^=]+)=(.*)$/);
    if (m) envVars[m[1].trim()] = m[2].trim();
  });
  console.log('  ✓ .env loaded from', envPath);
} else {
  console.log('  ⚠ No .env found at', envPath, '— using fallback key');
}

const OR_KEY = envVars['OPENROUTER_API_KEY'] || process.env.OPENROUTER_API_KEY;
const OR_MODEL = envVars['OPENROUTER_MODEL']   || process.env.OPENROUTER_MODEL   || 'qwen/qwen3-8b';

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use((req, res, next) => {
  const now = new Date().toLocaleTimeString('en-ZA', { hour12: false });
  const ms = Date.now();
  res.on('finish', () => {
    const elapsed = Date.now() - ms;
    const code = res.statusCode;
    const color = code < 300 ? '\x1b[32m' : code < 400 ? '\x1b[33m' : '\x1b[31m';
    console.log(`  ${color}${code}\x1b[0m  ${req.method.padEnd(6)} ${req.path.padEnd(40)} ${elapsed}ms  [${now}]`);
  });
  next();
});

app.get('/api/ai-config', (_req, res) => {
  res.json({ key: OR_KEY, model: OR_MODEL });
});

app.post('/api/ai', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt) return res.status(400).json({ error: 'No prompt' });

  const models = [
    'google/gemma-3-4b-it:free',
    'google/gemma-3-12b-it:free',
    'deepseek/deepseek-r1:free',
    'deepseek/deepseek-v3:free',
    'microsoft/phi-4:free',
    'qwen/qwen3-8b',
    'qwen/qwen3-14b:free',
    'meta-llama/llama-3.1-8b-instruct'
  ];

  let lastError = '';
  for (const model of models) {
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + OR_KEY,
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'Oasis LMS'
        },
        body: JSON.stringify({ model, messages: [{ role: 'user', content: prompt }], max_tokens: 900 })
      });
      const data = await response.json();
      const text = data.choices?.[0]?.message?.content;
      if (text) {
        console.log('  ✓ AI response from', model);
        return res.json({ text, model });
      }
      lastError = data.error?.message || 'No content';
      console.log('  ✗', model, '—', lastError);
    } catch (e) {
      lastError = e.message;
      console.log('  ✗', model, '—', e.message);
    }
  }

  res.status(500).json({ error: 'All models failed: ' + lastError });
});

app.use(express.static(path.join(__dirname, 'public'), {
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

app.post('/api/backup', async (_req, res) => {
  try {
    const result = await runBackup('manual');
    res.json({ status: 'ok', ...result });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

app.post('/api/restore', async (req, res) => {
  try {
    const { file } = req.body;
    if (!file) return res.status(400).json({ status: 'error', error: 'Missing "file" in request body' });
    const filePath = path.join(BACKUP_DIR, file);
    if (!filePath.startsWith(BACKUP_DIR)) return res.status(400).json({ status: 'error', error: 'Invalid file path' });
    if (!fs.existsSync(filePath)) return res.status(404).json({ status: 'error', error: 'Backup file not found' });

    const snapshot = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    const report = await restoreBackup(snapshot);
    console.log(`  \x1b[36m♻ Restore from ${file} →\x1b[0m`, JSON.stringify(report.inserted));
    if (report.errors.length) console.log('  \x1b[31m   Errors:', report.errors.join('; '), '\x1b[0m');
    res.json({ status: 'ok', ...report });
  } catch (e) {
    res.status(500).json({ status: 'error', error: e.message });
  }
});

app.get('/api/backup-sql', (_req, res) => {
  res.setHeader('Content-Type', 'text/plain');
  res.setHeader('Content-Disposition', 'attachment; filename="oasis-schema-rebuild.sql"');
  res.send(buildSchemaSQLFile());
});

app.get('/api/backups', (_req, res) => {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.endsWith('.json'))
    .map(f => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { file: f, size: stat.size, createdAt: stat.birthtime };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
  res.json(files);
});

app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    system: 'Oasis Laundry Management',
    branch: 'Glenwood',
    version: '1.0.0',
    uptime: Math.floor(process.uptime()) + 's',
    time: new Date().toISOString(),
    ai: OR_KEY ? 'configured' : 'missing key'
  });
});

app.get('/api/info', (_req, res) => {
  res.json({
    name: 'Oasis Laundry — Glenwood',
    roles: ['Owner', 'Counter', 'Cleaning'],
    pages: { login: '/', owner: '/owner.html', counter: '/counter.html', cleaning: '/cleaning.html' },
    node: process.version,
    pid: process.pid
  });
});

const pages = { '/owner': 'owner.html', '/counter': 'counter.html', '/cleaning': 'cleaning.html', '/login': 'index.html' };
Object.entries(pages).forEach(([route, file]) => {
  app.get(route, (_req, res) => res.sendFile(path.join(__dirname, 'public', file)));
});

app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

app.listen(PORT, () => {
  console.log('\n');
  console.log('  \x1b[36m╔══════════════════════════════════════════╗\x1b[0m');
  console.log('  \x1b[36m║\x1b[0m   \x1b[1mOasis Laundry Management System\x1b[0m        \x1b[36m║\x1b[0m');
  console.log('  \x1b[36m╚══════════════════════════════════════════╝\x1b[0m');
  console.log(`\n  \x1b[32m▶  http://localhost:${PORT}\x1b[0m`);
  console.log(`  \x1b[90m   AI key: ${OR_KEY ? '✓ loaded from .env' : '✗ missing — add to .env'}\x1b[0m`);
  console.log(`  \x1b[90m   Backup: scheduled daily at 10:00 → ${BACKUP_DIR}\x1b[0m`);
  console.log(`  \x1b[90m   Email:  backup emails → EmailJS ${EMAILJS_SERVICE_ID}\x1b[0m`);
  console.log(`  \x1b[90m   Drive:  ${(fs.existsSync(OAUTH_CREDENTIALS_PATH) && fs.existsSync(OAUTH_TOKEN_PATH)) ? '✓ authorized → uploads to folder ' + GOOGLE_DRIVE_FOLDER_ID : '✗ run "node authorize_drive.js" once to enable'}\x1b[0m`);
  console.log(`  \x1b[90m   Supabase Storage: ✓ uploads to bucket "${SUPA_BACKUPS_BUCKET}"\x1b[0m\n`);
});