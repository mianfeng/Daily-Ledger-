# State Management

> How state is managed in this project.

---

## Scenario: Static GitHub Ledger State

### 1. Scope / Trigger

- Trigger: the official app runtime is a static GitHub-hosted frontend with no VPS backend.
- Applies when changing app-level ledger state, backup import/export, migration, or persistence behavior.
- The combined ledger state is owned by `App.tsx`:
  - `copper: CopperData`
  - `daily: DailyData`

### 2. Signatures

- Frontend state type: `AppLedgerData`
- Storage keys:
  - `coinShopData_v5`
  - `dailyBookData_v5`
- Read helper:
  - `readLocalLedgerData(): AppLedgerData`
- Write helper:
  - `writeLocalLedgerData(data: AppLedgerData): void`
- Backup sanitizer:
  - `sanitizeBackup(raw: unknown): AppLedgerData`

### 3. Contracts

- The app must not require `/api/*` endpoints at runtime.
- The app must not require login, cookies, server sessions, environment variables, or a Node/Python process for production use.
- `App.tsx` owns the combined ledger state and passes each slice plus setter into feature components.
- Feature components must not read or write `localStorage` directly.
- Local persistence writes:
  - `data.copper` to `coinShopData_v5`
  - `data.daily` to `dailyBookData_v5`
- Whole-site JSON backup shape:
  - `version: number`
  - `exportedAt: string`
  - `origin?: string`
  - `copper: CopperData`
  - `daily: DailyData`

### 4. Validation & Error Matrix

- Missing local storage data -> use defaults.
- Invalid local storage JSON -> use defaults.
- Invalid backup JSON -> show import failure and keep current in-memory data.
- Valid backup JSON -> sanitize both ledgers before replacing current state.
- Browser storage write failure -> keep current in-memory edits visible; do not crash the UI.

### 5. Good/Base/Bad Cases

- Good: user edits an entry, `App.tsx` updates state, `writeLocalLedgerData` persists both ledger slices to browser storage.
- Base: first visit has no storage keys; the app opens with default data.
- Bad: feature components call `localStorage` directly; backup and app-level persistence can drift.

### 6. Tests Required

- Type-check should cover `AppLedgerData`, feature component props, and storage helper call sites.
- Build should cover production static bundling.
- When automated tests are added later, cover:
  - invalid storage falls back to defaults
  - backup import sanitizes malformed payloads
  - App shell can render with no `/api/*` endpoints

### 7. Wrong vs Correct

#### Wrong

```ts
// Static GitHub deployments do not provide this endpoint.
await api.saveLedger(currentData, revision);
```

#### Correct

```ts
// Persist the app-owned ledger state to browser storage.
writeLocalLedgerData(currentData);
```

---

## Current Pattern

- `App.tsx` owns browser-loaded ledger state and passes `data` plus `setData` into feature components.
- Feature components should not read or write `localStorage` directly.
- Whole-site JSON import/export is the migration path between browsers, devices, and domains.
- Static deployment has no built-in multi-device sync; adding sync requires an external backend such as Supabase, Firebase, or Cloudflare Workers/D1.

---

## Scenario: Copper Transaction State

### 1. Scope / Trigger

- Trigger: the copper ledger stores business transactions with cash allocation and inventory cost effects.
- Applies when changing `CopperData`, copper backup compatibility, transaction rollback, or pending sale behavior.

### 2. Contracts

- `CopperTransaction.cashAllocation` and `inventoryDelta` are the rollback ledger for cash and inventory changes.
- Pending copper sales are still applied immediately to cash balances and inventory cost.
- Confirming a pending copper sale only changes confirmation metadata; it must not change balances or inventory cost.
- Cancelling a pending copper sale must rollback the original cash allocation and inventory delta exactly once, then keep the transaction as cancelled history.
- Cancelled copper sales must not count in income, profit, charts, monthly stats, or active balance calculations.
- Auto-confirm for pending copper sales is evaluated locally when the app loads or copper data is sanitized; no backend scheduler is available.

### 3. Tests Required

- Regression verification for pending sales should cover:
  - pending sale create applies the same cash and inventory effects as a normal sale
  - manual confirm changes status without changing balances
  - auto-confirm after 10 natural days changes status without changing balances
  - cancel rolls back cash and inventory and removes the sale from stats/charts
  - deleting a cancelled transaction does not rollback a second time
  - Excel export/import preserves confirmation status and dates

---

## Scenario: Life Budget Daily State

### 1. Scope / Trigger

- Trigger: the daily ledger is modeled as a life budget, not only legacy daily transactions.
- Applies when changing `DailyData`, daily backup compatibility, or the life budget UI.

### 2. Signatures

- `DailyData` keeps legacy fields:
  - `dailyLimit: number`
  - `transactions: DailyTransaction[]`
- `DailyData` may include the life budget state:
  - `budget?: LifeBudgetState`
- `LifeBudgetState` owns:
  - settings such as payday, savings rate, buffer rate, minimum weekly living line
  - pocket balances for spendable money, buffer, reserve, and fixed-expense reserve
  - current budget cycle, recent archived cycles, and fixed expenses

### 3. Contracts

- Existing stored payloads that only have `dailyLimit` and `transactions` must still load.
- `sanitizeDailyData` is responsible for filling missing budget fields with defaults.
- Components must update the daily slice through `setData`; they must not persist directly.
- Life budget calculations belong in `lib/daily.ts`, not scattered through the component.
- `DailyTransaction.allocation` is the rollback ledger for pocket mutations:
  - `week + advance` changes `LifeBudgetState.pockets.spendable`
  - `buffer` changes `LifeBudgetState.pockets.buffer`
  - `reserve` changes `LifeBudgetState.pockets.reserve`
  - `fixed` changes `LifeBudgetState.pockets.fixedReserved`
- Prepaid/future expenses keep `date` as the payment date and store
  `effectiveDate` as the spending/reporting date. Weekly and cycle reports use
  `effectiveDate`, while pocket deduction and rollback still use the original
  `allocation`.
- Any transaction that mutates more than pockets must store enough metadata to reverse the extra state:
  - fixed-expense payment transactions store `fixedExpenseId`
  - main-income transactions that start a new cycle store `previousCycle` and `previousPockets`
  - main-income transactions store `allocation.reserveDeposit` and `allocation.reserveRecovery` when reserve growth is split
- Daily Excel "完整备份" must preserve the full `DailyData` shape, not only visible rows. If row sheets are kept for readability, import should prefer the full-state sheet when present.

### 4. Validation & Error Matrix

- Missing `budget` -> use the default uninitialized life budget.
- Missing `archivedCycles` -> use an empty array for backward compatibility.
- Invalid budget settings -> clamp to safe defaults.
- Invalid fixed expenses or budget weeks -> drop invalid entries while keeping the rest.
- Invalid transactions -> drop invalid entries through transaction normalization.

### 5. Good/Base/Bad Cases

- Good: old daily backup opens, then the user initializes life budget balances.
- Base: new user starts with an uninitialized budget and empty transactions.
- Bad: a component assumes `data.budget` always exists without going through the budget helper/default.

### 6. Tests Required

- Build/type-check should cover old and new `DailyData` shapes.
- Manual verification should cover initialization, main income allocation, normal expenses, large expenses, calibration, and fixed expense payment.
- Regression verification for rollback changes should cover:
  - deleting a current cycle-opening main income restores the previous cycle and pocket baseline
  - deleting a historical cycle-opening main income does not subtract overwritten weekly/buffer money from the current pockets
  - deleting a large expense restores only the actual reserve allocation that was deducted
  - deleting one fixed payment unmarks only the matching `fixedExpenseId`
  - Excel export/import preserves allocation, fixed-expense, and previous-cycle metadata

### 7. Wrong vs Correct

#### Wrong

```ts
const reserve = data.budget.pockets.reserve;
```

#### Correct

```ts
const budget = getLifeBudget(data);
const reserve = budget.pockets.reserve;
```
