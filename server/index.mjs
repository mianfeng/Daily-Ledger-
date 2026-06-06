import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyPassword } from './password.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const HOST = process.env.HOST ?? '0.0.0.0';
const PORT = Number(
  process.env.PORT ?? (process.env.NODE_ENV === 'production' ? 3000 : 3001),
);
const DATA_DIR = path.resolve(process.env.DATA_DIR ?? path.join(repoRoot, 'data'));
const BACKUP_DIR = path.resolve(
  process.env.BACKUP_DIR ?? path.join(repoRoot, 'backups'),
);
const LEDGER_PATH = path.join(DATA_DIR, 'ledger.json');
const SESSIONS_PATH = path.join(DATA_DIR, 'sessions.json');
const ADMIN_USERNAME = process.env.ADMIN_USERNAME ?? 'admin';
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH ?? '';
const SESSION_TTL_DAYS = Number(process.env.SESSION_TTL_DAYS ?? 30);
const COOKIE_NAME = 'daily_ledger_session';
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 5 * 1024 * 1024;

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

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isLedgerData = (value) =>
  isRecord(value) && isRecord(value.copper) && isRecord(value.daily);

const readJsonFile = (filePath, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
};

const writeJsonAtomic = (filePath, value) => {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(tmpPath, filePath);
};

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
  sameSite: 'Lax',
  secure:
    process.env.COOKIE_SECURE === 'true' ||
    (process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production'),
  maxAge: SESSION_TTL_DAYS * ONE_DAY_MS,
  path: '/',
});

const serializeCookie = (name, value, options) => {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) {
    parts.push(`Max-Age=${Math.floor(options.maxAge / 1000)}`);
  }
  if (options.path) {
    parts.push(`Path=${options.path}`);
  }
  if (options.httpOnly) {
    parts.push('HttpOnly');
  }
  if (options.sameSite) {
    parts.push(`SameSite=${options.sameSite}`);
  }
  if (options.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
};

const getState = () => {
  const state = readJsonFile(LEDGER_PATH, null);
  if (!isRecord(state) || !isLedgerData(state.data)) {
    return {
      hasData: false,
      data: null,
      revision: 0,
      updatedAt: null,
    };
  }

  return {
    hasData: true,
    data: state.data,
    revision: Number.isInteger(state.revision) ? state.revision : 0,
    updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : null,
  };
};

const saveState = (data, expectedRevision) => {
  if (!isLedgerData(data)) {
    const error = new Error('Invalid ledger data.');
    error.statusCode = 400;
    throw error;
  }

  const normalizedExpectedRevision = Number(expectedRevision);
  if (!Number.isInteger(normalizedExpectedRevision) || normalizedExpectedRevision < 0) {
    const error = new Error('A valid revision is required.');
    error.statusCode = 400;
    throw error;
  }

  const existing = getState();
  if (existing.hasData && existing.revision !== normalizedExpectedRevision) {
    const error = new Error('Ledger data changed on another device.');
    error.statusCode = 409;
    error.currentRevision = existing.revision;
    throw error;
  }

  if (!existing.hasData && normalizedExpectedRevision !== 0) {
    const error = new Error('Ledger data does not exist yet.');
    error.statusCode = 409;
    error.currentRevision = 0;
    throw error;
  }

  const nextState = {
    data,
    revision: existing.hasData ? existing.revision + 1 : 1,
    updatedAt: new Date().toISOString(),
  };
  writeJsonAtomic(LEDGER_PATH, nextState);
  return {
    hasData: true,
    ...nextState,
  };
};

const readSessions = () => {
  const parsed = readJsonFile(SESSIONS_PATH, {});
  return isRecord(parsed) ? parsed : {};
};

const writeSessions = (sessions) => {
  writeJsonAtomic(SESSIONS_PATH, sessions);
};

const pruneSessions = () => {
  const sessions = readSessions();
  const now = Date.now();
  let changed = false;
  for (const [tokenHash, session] of Object.entries(sessions)) {
    if (!isRecord(session) || Number(session.expiresAt) <= now) {
      delete sessions[tokenHash];
      changed = true;
    }
  }
  if (changed) {
    writeSessions(sessions);
  }
  return sessions;
};

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

const sendJson = (res, statusCode, payload) => {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(`${JSON.stringify(payload)}\n`);
};

const sendError = (res, error) => {
  sendJson(res, error.statusCode ?? 500, {
    error: error.message || 'Unexpected server error.',
    currentRevision: error.currentRevision,
  });
};

const readRequestJson = (req) =>
  new Promise((resolve, reject) => {
    let body = '';
    req.setEncoding('utf8');
    req.on('data', (chunk) => {
      body += chunk;
      if (Buffer.byteLength(body, 'utf8') > MAX_BODY_BYTES) {
        const error = new Error('Request body is too large.');
        error.statusCode = 413;
        reject(error);
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        const error = new Error('Invalid JSON body.');
        error.statusCode = 400;
        reject(error);
      }
    });
    req.on('error', reject);
  });

const createSession = (res) => {
  const token = crypto.randomBytes(32).toString('base64url');
  const tokenHash = hashToken(token);
  const sessions = pruneSessions();
  sessions[tokenHash] = {
    expiresAt: Date.now() + SESSION_TTL_DAYS * ONE_DAY_MS,
    createdAt: new Date().toISOString(),
  };
  writeSessions(sessions);
  res.setHeader('Set-Cookie', serializeCookie(COOKIE_NAME, token, getCookieOptions()));
};

const clearSession = (req, res) => {
  const token = parseCookies(req.headers.cookie).get(COOKIE_NAME);
  if (token) {
    const sessions = readSessions();
    delete sessions[hashToken(token)];
    writeSessions(sessions);
  }
  res.setHeader(
    'Set-Cookie',
    serializeCookie(COOKIE_NAME, '', {
      ...getCookieOptions(),
      maxAge: 0,
    }),
  );
};

const isAuthenticated = (req) => {
  const token = parseCookies(req.headers.cookie).get(COOKIE_NAME);
  if (!token) {
    return false;
  }
  const session = pruneSessions()[hashToken(token)];
  return isRecord(session) && Number(session.expiresAt) > Date.now();
};

const requireAuth = (req) => {
  if (!isAuthenticated(req)) {
    const error = new Error('Authentication required.');
    error.statusCode = 401;
    throw error;
  }
};

const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

const sendStatic = (req, res) => {
  const distDir = path.join(repoRoot, 'dist');
  if (!fs.existsSync(distDir)) {
    return false;
  }

  const url = new URL(req.url, 'http://localhost');
  const requested = decodeURIComponent(url.pathname);
  const filePath = path.resolve(
    distDir,
    requested === '/' ? 'index.html' : requested.slice(1),
  );

  if (!filePath.startsWith(distDir)) {
    res.writeHead(403);
    res.end('Forbidden');
    return true;
  }

  const finalPath = fs.existsSync(filePath)
    ? filePath
    : path.join(distDir, 'index.html');
  if (!fs.existsSync(finalPath) || fs.statSync(finalPath).isDirectory()) {
    return false;
  }

  res.writeHead(200, {
    'Content-Type': contentTypes[path.extname(finalPath)] ?? 'application/octet-stream',
  });
  fs.createReadStream(finalPath).pipe(res);
  return true;
};

const handleApi = async (req, res, url) => {
  if (req.method === 'GET' && url.pathname === '/api/health') {
    sendJson(res, 200, { ok: true });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/session') {
    sendJson(res, 200, { authenticated: isAuthenticated(req) });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    const body = await readRequestJson(req);
    if (
      body.username !== ADMIN_USERNAME ||
      typeof body.password !== 'string' ||
      !verifyPassword(body.password, ADMIN_PASSWORD_HASH)
    ) {
      sendJson(res, 401, { error: 'Invalid username or password.' });
      return;
    }
    createSession(res);
    sendJson(res, 200, { authenticated: true });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    clearSession(req, res);
    sendJson(res, 200, { authenticated: false });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/ledger') {
    requireAuth(req);
    sendJson(res, 200, getState());
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/ledger') {
    requireAuth(req);
    const body = await readRequestJson(req);
    sendJson(res, 200, saveState(body.data, body.revision));
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/ledger/import') {
    requireAuth(req);
    const body = await readRequestJson(req);
    if (body.requireEmpty && getState().hasData) {
      sendJson(res, 409, {
        error: 'Server already has ledger data.',
        currentRevision: getState().revision,
      });
      return;
    }
    sendJson(res, 200, saveState(body.data, body.revision ?? 0));
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/ledger/export') {
    requireAuth(req);
    const state = getState();
    if (!state.hasData) {
      sendJson(res, 404, { error: 'No ledger data to export.' });
      return;
    }
    const fileName = `daily-ledger-backup_${new Date()
      .toISOString()
      .slice(0, 16)
      .replace(/[-:T]/g, '')}.json`;
    res.writeHead(200, {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${fileName}"`,
    });
    res.end(`${JSON.stringify(createBackupPayload(state), null, 2)}\n`);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/backups/run') {
    requireAuth(req);
    const filePath = runDailyBackup();
    sendJson(res, 200, { ok: true, file: filePath ? path.basename(filePath) : null });
    return;
  }

  sendJson(res, 404, { error: 'Not found.' });
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  if (!url.pathname.startsWith('/api/')) {
    if (!sendStatic(req, res)) {
      res.writeHead(404);
      res.end('Not found');
    }
    return;
  }

  handleApi(req, res, url).catch((error) => {
    sendError(res, error);
  });
});

runDailyBackup();
setInterval(runDailyBackup, 60 * 60 * 1000).unref();

server.listen(PORT, HOST, () => {
  console.log(`Daily Ledger server listening on ${HOST}:${PORT}`);
  console.log(`Ledger data file: ${LEDGER_PATH}`);
});
