# Plan future expenses in life budget

## Goal

Design a sustainable way to record expenses paid now but belonging to a future date or future budget cycle, such as buying travel tickets for next cycle without making the current week's spending look inflated.

## What I already know

- The user wants simple budgeting, not detailed account-level bookkeeping.
- The app's priority is helping the user see spending clearly and save money without daily pressure.
- Current life budget has these money pockets: current spendable, buffer, reserve, and fixed-reserve.
- Current expense types are regular, dining, other, unplanned, large, fixed, and unrecorded.
- Current implementation records one transaction date and one allocation; weekly and cycle summaries use that date to decide where spending belongs.
- Current deletion correctness depends on `DailyTransaction.allocation` preserving the actual pocket deltas.

## Assumptions

- Future expenses should not inflate the current week's "已用" if the usage/benefit belongs to a later cycle.
- Actual money should still be deducted or reserved when the payment happens; otherwise pocket totals will stop matching reality.
- This should remain a pure frontend/localStorage feature.

## Requirements

### Future Expense

- Support recording an expense paid now but assigned to a future date or future cycle.
- Keep current-week spending pressure readable and not distorted by next-cycle travel tickets.
- Preserve rollback consistency when a future-expense record is deleted or edited.
- Future expenses deduct from `buffer` by default at payment time.
- If buffer is insufficient, future expenses deduct the remaining amount from `reserve`.
- Future expenses do not increase the current week's normal `已用`.
- In the target cycle, future expenses display as `提前支付` rather than as newly paid current-cycle spending.
- Future expense entry needs both a payment date and a target/effective date.
- The existing date picker should remain the payment date, because it already supports today or a past payment date.
- When future-expense mode is enabled, the target/effective date defaults to the selected payment date.
- Target/effective date may equal payment date, but must not be earlier than payment date.
- Home view should show only a small prepaid/future-expense hint when relevant.
- Cycle detail should show prepaid/future-expense line items.
- Charts and cycle summaries should include prepaid/future expenses in the target cycle total cost, with a separate "其中提前支付" amount.

### Additional Budget Corrections

- Balance calibration should target the user's current total non-reserve balance, not only the current consumable spending pool.
- Balance calibration should explicitly exclude existing reserve money.
- Balance calibration should include fixed-expense reserved money because it is still part of the user's current non-reserve total balance.
- Balance calibration UI label should remain `可消费余额`; helper copy should clarify that this means current balance excluding reserve money.
- Cycle detail should split `周期收入` into `主要收入 + 其余收入`.
- `主要收入` is the sum of main-income transactions in the cycle.
- `其余收入` is the sum of non-main income transactions in the cycle, such as casual income, refunds, and balance corrections.
- Fixed-expense reserved money is moved from current `spendable` money into `fixedReserved`; it does not create income and does not use reserve.
- Changing fixed-expense reserved money does not recalculate already generated weekly allowances.
- Fixed-expense payment deducts from `fixedReserved` first, then week spendable, then buffer, then advance.

## Technical Approach

Recommended starting model: "future expense" has two meanings:

- `paymentDate`: when money actually leaves.
- `effectiveDate` or `targetCycle`: which cycle's spending/report should show the expense.
- `allocation`: the actual buffer/reserve split deducted at payment time and restored on delete.

The expense should not count in the current week's normal spend chart if `effectiveDate` is in a future cycle. But the money impact must be visible immediately, either by deducting from a source pocket now or by moving money into a committed future-expense bucket.

Implementation direction:

- Extend transaction type metadata with a future/prepaid marker and `effectiveDate`.
- Keep `date` as payment date for existing transaction flows and backward compatibility.
- Update budget calculations so weekly "已用" uses payment/effective rules rather than blindly using `date` for every expense.
- Add target-cycle prepaid totals and line items for cycle detail and charts.
- Update balance calibration expected total so the prompt and correction logic use the same non-reserve balance.
- Update cycle detail summary to display main income and other income separately.
- Keep or add fixed-reserve helper copy explaining that fixed reserve moves money out of current spendable and does not recalculate weekly allowances.
- Update Excel full-state and row export/import to preserve the new metadata.

## Decision Log

Decision: future expenses should immediately deduct from buffer. This keeps current-week spend readable while still reducing currently available flexible money.

Decision: if buffer is insufficient, future expenses may use reserve for the remainder. This avoids negative pockets while still matching the fact that the money has already been paid.

Decision: future expenses appear in the target cycle as `提前支付`. They should help the user understand future-cycle cost, but should not imply the money will be paid again in that cycle.

Decision: future-expense mode should support an editable payment date. The existing date picker remains the payment date, so backfilled payments still work.

Decision: target/effective date defaults to the selected payment date. The app should not automatically assume the next cycle; the user explicitly changes the target date when the expense belongs later.

Decision: target/effective date may equal payment date. This keeps the form forgiving, even though equal dates are semantically close to a regular expense.

Decision: target/effective date must not be earlier than payment date. Earlier target dates are a different "late payment" concept and are out of scope for the MVP.

Decision: prepaid/future expenses should use a low-pressure display: a small home hint plus detailed list in cycle detail. They should not consume a dedicated primary home card.

Decision: charts and cycle summaries should include prepaid/future expenses in the target cycle total cost, with a separate "其中提前支付" amount so the user can see what has already been paid.

Decision: deletion must restore the original buffer/reserve split captured at record time. Rollback must not recalculate from the current pocket balances.

Decision: balance calibration target is total non-reserve balance: spendable plus buffer plus fixed-reserve, excluding reserve. The user-facing label remains `可消费余额`.

Decision: fixed-expense reserve remains a manual movement from spendable to fixed-reserved money. It changes actual available spendable money but does not rewrite the planned weekly allowance numbers for the current cycle.

## Acceptance Criteria

- [ ] Buying a next-cycle travel ticket does not increase this week's `已用`.
- [ ] The paid/committed amount reduces buffer first, then reserve if needed, so the app does not overstate available money.
- [ ] The target future cycle can show the expense under `提前支付`.
- [ ] The existing date picker still controls when the money is considered paid/deducted.
- [ ] Target/effective date defaults to payment date when future-expense mode is enabled.
- [ ] Target/effective date equal to payment date is accepted.
- [ ] Target/effective date earlier than payment date is rejected or corrected with a clear message.
- [ ] Home view shows a small prepaid/future-expense hint when relevant.
- [ ] Cycle detail shows prepaid/future-expense line items.
- [ ] Target cycle chart/summary includes prepaid/future expenses in total cost.
- [ ] Target cycle chart/summary separately labels how much of the cost was prepaid.
- [ ] Deleting a prepaid/future expense restores the same buffer/reserve allocation captured when it was recorded.
- [ ] Deleting the record reverses the same pocket movement that recording it made.
- [ ] Balance calibration asks for and compares against the current total balance excluding reserve.
- [ ] Balance calibration keeps the `可消费余额` wording while clarifying that reserve money should be excluded.
- [ ] Cycle detail displays income as `主要收入 + 其余收入`, for example `¥2,400 + ¥xx`.
- [ ] Fixed-reserve UI explains that reserving fixed expenses moves money from current spendable and does not recalculate generated weekly allowances.
- [ ] Old daily data still loads.

## Definition of Done

- PRD decisions confirmed.
- Type and data model changes documented.
- Build/type-check pass after implementation.
- Regression coverage for record/delete and current-week vs target-cycle summaries.

## Out of Scope (temporary)

- Account-level bank reconciliation.
- Multi-person travel budget splitting.
- Multi-goal savings.
- Late-payment/backfilled obligation flows where the target date is earlier than the payment date.

## Technical Notes

- Likely touched files: `types.ts`, `lib/daily.ts`, `components/DailyLedger.tsx`, `utils/excel.ts`.
- Existing rollback invariant: every money-changing transaction must store actual pocket deltas in `allocation`.
