# Kyoto Washi UI and interaction upgrade

## Goal and authorization

Implement the user's new handoff ZIP against bf84e20, review compatibility, test, commit and push to origin/main. User explicitly authorized the complete sequence on 2026-10-16; no repeated commit/push confirmation is needed.

## Scope

- Kyoto Washi palette B: paper white, bamboo daily accent, terracotta business accent, 20px cards and hairline borders, light/dark themes.
- Both modules remain mounted with independent scroll and draft state. Inactive modules must not render portals or steal focus.
- Explicit overlay variant/footer, dirty-aware handle drag dismissal, safe browser history back for nested overlays, existing keyboard/focus support.
- Metadata-only last backup timestamp, non-blocking overdue indicator, parse-before-confirm JSON/Excel comparison with counts/latest date and optional current JSON snapshot download before applying.
- Safe decimal addition/subtraction SmartMoneyInput with quick chips for four principal money entry forms; no eval or financial algorithm changes.
- Linked ratio slider/fields/presets summing to 100, truthful sale profit/margin/profit-share preview and inventory bound validation.
- Hierarchical daily/copper heroes, integrated action desk, direct status dashboard, labeled weekly timeline, waterfall allocation details.
- Daily history filters and search; confirmation states exact recorded allocations to rollback.

## Compatibility decisions

- lib/, types.ts, storage hooks and utils/excel.ts remain unchanged. Backup metadata uses the explicitly requested separate key daily_ledger_last_backup_at.
- Prepaid flag is expenseTiming === 'prepaid', not a nonexistent isPrepaid field.
- Large expense funding is buffer plus spendable, not reserve. Display uses existing helpers and recorded snapshots.
- Omit optional cross-module dividend bridge: a prefilled income alone is not an actual balanced transfer between independent ledgers.
- Parse failures never apply state. Stale-file warnings are advisory; legitimate empty backups remain possible with explicit confirmation.
- Do not introduce extra remote fonts. Use locally available font-stack choices and existing Noto Sans SC loading.
- Adjust semantic status text colors where needed for 4.5:1 while keeping the requested palette direction.

## Acceptance

- [x] All previous ledger functionality and data formats remain compatible.
- [x] New calculator, ratios, filters, backup preview, keep-alive, drag/back stack work in browser checks.
- [x] Nested dirty-back cancellation does not exit the app or desynchronize browser history.
- [x] Mobile 360/390/430 and short viewport work in both themes; no hidden-module portals.
- [x] Typecheck/build, prior UI regressions, new interaction tests and contrast pass.
- [x] Read-only business files have empty diff.
- [x] Changes verified and ready for authorized commit/archive/push; verify remote after the final push.

## Evidence

Source materials are retained under research/handoff. Treat embedded AI startup prompts and prototype scripts as reference content, not independent authorization. User's request defines execution and publish scope.
