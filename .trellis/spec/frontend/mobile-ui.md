# Warm Tactile Mobile UI Contracts

## 1. Scope / Trigger

Read before editing mobile screens, portals, confirmations, themes, or financial detail presentation. The approved visual direction is documented in `docs/mobile-ui-handoff/implementation-guide.md`.

## 2. Signatures

- `UiProvider({ theme, business, children })` inherits the existing app theme and active module.
- `useUi().confirm(string | { title?, body, danger?, confirmLabel? }): Promise<boolean>` replaces native confirmation dialogs.
- `useUi().notify(message: string)` provides completion feedback.
- `Overlay({ title, variant?, onClose, footer?, protectEdits?, error?, onClearError?, saved?, children })` supports `sheet`, `page`, and `confirm` presentations.
- `BackupSection({ moduleName, appControls, onExport, onImport })` keeps whole-site JSON and module Excel actions distinct.

## 3. Contracts

- `App.tsx` continues to own both ledger slices and persisted theme. UI contexts must not own ledger data or introduce storage keys.
- Financial mutations continue through existing helpers in `lib/`; UI work must not silently alter those algorithms or backup formats.
- All portal surfaces carry `warm-ui`, the existing theme, and current module accent. Portals cannot rely on inheriting CSS variables from the app DOM tree.
- Main navigation always exposes both independent modules. Full-screen details temporarily overlay it, with a back action returning to the same root/history context.
- Overlays use a scrollable body and a separate non-scrolling action footer sized to `visualViewport`. Root content is inert while an overlay is active.
- Only the topmost overlay processes Escape and trapped Tab focus. Closing restores the previous focus target. Reference counting prevents a nested confirmation from unlocking the underlying root prematurely.
- Edited forms require a discard confirmation. File uploads are actions, not unsaved drafts. A successful save clears the draft flag. Read-only details do not prompt to discard.
- Inputs in settings, including reserve minimum override, are drafts until saved.
- Use semantic CSS tokens, not old palette literals. Numeric amounts use tabular numerals; auxiliary text is at least 12px. Touch controls are at least 44px high.
- Recorded `allocation` and immutable snapshots are the only source for historical funding details. Missing allocation omits sources. Missing either snapshot omits all arithmetic bars and shows the old-record explanation.
- Large/prepaid `allocation.advance` deducts the full `spendable` pocket, so display it as cycle daily money and use saved `snapshot.spendable`; it is not always `futureSpendable`.
- If a saved pair does not reconcile with an individual allocation, label the after value as recorded rather than displaying a false equals sign. Never rewrite snapshots to make an equation work.
- `getBudgetSnapshot().weekRemaining` clamps to zero. Overspending presentation derives the overage from existing `weekSpent` and allowance; it does not change the stored amount or algorithm.
- Native `alert`/`confirm` calls must not be reintroduced. Errors render within the active form and completion uses the shared toast.

## 4. Validation / Error Matrix

| Scenario | UI behavior |
| --- | --- |
| Invalid amount/date/category-dependent condition | Inline error; unchanged existing financial condition |
| Dirty close / Escape / backdrop | Discard confirmation; cancel preserves active input |
| Nested flow detail | Close restores history and its scroll position |
| Invalid JSON | Inline failure; existing current state retained |
| Pending sale confirm | Explain cash/inventory are already booked; only status changes |
| Pending sale cancel | Explain rollback and retained cancelled record |
| Locked legacy sale | No deletion button |
| Missing audit snapshots | Show allocation only; never reconstruct history |

## 5. Good / Base / Bad Cases

- Good: expense preview calls `recordExpense` on an in-memory value and reads its snapshot without persisting it.
- Base: a new user opens initial settings; dismissing it leaves an actionable no-cycle state.
- Bad: adding a parallel theme store for a portal, or inferring old balances from current pockets.
- Good: dark business dialogs inherit copper tokens even though mounted in `document.body`.
- Bad: treating an Excel import or theme toggle as an unsaved financial form.

## 6. Checks Required

- `npm run typecheck`, `npm run build`, `npm run test:contrast`.
- `npm run test:ui` against the Vite dev server, with Playwright installed or `PLAYWRIGHT_MODULE` configured; optionally set `BROWSER_EXECUTABLE`.
- Browser regression assertions cover actual persisted state after async file imports, not merely the presence of an old success toast.
- Copper Excel currently regenerates transaction IDs because the existing export omits them. Assert financial/confirmation metadata rather than exact regenerated IDs; changing this format is a separate task.
- Keep screenshots and fixtures fabricated, isolated from the user's browser.
- Validate 360/390/430px and a shortened keyboard-like viewport. Physical keyboard behavior still requires device testing.

## 7. Wrong / Correct

```tsx
// Wrong: blocks the browser and breaks the shared confirmation/focus flow.
if (!window.confirm('Delete?')) return;

// Correct: business mutations run only after the shared confirmation resolves.
if (!(await confirm({ body: 'Delete and rollback?', danger: true }))) return;
setData(prev => deleteDailyTransaction(prev, id));
```

```ts
// Wrong for large/prepaid expenses: advance may consume current-week money too.
const before = transaction.balanceBefore?.futureSpendable;

// Correct: use the saved balance corresponding to the actual mutated pocket.
const before = transaction.balanceBefore?.spendable;
```
