# State Management

> How state is managed in this project.

---

## Scenario: VPS-Backed Ledger State

### 1. Scope / Trigger

- Trigger: ledger persistence moved from browser-only `localStorage` to a VPS API backed by file-backed JSON storage.
- Applies when changing app-level ledger state, authentication state, backup import/export, migration, or autosave behavior.
- The combined ledger state is the app-level source of truth:
  - `copper: CopperData`
  - `daily: DailyData`

### 2. Signatures

- Frontend state type: `AppLedgerData`
- Login API: `POST /api/auth/login`
- Session API: `GET /api/auth/session`
- Logout API: `POST /api/auth/logout`
- Load ledger API: `GET /api/ledger`
- Save ledger API: `PUT /api/ledger`
- Empty-server migration API: `POST /api/ledger/import`
- Manual export API: `GET /api/ledger/export`
- Manual backup API: `POST /api/backups/run`
- Server files:
  - `DATA_DIR/ledger.json`
  - `DATA_DIR/sessions.json`
- Constrained VPS runner:
  - `server/daily_ledger_server.py` is a Python standard-library runner for hosts where Node/npm installation or Vite builds would be too heavy.
  - It must preserve the same API contract as `server/index.mjs`.
  - Password verification must match `server/password.mjs`: the stored salt text is passed to scrypt as UTF-8 text, not decoded from hex bytes.

### 3. Contracts

- `POST /api/auth/login` request:
  - `username: string`
  - `password: string`
- Auth behavior:
  - The server verifies `ADMIN_USERNAME` and `ADMIN_PASSWORD_HASH`.
  - Password hashes use `scrypt:<saltHex>:<hashHex>`.
  - Successful login sets an httpOnly session cookie.
- `GET /api/ledger` response:
  - `hasData: boolean`
  - `data: AppLedgerData | null`
  - `revision: number`
  - `updatedAt: string | null`
- `PUT /api/ledger` request:
  - `data: AppLedgerData`
  - `revision: number`
- `POST /api/ledger/import` request:
  - `data: AppLedgerData`
  - `revision: number`
  - `requireEmpty: boolean`
- Required environment keys:
  - `ADMIN_USERNAME`
  - `ADMIN_PASSWORD_HASH`
  - `APP_DOMAIN` for Caddy deployments
- Optional environment keys:
  - `HOST`
  - `PORT`
  - `DATA_DIR`
  - `BACKUP_DIR`
  - `SESSION_TTL_DAYS`
  - `COOKIE_SECURE`

### 4. Validation & Error Matrix

- Missing or invalid session -> `401`.
- Wrong username/password -> `401`.
- Invalid ledger payload -> `400`.
- Save with stale `revision` -> `409` and `currentRevision`.
- Empty-server import when server already has data -> `409`.
- Export with no server data -> `404`.
- Network or server failure during autosave -> UI shows failure and keeps in-browser edits visible.
- Save conflict -> UI shows conflict and asks the user to refresh before continuing.

### 5. Good/Base/Bad Cases

- Good: user logs in, loads `revision=3`, edits one entry, autosave sends `revision=3`, server stores `revision=4`, UI shows saved.
- Base: server is empty and browser has old local data; UI prompts before importing old data.
- Bad: phone loaded `revision=3`, desktop saved `revision=4`, phone tries to save `revision=3`; server rejects with `409` and phone must not overwrite desktop data.

### 6. Tests Required

- Type-check should cover frontend API call sites and `AppLedgerData` usage.
- Build should cover production bundling.
- Server smoke test should assert:
  - `/api/health` returns `{ ok: true }`
  - login succeeds with the configured admin hash
  - unauthenticated ledger access fails
  - authenticated empty ledger load returns `hasData=false`
  - first save with `revision=0` returns `revision=1`
- When automated tests are added later, cover stale revision `409` behavior and empty-server migration refusal.

### 7. Wrong vs Correct

#### Wrong

```ts
// Silently overwrite the server with whatever this browser currently has.
await api.saveLedger(currentData, latestRevisionFromSomewhereElse);
```

#### Correct

```ts
// Save only against the revision this browser actually loaded.
await api.saveLedger(currentData, loadedRevision);
```

---

## Current Pattern

- `App.tsx` owns server-loaded ledger state and passes `data` plus `setData` into feature components.
- Feature components should not read or write `localStorage` directly.
- Old `localStorage` keys are migration inputs only:
  - `coinShopData_v5`
  - `dailyBookData_v5`
- Autosave must be debounced and serialized so one browser does not create self-conflicts on slow networks.
