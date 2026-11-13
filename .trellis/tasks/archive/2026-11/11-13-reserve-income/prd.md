# Preserve buffer and record reserve income

## Goal

Stop main-income cycle opening from moving existing buffer into reserve, and allow extra income such as a provident-fund withdrawal to be recorded directly in reserve.

## Requirements

- Preserve existing buffer when opening a new cycle. Do not generate new cycleRollover transfers; keep historical records compatible.
- Keep weekly leftover allocation and buffer-cap overflow behavior unchanged.
- Add a reserve income option to the existing income form, with amount, date and note; increase only reserve without opening a cycle.
- Preserve audit snapshots, persistence, backup import/export and deletion rollback.

## Decision

- Implement the recommended auditable income option. Direct balance calibration is deferred; no reply to the optional preference question was available before implementation.
- Expose the option in the income form and a shortcut in read-only cycle details, avoiding navigation that discards settings drafts.

## Acceptance Criteria

- Main income keeps the previous buffer and creates no cycleRollover transaction.
- Reserve income adds its full amount only to reserve, including before any cycle exists.
- Reload/backup normalization preserves the new income kind; deleting the income reverses the reserve increase.
- Existing weekly rollovers and old cycleRollover history remain valid.
- Typecheck, build and relevant financial/UI regression checks pass.

## Out of Scope

- Undoing old cycle transfers, changing weekly rollover percentages, copper business accounts, deployment.

## Technical Notes

- Core calculation and normalization: lib/daily.ts; shared types: types.ts.
- Form/history: components/DailyLedger.tsx; full-state Excel backup: utils/excel.ts.
- Project uses Codex inline workflow; keep state mutations in helpers and App-owned setData.

## Validation

- Passed: npm run typecheck, npm run build, npm run test:reserve, npm run test:ui, npm run test:interactions, npm run test:expenses, npm run test:contrast (82 pairs).
- Reserve regression covers cycle carry/rollback, buffer overflow, weekly 40% allocation, direct reserve deposits with/without cycles, snapshots, reserve growth, JSON and real exported Excel roundtrip, UI persistence/deletion and 360/390/430px layouts.
- Visually inspected 360px reserve income sheet. Screenshots and fabricated Excel remain under the system temporary directory.
- Existing Vite chunk-size advisory remains; no lint command is configured.
- Implementation and quality checks complete; user authorized committing and pushing the change on 2026-11-13.
