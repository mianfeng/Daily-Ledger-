# Redesign life budget cycle detail

## Goal

Redesign the life budget cycle detail panel so it answers the user's practical questions clearly:

- How much money can I still use in this current budget cycle?
- How much money do I have in total right now?
- What do the smaller numbers mean, and how are they related?

## What I Already Know

- The user says the current cycle detail is not intuitive.
- The user can see scattered data, but cannot tell what the current cycle balance or total available money means.
- Screenshot shows the current panel with:
  - top cards: `本预算周剩余`, `缓冲金`, `固定支出预留`, `储备金`
  - current cycle cards: `周期收入`, `日常预算`, `日常结余`, `储备增长`
  - weekly list with remaining/budget/spent
- Current implementation is in `components/DailyLedger.tsx` under `panel === 'cycle'`.
- Current data comes from `getBudgetSnapshot` and `getBudgetCycleSummaries` in `lib/daily.ts`.
- Previous design decisions:
  - Reserve money should not be constantly emphasized, because staring at savings can make the user want to spend it.
  - Calibration target is non-reserve usable balance: spendable + buffer + fixed reserve.
  - App stays local/static, no backend.

## Assumptions (Temporary)

- This is mainly a UI/wording/information hierarchy change, not a new accounting model.
- The panel should remain mobile-first and compact.
- The first screen of the popup should show one or two clear headline numbers before the detailed weekly breakdown.
- Storage/data migration should not be necessary unless new derived fields are needed.

## Requirements

- Make the cycle detail panel more intuitive.
- Give the user a clear current-cycle remaining number.
- Give the user a clear total-current-money number, with an agreed definition.
- Show a top-level `总金额` large box.
- Inside the `总金额` box, show smaller boxes for the money components.
- `总金额` should equal `可动用余额 + 储备金`.
- `总金额` should first split into `可动用余额` and `储备金`.
- `可动用余额` should equal `本周期日常剩余 + 缓冲金 + 固定支出预留`.
- `本周期日常剩余` should use the actual `LifeBudgetState.pockets.spendable` pocket, not the older cycle summary `balance`, to avoid double-counting buffer money.
- `本周剩余` should remain visible as a separate reminder, not part of the total-money formula.
- `储备金` should be included in total amount but visually secondary to `可动用余额`.
- Add helper text that reserve money is not daily spendable money.
- Use `本周期日常剩余` as the label for cycle-level daily spendable money.
- Add helper text that `本周期日常剩余` is cycle-level money and is not the same as this week's available spending.
- Weekly details should be collapsed by default.
- The cycle detail first view should show a compact current-week reminder and a `查看每周明细` entry.
- Expanded weekly details should retain the per-week budget/spent/remaining information.
- Existing `日常结余` should be promoted/renamed to the primary `本周期日常剩余`.
- Secondary cycle metrics should keep `周期收入`, `日常预算`, and `储备增长`.
- Avoid showing `日常结余` again as a separate secondary card to reduce duplication.
- Show concise formula helper text:
  - `总金额 = 可动用余额 + 储备金`
  - `可动用余额 = 本周期日常剩余 + 缓冲金 + 固定预留`
- Do not add a long calculation explainer for MVP.
- First-view section order should be:
  1. `总金额` large box
  2. compact `本周提醒`
  3. secondary cycle source data
  4. collapsed weekly detail entry
- Use the `frontend-design` skill during implementation.
- Visual direction should be mobile-first, clear, restrained, and dashboard-like rather than decorative.
- The top `总金额` section should use a financial dashboard style:
  - large title and total number
  - visually stronger `可动用余额`
  - visually weaker `储备金`
  - small pills/cards for `本周期日常剩余`, `缓冲金`, and `固定预留`
- Do not add new charts for MVP.
- Keep progress bars only where they support existing weekly/current-week clarity.
- Preserve existing budget calculations unless a bug is discovered.

## Acceptance Criteria

- [x] User can open cycle detail and immediately see how much is available for the current cycle.
- [x] User can see a top `总金额` section with component amounts inside it.
- [x] The top `总金额` visibly separates `可动用余额` from `储备金`.
- [x] The panel makes clear that cycle-level spendable money is not the same as this week's remaining allowance.
- [x] User can distinguish current-week remaining from whole-cycle remaining.
- [x] User can distinguish spendable/buffer/fixed reserve/reserve without guessing.
- [x] Secondary metrics explain where the main numbers come from without duplicating the primary numbers.
- [x] Short formula text is visible enough to clarify definitions without dominating the UI.
- [x] The first visible screen follows the agreed order: total amount, this-week reminder, source data, weekly detail entry.
- [x] The top total section reads as one coherent dashboard, not four unrelated cards.
- [x] No new chart type is added for this redesign.
- [x] Mobile layout fits without hiding the main numbers below the fold.
- [x] Existing old data still loads.
- [x] Weekly details are available but do not dominate the first view.

## Definition of Done

- `npm run build` passes.
- Type checking passes.
- Any changed calculation contract is documented in `.trellis/spec/`.
- PRD decisions are reflected in UI wording.

## Out of Scope (Temporary)

- Changing the underlying weekly allowance generation model.
- Adding complex charts.
- Adding any new chart type for this redesign.
- Adding multi-goal savings.
- Account-level bank reconciliation.

## Technical Notes

- Likely touched files:
  - `components/DailyLedger.tsx`
  - possibly `lib/daily.ts` if new derived totals are needed
  - possibly `.trellis/spec/frontend/state-management.md` if new calculation contracts are introduced
- Implementation note: the popup's `本周期日常剩余` should come from `budget.pockets.spendable`; the older cycle summary `balance` is a reporting metric and may already include buffer-like usable allocations.
