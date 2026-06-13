# Life Budget Data Calculation and Rollback Audit

Date: 2026-06-14

## Scope

This is a read-only audit of the `生活预算` page. It maps visible data to source formulas, reviews mutation and deletion rollback behavior, and lists consistency risks.

## Data Model

Core stored state:

- `DailyData.transactions`: append-only user-facing events until deletion.
- `DailyTransaction.allocation`: the rollback ledger for money pockets:
  - `week`
  - `buffer`
  - `advance`
  - `reserve`
  - `fixed`
- `LifeBudgetState.pockets`:
  - `spendable`: current spendable pool across budget weeks.
  - `buffer`: weekly supplement buffer.
  - `reserve`: hidden savings / large-expense reserve.
  - `fixedReserved`: manually reserved fixed-expense money.
- `LifeBudgetState.currentCycle`:
  - cycle date range, main income, weekly allowance, weeks, starting buffer, reserve deposit/recovery.
- `LifeBudgetState.archivedCycles`: prior cycles.
- `LifeBudgetState.fixedExpenses`: recurring fixed expense definitions and per-cycle paid marker.

Key architectural fact: transaction deletion depends on `DailyTransaction.allocation`. If allocation is missing or incomplete, rollback becomes approximate.

## Visible Data Map

### Home: 本预算周 Card

Source: `components/DailyLedger.tsx` and `getBudgetSnapshot`.

- `本预算周` big number:
  - UI: `snapshot.weekRemaining`.
  - Formula: `max(0, currentWeek.allowance - weekSpent)`.
  - `weekSpent` comes from `getWeekExpenseTotal`.
- `已用`:
  - UI: `snapshot.weekSpent`.
  - Formula: weekly non-large expenses.
  - Fixed expense special case: only `allocation.week + allocation.advance` counts.
- Progress bar:
  - `weekProgress = weekSpent / week.allowance`.
- Date range:
  - `week.startDate - week.endDate`.
- `周期余额`:
  - UI: `currentCycleSummary.balance`.
  - Formula: `(sum(cycle.weeks.allowance) + cycle.startingBuffer) - livingSpent`.
  - `livingSpent` currently excludes both `large` and `fixed`.
- `本周额度`:
  - `week.allowance`.
- `周期状态`:
  - `snapshot.isExtended ? 延长期 : cycle ? 进行中 : 未开始`.
- `缓冲金`:
  - `budget.pockets.buffer`.

### Pending / Fixed Summary Card

- `固定支出`: `snapshot.pendingFixed.length`.
  - Active fixed expenses whose `paidCycleId !== currentCycle.id`.
- `余额校准`: `snapshot.needsCalibration`.
  - `Boolean(currentWeek)`.
- `补回缺口`: `snapshot.reserveGap`.
  - `max(0, reserveMinimum - pockets.reserve)`.
- Fixed tab:
  - `budget.pockets.fixedReserved`.
  - active fixed expense count.
  - pending fixed count.

### Weekly Chart

Source: `currentCycleSummary.weeks`.

- Each week budget: `week.allowance`.
- Each week spent: `getWeekExpenseTotal(transactions, week)`.
- Future weeks display spent as `0` and label `未来`.
- Bar height: `week.allowance / max(allowance, spent across weeks)`.
- Stack ratio: `spent / allowance` vs remaining.

### Cycle Detail Modal

Top pocket grid:

- `本预算周剩余`: `snapshot.weekRemaining`.
- `缓冲金`: `budget.pockets.buffer`.
- `固定支出预留`: `budget.pockets.fixedReserved`.
- `储备金`: `budget.pockets.reserve`.

Current cycle panel:

- `周期收入`: `cycle.mainIncome`.
- `日常预算`: `currentCycleSummary.budget = sum(weeks.allowance) + cycle.startingBuffer`.
- `日常结余`: `currentCycleSummary.balance = budget - livingSpent`.
- `储备增长`: `cycle.reserveDeposit + cycle.reserveRecovery`.
- Per-week rows: `getBudgetWeekSummaries`.

Recent cycles:

- Current plus archived cycles from `getBudgetCycleSummaries`.
- Historical cycles display `balance`; future cycles display `budget`.

### Settings Reserve Panel

- `储备金概览`: `budget.pockets.reserve`.
- `最低线`: `getReserveMinimum`.
  - If override exists: override.
  - Else active fixed expense total + two weeks of minimum living line.
- `净变化`: `snapshot.reserveNetChange`.
  - `cycle.reserveDeposit - sum(large expenses after cycle.startDate)`.

### Events

- Recent events are transactions sorted by `date` descending, limited to 10.
- Display label uses `incomeKindLabels` or `categoryLabels`.
- Delete calls `deleteDailyTransaction(transaction.id)`.

## Mutation Map

### Initialize Budget

`initializeLifeBudget` sets:

- `initialized = true`.
- settings from form/defaults.
- pockets from setup form:
  - spendable
  - buffer
  - reserve
  - fixedReserved = 0

No transaction is created. There is no rollback history for initialization.

### Income Allocation

`allocateIncome` behavior by `incomeKind`:

- `casual` / `correction`:
  - transaction allocation: all to `buffer`.
  - pocket mutation: `buffer += amount`.
- `refund`:
  - transaction allocation: all to `week`.
  - pocket mutation: `spendable += amount`.
- `main`, inside current cycle:
  - computes reserve deposit, reserve recovery, buffer, spendable.
  - adds to current cycle:
    - `mainIncome`
    - `reserveDeposit`
    - `reserveRecovery`
    - `startingBuffer`
  - pockets increase by spendable/buffer/reserve allocation.
- `main`, outside current cycle:
  - creates a new cycle.
  - archives previous current cycle.
  - replaces `spendable` and `buffer` with the new cycle's values.
  - keeps `reserve + reserve allocation`.

### Expense

`recordExpense` behavior by category:

- `large`:
  - allocation: all to reserve.
  - pocket mutation: `reserve = max(0, reserve - amount)`.
- other categories:
  - drain current week remaining first.
  - then buffer.
  - then advance.
  - pocket mutation:
    - `spendable -= week + advance`
    - `buffer -= buffer`

### Balance Calibration

`calibrateSpendableBalance`:

- expected balance = `snapshot.weekRemaining + budget.pockets.buffer`.
- if actual < expected: records an `unrecorded` expense for the difference.
- if actual > expected: records a `correction` income for the difference.

### Fixed Expense Reserve

`adjustFixedReserved`:

- sets `fixedReserved = input amount`.
- adjusts `spendable = max(0, spendable + oldFixedReserved - newFixedReserved)`.
- no transaction is created.

### Fixed Expense Payment

`markFixedExpensePaid`:

- creates fixed expense transaction.
- allocation order:
  - fixed reserve first
  - current week
  - buffer
  - advance
- pocket mutation:
  - `fixedReserved -= fixedExpense.amount`, clamped to zero.
  - `spendable -= allocation.week + allocation.advance`.
  - `buffer -= allocation.buffer`.
- marks fixed expense paid for current cycle.

### Deletion

`deleteDailyTransaction`:

- finds transaction.
- uses `transaction.allocation`, or a fallback for legacy transactions.
- direction:
  - income: subtract allocation from pockets.
  - expense: add allocation back to pockets.
- main income deletion also calls `rollbackCycleMainIncome`.
- fixed expense deletion tries to unmark matching fixed expense definitions by `name + amount + paidDate`.

## Findings

### 1. High: deleting a new-cycle main income does not restore the previous active cycle

When a main income starts a new cycle, `allocateIncome` archives the previous `currentCycle`, replaces `currentCycle`, and resets `spendable` / `buffer` to the new cycle values. Deleting that income can set `currentCycle` to `null`, but it does not promote the archived previous cycle back to current and does not restore the previous pockets.

Reproduced with:

- create first cycle.
- record expense.
- create second cycle.
- delete second cycle income.

Observed:

- `currentCycle = null`.
- previous cycle remains archived.
- `spendable = 0`, `buffer = 0`.
- earlier income and expense transactions still exist.

Impact: correcting a wrong salary date can leave the app with no active cycle and misleading weekly budget state.

### 2. High: Excel "完整备份" is not complete for life budget

Daily Excel export writes only:

- date
- type
- amount
- desc

It omits:

- budget pockets
- current/archived cycles
- fixed expenses
- category
- income kind
- allocation

Import reconstructs plain transactions and calls `sanitizeDailyData` without budget. This destroys rollback metadata and life-budget state. The whole-site JSON backup is currently the only complete backup path.

Impact: a user can export what appears to be a full backup, import it later, and lose the ability to accurately delete/rollback records.

### 3. High: fixed-reserve adjustment can create money

`adjustFixedReserved` lets the user set fixed reserve to any nonnegative amount. It subtracts from spendable, but clamps spendable at zero. If spendable is 100 and fixed reserve is set to 1000, total tracked money increases by 900.

Impact: setting fixed reserve above available spendable can inflate the ledger without a transaction trail.

### 4. High: cycle balance excludes fixed expenses even when they consume weekly money

Weekly spent includes fixed expenses when paid from week/advance. But cycle `日常结余` uses `getCycleLivingExpenseTotal`, which excludes fixed expenses completely.

Reproduced:

- fixed expense of 40 paid with no fixed reserve.
- week spent = 40.
- cycle summary `spent = 40`.
- cycle `livingSpent = 0`.
- cycle `balance` unchanged.

Impact: the home `周期余额` and cycle `日常结余` can overstate remaining cycle money after fixed expenses are paid from weekly budget.

### 5. High: cycle balance excludes casual income that increases usable buffer

Casual income and balance corrections are allocated directly to `budget.pockets.buffer`, but they do not update the current cycle's `startingBuffer`, weekly allowances, or any other field used by `currentCycleSummary.balance`.

Current formula:

- `周期余额 = sum(cycle.weeks.allowance) + cycle.startingBuffer - livingSpent`

Casual income path:

- transaction allocation: `buffer = amount`
- pocket mutation: `budget.pockets.buffer += amount`
- no cycle summary mutation

Impact: the top-card `周期余额` and cycle modal `日常结余` can understate available cycle money after红包/零散收入 because the actual buffer increased but the cycle balance formula ignores it.

Open product decision:

- If casual income is intended as current-cycle usable money, cycle balance should include buffer changes from casual/correction income.
- If casual income is intended as extra buffer outside cycle budget, the UI should label this clearly and display it separately.

### 6. Medium: large expense deletion can over-credit reserve when reserve was insufficient

Large expense transactions store `allocation.reserve = full amount`, but the actual reserve deduction is clamped at zero. If reserve is 50 and large expense is 100, deletion adds 100 back, not 50.

Impact: deleting a large expense can inflate reserve if the expense exceeded reserve at record time.

### 7. Medium: reserve deposit vs reserve recovery is not reversible

Transactions store only combined `allocation.reserve`. Cycle stores separate:

- `reserveDeposit`
- `reserveRecovery`

Deletion subtracts reserve rollback from deposit first, then recovery. Sanitizer repair also collapses all reserve allocation into `reserveDeposit` and resets `reserveRecovery = 0`.

Impact: cycle summary can show wrong split after deleting one of multiple main incomes or after sanitize repair.

### 8. Medium: fixed expense deletion can unpay multiple identical fixed expenses

Fixed payment transactions do not store `fixedExpenseId`. Deletion unmarks by matching:

- name
- amount
- paidDate

If two identical fixed expenses are paid on the same day, deleting one transaction can unmark both.

Impact: duplicate fixed expense definitions can drift after deletion.

### 9. Medium: sanitizer repair can drop valid cycles when transaction metadata is missing

`repairCycleFromTransactions` keeps a cycle only if it can find `incomeKind === 'main'` transactions inside that cycle date range.

Older/imported transactions may lack `incomeKind`, especially from Excel import. In those cases sanitize can drop current/archived cycles.

Impact: useful cycle data can disappear on refresh/import if transaction metadata is incomplete.

### 10. Medium: reserve net change date window is too broad

`reserveNetChange` subtracts large expenses with `date >= cycle.startDate`, but does not require `date <= cycle.plannedEndDate`.

Impact: if future-dated large expenses exist while the current cycle remains active/extended, reserve net change can include expenses outside the intended cycle.

### 11. Low/Medium: setting changes do not recalculate current cycle

Updating settings changes future calculations, reserve minimum, and UI thresholds, but it does not recalculate existing weeks/cycle allocations.

This may be intended, but the UI does not make the boundary obvious.

Impact: user may expect changing savings/buffer/minimum settings to update the current cycle, but current cycle data remains based on old settings.

### 12. Low: initialization and fixed-reserve adjustment have no transaction trail

Initialization and fixed-reserve changes mutate pockets directly. They cannot be undone through the event list.

Impact: harder to audit how balances reached their current state.

## Recommended Fix Order

1. Make life-budget Excel backup either truly complete or clearly legacy-only. Prefer exporting full JSON-like budget state into Excel sheets, including allocations.
2. Store enough rollback metadata for cycle replacement:
   - previous current cycle id/state, or
   - explicit cycle-opening transaction metadata that can restore archived current cycle.
3. Fix `adjustFixedReserved` to only move money that exists, or model overflow explicitly as calibration/negative spendable.
4. Decide and implement casual-income cycle treatment:
   - include casual/correction buffer additions in cycle balance, or
   - show them as separate non-cycle buffer.
5. Fix cycle balance to include fixed expense portions paid from week/advance/buffer when no fixed reserve covered them.
6. Fix large expense allocation to record actual reserve deduction, and optionally model uncovered amount separately.
7. Store `fixedExpenseId` on fixed-payment transactions.
8. Split `allocation.reserve` into `reserveDeposit` and `reserveRecovery`, or store a typed allocation breakdown.
9. Make sanitizer repair conservative:
   - do not drop cycles solely because metadata is missing.
   - repair only fields that can be confidently derived.
10. Add regression tests for:
   - delete same-cycle main income.
   - delete new-cycle main income restores previous cycle.
   - casual income affects whichever balance the product decides it should affect.
   - delete large expense with insufficient reserve.
   - fixed expense in cycle balance.
   - Excel export/import preserves life-budget rollback fields.

## Overall Assessment

The current design has a good core idea: transactions carry allocations, and deletion reverses allocations. That works for simple modern income/expense records.

The weak points are around operations that mutate more than pockets:

- cycle replacement
- fixed reserve manual movement
- fixed expense paid markers
- Excel import/export
- sanitizer repair

The system needs a clearer invariant:

> Every state mutation that changes money or cycle status should either be a reversible transaction with complete metadata, or be explicitly marked as non-reversible calibration/setup.

## Fix Verification

Implemented on 2026-06-14.

### Closed Findings

1. New-cycle income deletion now stores `previousCycle` and `previousPockets` on the opening main-income transaction. If the deleted transaction is the current cycle opener and would remove the current cycle's whole main income, deletion restores the previous cycle and replays later pocket-level transactions.
2. Daily Excel export now includes a `完整状态` sheet with chunked serialized `DailyData`. Import prefers that full-state sheet and sanitizes it, so budget pockets, cycles, fixed expenses, transaction allocations, fixed-expense ids, and cycle rollback metadata survive a round trip.
3. Fixed-reserve adjustment now clamps the target to `spendable + fixedReserved`, preserving total current spendable money instead of creating money.
4. Cycle living spend now uses usable expense allocation (`week + buffer + advance`) for all non-large expenses, including fixed expenses paid from weekly/buffer/advance money.
5. Cycle living budget now includes usable income allocations inside the cycle, so casual income, refunds, and balance corrections that enter usable money affect the displayed cycle balance.
6. Large expenses now record only the actual reserve amount deducted in `allocation.reserve`; deletion restores only that amount.
7. Main-income allocations now store `reserveDeposit` and `reserveRecovery` separately. Deletion and sanitize repair preserve the split when present.
8. Fixed payment transactions now store `fixedExpenseId`; deletion unmarks only the matching fixed expense when the id is available.
9. Sanitizer repair now treats missing `incomeKind` as legacy main-income metadata for cycle repair and preserves existing non-empty cycles when no transaction metadata is available, rather than dropping them solely because metadata is incomplete.
10. Reserve net change now counts large expenses only through the current cycle planned end date and uses the actual reserve allocation where available.
11. Settings UI now states that settings affect future income allocation and reminder lines; existing budget weeks are not recalculated.
12. Fixed-reserve UI now states that the reserve action only moves currently available spendable money and clamps above the movable amount. Initialization remains a setup action without transaction history by design.

### Additional Edge Review

- Deleting a historical cycle-opening income no longer subtracts that old cycle's already-overwritten weekly allowance or buffer from the current pockets. Only persistent cross-cycle allocation, such as reserve and fixed reserve, is rolled back for that historical opener.
- Deleting the current cycle opener with later regular transactions restores the prior pocket snapshot and replays later transaction allocations, preserving the user's later corrections/expenses without leaving the app in a no-cycle state.
- The transaction allocation remains the source of truth for rollback. Legacy records without allocations still use fallback rules, so rollback is approximate only for records that never stored enough metadata.

### Regression Checks Run

- `npx tsc --noEmit`
- `npm run build`
- `git diff --check`
- Function-level daily regression script covering:
  - delete current cycle opener restores previous cycle and pockets.
  - casual income increases current cycle balance.
  - fixed expense paid from weekly money reduces cycle balance.
  - fixed-reserve adjustment clamps to movable money.
  - large-expense deletion restores only actual reserve deduction.
  - duplicate fixed expenses delete by `fixedExpenseId`.
  - reserve deposit/recovery split survives sanitize and rollback.
  - old cycle data survives sanitize when transaction metadata is absent.
  - future-dated large expenses do not affect current reserve net change.
- Function-level Excel regression script covering:
  - `完整状态` sheet is exported.
  - full import restores current cycle, archived cycles, fixed expenses, `fixedExpenseId`, `previousCycle`, `previousPockets`, and reserve split metadata.

### Residual Non-Risk Limitations

- Setup and fixed-reserve movement are still not normal transactions. They are bounded and labeled as setup/manual movement actions rather than event-list records.
- Legacy records created before allocation metadata existed can only be rolled back by fallback rules. New records and full-state Excel backups preserve complete rollback metadata.
