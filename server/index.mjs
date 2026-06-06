import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import express from 'express';
import { verifyPassword } from './password.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const PORT = Number(
  process.env.PORT ?? (process.env.NODE_ENV === 'production' ? 3000 : 3001),
);
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(repoRoot, 'data'));
const BACKUP_DIR = path.resolve(
  process.env.BACKUP_DIR ?? path.join(repoRoot, 'backups'),
);
const DB_PATH = path.resolve(
  process.env.DB_PATH ?? path.join(DATA_DIR, 'ledger.sqlite'),
);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH ?? '';
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 30);
const COOKIE_NAME = 'daily_ledger_session';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;

const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
};

ensureDir(DATA_DIR);
ensureDir(BACKUP_DIR);

if (!ADMIN_PASSWORD_HASH) {
  console.warn(
    'ADMIN_PASSWORD_HASH is not configured. Login will fail until it is set.',
  );
}

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.exec(`
  CREATE TABLE IF NOT EXISTS app_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    data_json TEXT NOT NULL,
    revision INTEGER NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL
  );
`);

const getStateStatement = db.prepare(
  'SELECT data_json, revision, updated_at FROM app_state WHERE id = 1',
);
const insertStateStatement = db.prepare(
  'INSERT INTO app_state (id, data_json, revision, updated_at) VALUES (1, ?, ?, ?)',
);
const updateStateStatement = db.prepare(
  'UPDATE app_state SET data_json = ?, revision = ?, updated_at = ? WHERE id = 1',
);
const insertSessionStatement = db.prepare(
  'INSERT INTO sessions (token_hash, expires_at, created_at) VALUES (?, ?, ?)',
);
const getSessionStatement = db.prepare(
  'SELECT token_hash, expires_at FROM sessions WHERE token_hash = ?',
);
const deleteSessionStatement = db.prepare(
  'DELETE FROM sessions WHERE token_hash = ?',
);
const deleteExpiredSessionsStatement = db.prepare(
  'DELETE FROM sessions WHERE expires_at <= ?',
);

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isLedgerData = (value) =>
  isRecord(value) && isRecord(value.copper) && isRecord(value.daily);

const parseCookies = (header) => {
  const cookies = new Map();
  for (const part of String(header ?? '').split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (!rawName) {
      continue;
    }
    cookies.set(rawName, decodeURIComponent(rawValue.join('=')));
  }
  return cookies;
};

const hashToken = (token) =>
  crypto.createHash('sha256').update(token).digest('hex');

const getCookieOptions = () => ({
  httpOnly: true,
  sameSite: 'lax',
  secure:
    process.env.COOKIE_SECURE === 'true' ||
    (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production'),
  maxAge: SESSION_TTL_DAYS * ONE_DAY_MS,
  path: '/',
});

const getState = () => {
  const row = getStateStatement.get();
  if (!row) {
    return {
      hasData: false,
      data: null,
      revision: 0,
      updatedAt: null,
    };
  }

  return {
    hasData: true,
    data: JSON.parse(row.data_json),
    revision: row.revision,
    updatedAt: row.updated_at,
  };
};

const saveState = db.transaction((data, expectedRevision) => {
  if (!isLedgerData(data)) {
    const error = new Error('Invalid ledger data.');
    error.statusCode = 400;
    throw error;
  }

  const existing = getStateStatement.get();
  const normalizedExpectedRevision = Number(expectedRevision);
  if (!Number.isInteger(normalizedExpectedRevision) || normalizedExpectedRevision < 0) {
    const error = new Error('A valid revision is required.');
    error.statusCode = 400;
    throw error;
  }

  if (existing && existing.revision !== normalizedExpectedRevision) {
    const error = new Error('Ledger data changed on another device.');
    error.statusCode = 409;
    error.currentRevision = existing.revision;
    throw error;
  }

  if (!existing && normalizedExpectedRevision !== 0) {
    const error = new Error('Ledger data does not exist yet.');
    error.statusCode = 409;
    error.currentRevision = 0;
    throw error;
  }

  const revision = existing ? existing.revision + 1 : 1;
  const updatedAt = new Date().toISOString();
  const dataJson = JSON.stringify(data);

  if (existing) {
    updateStateStatement.run(dataJson, revision, updatedAt);
  } else {
    insertStateStatement.run(dataJson, revision, updatedAt);
  }

  return {
    hasData: true,
    data,
    revision,
    updatedAt,
  };
});

const createBackupPayload = (state) => ({
  version: 1,
  exportedAt: new Date().toISOString(),
  origin: 'server',
  copper: state.data.copper,
  daily: state.data.daily,
});

const getBackupFileName = (date = new Date()) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}.json`;

const pruneBackups = () => {
  const files = fs
    .readdirSync(BACKUP_DIR)
    .filter((file) => /^\d{4}-\d{2}-\d{2}\.json$/.test(file))
    .sort();

  for (const file of files.slice(0, Math.max(0, files.length - 30))) {
    fs.rmSync(path.join(BACKUP_DIR, file), { force: true });
  }
};

const runDailyBackup = () => {
  const state = getState();
  if (!state.hasData) {
    return null;
  }

  const filePath = path.join(BACKUP_DIR, getBackupFileName());
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(
      filePath,
      `${JSON.stringify(createBackupPayload(state), null, 2)}\n`,
      'utf8',
    );
  }
  pruneBackups();
  return filePath;
};

const createSession = (res) => {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const expiresAt = Date.now() + SESSION_TTL_DAYS * ONE_DAY_MS;
  insertSessionStatement.run(tokenHash, expiresAt, new Date().toISOString());
  res.cookie(COOKIE_NAME, token, getCookieOptions());
};

const getSessionTokenHash = (req) => {
  const token = parseCookies(req.headers.cookie).get(COOKIE_NAME);
  return token ? hashToken(token) : null;
};

const requireAuth = (req, res, next) => {
  deleteExpiredSessionsStatement.run(Date.now());
  const tokenHash = getSessionTokenHash(req);
  if (!tokenHash) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  const session = getSessionStatement.get(tokenHash);
  if (!session || session.expires_at <= Date.now()) {
    if (session) {
      deleteSessionStatement.run(tokenHash);
    }
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  next();
};

const app = express();
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

app.get('/api/auth/session', (req, res) => {
  deleteExpiredSessionsStatement.run(Date.now());
  const tokenHash = getSessionTokenHash(req);
  const session = tokenHash ? getSessionStatement.get(tokenHash) : null;
  res.json({ authenticated: Boolean(session && session.expires_at > Date.now()) });
});

app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body ?? {};
  if (
    username !== ADMIN_USERNAME ||
    typeof password !== 'string' ||
    !verifyPassword(password, ADMIN_PASSWORD_HASH)
  ) {
    res.status(401).json({ error: 'Invalid username or password.' });
    return;
  }

  createSession(res);
  res.json({ authenticated: true });
});

app.post('/api/auth/logout', (req, res) => {
  const tokenHash = getSessionTokenHash(req);
  if (tokenHash) {
    deleteSessionStatement.run(tokenHash);
  }
  res.clearCookie(COOKIE_NAME, { ...getCookieOptions(), maxAge: undefined });
  res.json({ authenticated: false });
});

app.get('/api/ledger', requireAuth, (_req, res) => {
  res.json(getState());
});

app.put('/api/ledger', requireAuth, (req, res, next) => {
  try {
    res.json(saveState(req.body?.data, req.body?.revision));
  } catch (error) {
    next(error);
  }
});

app.post('/api/ledger/import', requireAuth, (req, res, next) => {
  try {
    if (req.body?.requireEmpty && getState().hasData) {
      res.status(409).json({
        error: 'Server already has ledger data.',
        currentRevision: getState().revision,
      });
      return;
    }
    res.json(saveState(req.body?.data, req.body?.revision ?? 0));
  } catch (error) {
    next(error);
  }
});

app.get('/api/ledger/export', requireAuth, (_req, res) => {
  const state = getState();
  if (!state.hasData) {
    res.status(404).json({ error: 'No ledger data to export.' });
    return;
  }

  const fileName = `daily-ledger-backup_${new Date()
    .toISOString()
    .slice(0, 16)
    .replace(/[-:T]/g, '')}.json`;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(`${JSON.stringify(createBackupPayload(state), null, 2)}\n`);
});

app.post('/api/backups/run', requireAuth, (_req, res) => {
  const filePath = runDailyBackup();
  res.json({ ok: true, file: filePath ? path.basename(filePath) : null });
});

app.use((error, _req, res, _next) => {
  const statusCode = error.statusCode ?? 500;
  res.status(statusCode).json({
    error: error.message || 'Unexpected server error.',
    currentRevision: error.currentRevision,
  });
});

const distDir = path.join(repoRoot, 'dist');
if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) {
      next();
      return;
    }
    res.sendFile(path.join(distDir, 'index.html'));
  });
}

runDailyBackup();
setInterval(runDailyBackup, 60 * 60 * 1000).unref();

app.listen(PORT, () => {
  console.log(`Daily Ledger server listening on port ${PORT}`);
  console.log(`SQLite database: ${DB_PATH}`);
});
