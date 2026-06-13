# Audit life budget data calculations and rollback

## Purpose

Review and fix the `生活预算` ledger data model so displayed balances, mutation behavior, deletion rollback, backup/restore, and sanitize repair use consistent accounting rules.

## Scope

- Map every major displayed value on `components/DailyLedger.tsx` to its source fields and calculation in `lib/daily.ts`.
- Explain and fix how each user action mutates state:
  - initialize budget
  - income allocation
  - regular expense
  - large expense
  - balance calibration
  - fixed expense reservation and payment
  - transaction deletion
  - import/export and local storage sanitize
- Fix deletion rollback for all modern transaction kinds.
- Fix derived values and stored fields that can drift.
- Fix import/export paths so "完整备份" preserves life-budget metadata.
- Add regression coverage through deterministic function-level audit scripts.

## Accounting Rules

- Every transaction that changes pockets must store the actual pocket deltas needed to reverse it.
- Deleting a transaction must not create or destroy money relative to the original mutation.
- Cycle-level summaries must use the same money semantics as weekly summaries.
- Manual movement between current-week spendable and fixed reserve must preserve the total.
- Full daily Excel backup must preserve enough metadata to restore rollback behavior.
- Sanitizer repair may correct confidently derivable fields, but must not drop valid cycles solely because old transaction metadata is incomplete.

## Deliverable

- Code changes addressing all high/medium audit findings.
- Updated audit report under `research/`.
- User-facing summary with fixes, verification, and any residual non-risk limitations.
