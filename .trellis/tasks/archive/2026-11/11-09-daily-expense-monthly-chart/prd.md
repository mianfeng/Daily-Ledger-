# Daily expense grouping and monthly chart

## Goal

Replace individual expense browsing with daily totals and drill-down details, and add monthly expense statistics at the bottom of the daily ledger. Confirm the design with the user before implementation.

## Known Context

- User requests two levels: daily expense totals, then individual records for a selected day.
- User requests a bottom chart showing monthly expense totals.
- DailyLedger currently shows three recent mixed events and a history page with search and filters.
- Transactions include income, expense and internal transfer; prepaid expenses also have an effectiveDate.
- Existing transaction detail supports allocation inspection and deletion with rollback.
- React/TypeScript app already depends on Recharts.

## Requirements

- Clarify the design using grill-me; user explicitly requests three questions per round for efficiency.
- Daily drill-down shows expenses only, matching the daily expense total; income and internal transfers remain accessible via a separate all-transactions entry.
- Replace the homepage recent-events section with daily expense summaries for the latest seven dates containing expenses. A view-all entry opens the full daily list; keep a separate all-transactions entry.
- Aggregate by actual payment date (`date`), including prepaid expenses in the payment day/month rather than `effectiveDate`.
- Include all expense categories, including fixed, large and unrecorded expenses from balance calibration. Exclude income and transfers. Refund/reimbursement income does not reduce expense totals.
- Bottom chart uses monthly bars for January through December of a selected calendar year, with year navigation and annual expense total. Default to the current year; past months without expenses show zero, future months are empty.
- Clicking a date opens a separate day-detail page with date, total expenses and transaction count. Individual rows retain funds-flow details and deletion. Returning preserves the previous list position and month selection.
- Clicking/tapping a monthly bar only reveals its exact amount; it does not navigate to a monthly list.
- The full daily-summary page defaults to the current calendar month, supports year/month navigation, displays monthly total and lists dates newest first. Omit days without expenses.
- A daily summary row displays date, total expense amount, transaction count and a navigation indicator.
- Deleting a transaction refreshes day, month and year totals from source transactions; an emptied day disappears and day detail provides an empty state.
- Do not change application code before user confirms the complete plan.
- Preserve individual transaction data and existing rollback behavior.

## Confirmed Scope

- Scope is the life/daily ledger, rather than the copper business ledger.
- Aggregations can be derived from existing transactions without data migration.

## Approval

- User confirmed the complete design and authorized implementation, verification, commit and push.

## Acceptance Criteria (Evolving)

- [x] Daily totals match the agreed expense accounting rules.
- [x] Selecting a day reveals its individual records.
- [x] Bottom chart shows correct monthly totals.
- [x] Existing transaction detail and deletion continue to work.
- [x] Daily pages retain selected month and scroll position after returning from day/transaction details.
- [x] Past empty months show zero; future empty months are visually distinguished and do not imply a completed zero-spend month. Any existing future-dated expense is still included and visible.
- [x] Year/month transitions, no-expense states, prepaid payments, fixed expenses and deletion totals are verified.
- [x] Typecheck, build and focused interaction checks pass.

## Out of Scope

- Copper business ledger changes.
- Changes to budgets, income allocation, storage schemas or backup formats.
- Category charts, budgets versus actuals, chart-to-list navigation and new search/filter features.
- Net expense accounting that subtracts refund income.

## Technical Approach

- Derive daily and monthly expense summaries from existing expense transactions; keep individual records as the source of truth and use currency-safe aggregation.
- Reuse existing page overlays and detail/delete behavior, observing history/back navigation and keep-alive conventions.
- Reuse the existing Recharts dependency and Kyoto design tokens for the monthly bar chart; support mobile tap and readable numeric values.
- Keep the all-transactions page and its existing search/filters available separately.

## Implementation Plan

1. Inspect relevant frontend specs and current overlay/history/scroll behavior.
2. Add reusable expense aggregation and daily browsing/day-detail UI.
3. Add the monthly chart with year navigation and empty states.
4. Verify aggregation boundaries, back navigation and deletion refresh; run typecheck, build and relevant UI checks.

## Technical Notes

- Main UI: components/DailyLedger.tsx (recentEvents, filteredEvents, history panel).
- Data types: types.ts (DailyTransaction).
- Budget logic: lib/daily.ts; calendar helpers: lib/date.ts.
- Relevant specs: .trellis/spec/frontend/state-management.md and mobile-ui.md.
- Existing active task about early main-income cycles is separate from this request.
