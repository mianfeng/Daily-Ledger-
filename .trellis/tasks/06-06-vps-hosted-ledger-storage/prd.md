# brainstorm: VPS hosted ledger storage

## Goal

Move Daily Ledger data from browser-local storage on a phone to a VPS-backed storage model, so the same ledger can be used from phone and desktop through one deployed web app.

## What I Already Know

- The app is currently a Vite React frontend with no backend service.
- Persistent data is stored in browser `localStorage`.
- The two current storage keys are `coinShopData_v5` and `dailyBookData_v5`.
- App-level backup already exports and imports one JSON object containing both `copper` and `daily` data.
- The current data model is small JSON: `CopperData` and `DailyData`.
- The user has a VPS and wants storage on that VPS because phone-only local data is inconvenient.
- The first version is for the user alone, not a multi-user product.

## Assumptions

- The initial user count is one person.
- SQLite on the VPS is likely enough for current ledger volume.
- Existing backup import/export should remain available as a migration and recovery path.
- The first implementation should prefer reliability and simple maintenance over complex realtime sync.
- Authentication will use one administrator account with password login.
- The backend will store only a password hash, not the raw password.
- Authenticated browser sessions will use an httpOnly session cookie.
- Cross-device conflict handling will use optimistic concurrency via a server-side `revision`.
- Saves must include the revision loaded by the client; if the server revision changed, the save is rejected and the user must refresh/reload before saving again.
- Ledger edits will auto-save to the VPS using a short debounce.
- The UI will show save status: saving, saved, failed, and conflict.
- Save failures must not silently discard the user's current in-browser edits.
- Migration from phone-local storage will be explicit: when the server is empty and the browser has old `localStorage` data, the app prompts the user before importing local data to the server.
- After a successful migration, server data becomes the source of truth.
- The VPS storage layer will support automatic daily JSON backups.
- Automatic backups will keep the most recent 30 days.
- Manual export from the frontend will remain available.
- The user has a domain name available for the VPS deployment.
- Deployment can target HTTPS via Caddy with the user's domain.
- The first version requires network access for editing; full offline editing and later sync are out of scope.
- If a save fails because the network is unavailable, the current in-browser edits remain visible and the UI shows the failure.

## Open Questions

- None. Planning decisions are locked for the first implementation pass.

## Requirements

- Add VPS-backed persistent storage for both Daily Ledger and Copper Shop data.
- Support a single private user account; multi-user account management is not required.
- Keep a way to import the existing local JSON backup into the VPS-backed store.
- Keep a way to export all server data as a JSON backup.
- Protect data with authentication before allowing reads or writes.
- Require login before any ledger data can be read or written.
- Store the admin password as a server-side password hash.
- Use httpOnly session cookies for logged-in browser sessions.
- Preserve the existing data shape where practical to reduce migration risk.
- Surface save/load failures in the UI so edits are not silently lost.
- Track a server-side `revision` for the combined ledger data.
- Reject stale saves when the client revision does not match the server revision.
- Show a clear conflict message when another device has updated the data.
- Auto-save changes after a short debounce instead of requiring a manual save button.
- Show visible save status in the app shell.
- Preserve unsaved in-browser edits when a save fails.
- Detect existing local `localStorage` ledger data during first authenticated load.
- If the server has no ledger data yet, prompt the user to import local data to the server.
- Never overwrite non-empty server data with local data automatically.
- Store SQLite data in a persistent `data/ledger.sqlite` path on the VPS.
- Export a daily JSON backup into a persistent `backups/` directory.
- Retain the most recent 30 daily backups.
- Keep the existing frontend manual export flow, adapted to server data.
- Provide Docker Compose deployment files.
- Provide Caddy HTTPS reverse proxy configuration using a configurable domain.
- Require network access for edits in the first version.
- Do not implement a full offline edit queue or offline conflict merge.

## Acceptance Criteria

- [ ] The app can load ledger data from a server endpoint instead of only `localStorage`.
- [ ] The app can save changed ledger data to VPS-backed storage.
- [ ] Existing local backup JSON can be imported into the new storage.
- [ ] Server data can be exported back to JSON.
- [ ] Unauthenticated requests cannot read or write ledger data.
- [ ] Login works with the configured single admin account.
- [ ] Session cookies are httpOnly.
- [ ] Saves include the current revision.
- [ ] Stale saves are rejected instead of overwriting newer server data.
- [ ] The UI tells the user to reload when a save conflict occurs.
- [ ] Edits auto-save to the server after a short debounce.
- [ ] Save status is visible to the user.
- [ ] Failed saves do not clear the current in-browser edits.
- [ ] If server data is empty and local data exists, the UI prompts before migration.
- [ ] Local data is not automatically uploaded over non-empty server data.
- [ ] Successful migration writes both `copper` and `daily` data to the server.
- [ ] Daily JSON backups can be generated from server data.
- [ ] Backup retention keeps the latest 30 daily backups.
- [ ] The user can manually export server data from the frontend.
- [ ] Deployment docs explain domain DNS, HTTPS, data volume, backup volume, and required environment variables.
- [ ] Network save failures are visible and keep current in-browser edits intact until the user resolves them.
- [ ] Build/type-check passes.

## Definition Of Done

- Tests added or updated where the touched code supports them.
- Lint/type-check/build are green.
- Migration and rollback path are documented.
- Deployment notes for VPS are included.

## Out Of Scope

- Realtime multi-device collaborative editing unless explicitly chosen.
- Automatic merge of conflicting edits.
- Full offline editing and later synchronization.
- File/image attachment storage.
- Public SaaS-style user registration.
- Multi-user account management.
- Complex analytics or reporting changes unrelated to storage.

## Technical Notes

- Relevant files inspected:
  - `App.tsx`
  - `hooks/useLocalStorageState.ts`
  - `types.ts`
  - `.trellis/spec/frontend/index.md`
- Current export/import implementation in `App.tsx` can be reused as the migration payload shape.
- A conservative architecture is: React frontend + small Node API + SQLite file on VPS + HTTPS reverse proxy.
