# 温润触控移动端改版

## Goal
Implement the user-approved warm tactile mobile design and four-screen preview, preserving every existing ledger operation.

## Requirements
- Source of truth: docs/mobile-ui-handoff/implementation-guide.md and preview.html. User approved implementation on 2026-10-14.
- Warm neutral surfaces, jade daily accent, copper business accent, raised controls and recessed tracks, light/dark themes using the existing persisted theme.
- Floating two-module navigation, budget hero, rapid expense entry, weekly chart, event list; business combined asset summary and sale/purchase sheets.
- Full-screen cycle/history/settings/monthly views; nested flow detail preserves underlying scroll.
- Shared accessible sheets, focus trapping/restoration, Escape/backdrop dismissal, dirty-input confirmation and viewport keyboard avoidance.
- Inline validation, Promise confirmation and completion feedback replace browser dialogs. Preserve conditions and rollback calls.
- Preserve JSON/Excel formats and localStorage keys, retain both modules' backup controls.
- All text at least 12px; touch targets at least 44px; reduced motion and chart summaries.

## Decisions
- No business or data layer changes. lib/, types.ts, utils/excel.ts and storage hooks are read-only.
- Prepaid explanation follows existing buffer/reserve funding rules; the guide's spendable-first sentence is incorrect.
- Expense preview uses recordExpense on an in-memory copy followed by getBudgetSnapshot, never mutating stored data.
- Existing initialization opens settings automatically. Existing old-data fallback remains valid.
- Retain transfer events in history; omit transfer delete in the detail view per guide.
- No new runtime dependencies or downloaded fonts.

## Acceptance Criteria
- [x] All existing operations remain reachable and use unchanged business functions.
- [x] Light/dark themes and both accents match the approved direction.
- [x] 360/390/430px and shortened keyboard-like viewport have no horizontal overflow.
- [x] Sheets/confirmation support keyboard focus and dirty-close protection.
- [x] Financial display and legacy details preserve audit semantics.
- [x] Typecheck, build, UI regression checks and contrast report pass.
- [x] git diff --stat -- lib/ is empty.

## Out of Scope
Authentication, cloud sync, investment features, storage migration, algorithm changes, native packaging.

## Verification Limits
Automated Chromium viewport coverage cannot prove physical mobile keyboards, Android font fallback, real backup files or large-history performance.
