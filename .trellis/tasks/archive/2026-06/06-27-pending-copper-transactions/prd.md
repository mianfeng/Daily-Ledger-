# Plan pending copper transactions

## Goal

Add a pending/pre-recording workflow for copper sales so sold coins can be recorded when shipped or sold, then manually confirmed after receipt confirmation. Pending records should auto-confirm after 10 days without user action.

## What I Already Know

- The user sells copper coins and often waits for buyer receipt confirmation before the sale should be considered final.
- The user wants to pre-record the sale, then manually confirm it.
- If there is no action after 10 days, the pending sale should automatically confirm.
- Existing copper accounting applies transactions immediately:
  - `createCopperIncomeTransaction` creates a finalized income transaction.
  - `applyCopperTransaction` immediately updates cash balances and inventory cost.
  - `rollbackCopperTransaction` restores balances and inventory cost from the stored transaction deltas.
- Current copper transaction type is `income | expense | inventory_adjustment`.
- Current Excel export/import uses copper transaction rows without pending metadata.

## Assumptions (Temporary)

- MVP focuses on pending sales income, not pending purchases.
- Pending sale records should be visible in the copper UI and confirmable by hand.
- Auto-confirm can be evaluated when the app opens or when copper data is sanitized/loaded, because this is a static localStorage app with no backend scheduler.
- Static frontend/localStorage remains the runtime model.
- Pending sale pre-recording uses the same money/inventory effects as a normal confirmed sale; confirmation changes the transaction status, not the balances.

## Requirements

- Support creating pending copper sales.
- Support manually confirming pending sales.
- Pending sales auto-confirm after 10 days if no manual action happens.
- Pending sales immediately affect copper cash balances and inventory cost, matching normal sales; confirmation only changes status.
- Pending sales count in income, profit, and chart statistics before confirmation.
- Copper statistics should separately show how much is still pending confirmation.
- Confirming a pending sale keeps the original pre-recorded sale date for reporting.
- Pending sales can be cancelled before confirmation.
- Cancelling a pending sale rolls back the original cash allocation and inventory delta.
- Cancelled pending sales remain visible as cancelled history, but do not count in income, profit, charts, or active balances.
- Pending sales auto-confirm on the 11th calendar day after the sale date.
- Auto-confirm runs when the local app opens or copper data is sanitized/loaded; no backend scheduler is required.
- Copper sale form should include a `待确认` switch instead of adding a separate pre-recording entry.
- The `待确认` switch defaults to on for sales.
- Pending/confirmed/cancelled sale status should be shown in the existing transaction list.
- Do not add a separate homepage pending-sales card for MVP.
- Cancelled pending sales should be hidden from the recent transaction list by default, but remain available in full history/filter views.
- Pending sales in the transaction list should expose direct `确认` and `取消` actions.
- Auto-confirmed sales should display the same as normal confirmed sales; no visible `自动确认` label is required.
- Confirmed sales should not show a visible status label; only pending and cancelled statuses need labels.
- MVP only covers the pending-sale main flow. Editing pending sales, batch confirmation, and confirmed-sale refunds/returns are out of scope.
- Preserve rollback safety for confirmed transactions.
- Preserve old data compatibility.

## Decision Log

- Pending sales use immediate balance effects. Rationale: the user prefers pre-recording to behave like normal sales for cash/inventory, while still tracking whether the sale has been confirmed.
- Pending sales count in charts/monthly stats, with separate pending totals. Rationale: this keeps balances and reports consistent while still showing confirmation risk.
- Confirmed pending sales keep the original pre-recorded sale date. Rationale: confirmation is a state transition, not a reporting date change.
- Pending sales support cancellation with rollback while retaining cancelled history. Rationale: the user can recover from cancelled orders without losing audit context.
- Pending sales auto-confirm on sale date + 10 natural days, effective when the app loads/checks data. Rationale: the app only records dates and runs as local static frontend.
- Pending sale entry uses a switch in the existing sale form. Rationale: this preserves the current sales workflow while adding one clear status choice.
- Pending-sale entry defaults to on. Rationale: the user's common copper sale flow waits for receipt confirmation.
- Pending sales are shown through status labels and actions in the existing transaction list, not as a separate dashboard card. Rationale: the user prefers a lighter UI footprint.
- Cancelled pending sales are hidden from recent transactions but retained in full history/filter views. Rationale: this keeps the daily view clean without deleting audit context.
- Pending transaction actions are direct inline buttons. Rationale: confirmation should be low-friction and visible.
- Auto-confirmed sales do not need a visible auto-confirm label. Rationale: the user prefers a simpler transaction list.
- Confirmed sales remain visually normal; only pending and cancelled statuses are highlighted. Rationale: the UI should draw attention only to exceptional states.

## Acceptance Criteria

- [x] User can record a pending copper sale with amount, cost, date, and description.
- [x] Pending sale does not get lost after refresh.
- [x] User can manually confirm a pending sale.
- [x] A pending sale older than 10 days auto-confirms when the app is opened or data is loaded.
- [x] Old copper data still loads.
- [x] Excel export/import preserves pending sale status and confirmation metadata.

## Technical Approach

- Extend `CopperTransaction` with optional confirmation metadata:
  - `confirmationStatus?: 'pending' | 'confirmed' | 'cancelled'`
  - `confirmedAt?: string`
  - `cancelledAt?: string`
- Pending sales are created through the existing copper sales form and still use the existing `cashAllocation` and `inventoryDelta` rollback model.
- Manual and automatic confirmation update only confirmation metadata.
- Cancellation rolls back the stored allocation/delta once and keeps the transaction as cancelled history.
- Cancelled transactions are excluded from copper monthly stats and chart data.
- Excel export/import includes confirmation metadata fields.

## Definition of Done

- Tests or deterministic regression checks cover pending create, manual confirm, auto-confirm, delete/cancel, old data load, and import/export.
- `npm run build` passes.
- Type checking passes.
- Relevant Trellis spec/docs updated if this creates a persistent state contract.

## Out of Scope (Temporary)

- Backend reminders or push notifications.
- Multi-device sync for pending confirmation.
- Marketplace/order API integration.
- Editing pending sale amount/cost/date after creation; cancel and re-create instead.
- Batch confirming multiple pending sales.
- Refund/return flows after a sale has already been confirmed.

## Technical Notes

- Likely touched files:
  - `types.ts`
  - `lib/copper.ts`
  - `components/CopperShop.tsx`
  - `utils/excel.ts`
  - possibly `lib/appData.ts` if load-time auto-confirm belongs there.
- Existing storage is local-only; no background job exists, so "10-day auto-confirm" must be applied during app/data access.
