Cleanup summary — centralized theme and sale ribbon

What I changed
- Centralized `.sale-ribbon` CSS into `css/theme.css` and removed duplicate inline `.sale-ribbon` blocks from templates and generated album files.
- Restored `kitchen_hunter.html` placeholders from a regen backup and fixed JS quoting issues.
- Created and ran scan/repair utilities to detect and remove inline `:root` and duplicate `<style>` blocks where safe. Backups (.bak and backups/*) were preserved.
- Simplified sale markup in `site.js` to rely on the centralized CSS class.

Verification
- Ran the smoke-check tool `tools/smoke_check_album_sales.cjs` — output: 5 album pages with placeholders; 2 with active sale. `kitchen_hunter.html` now reports `inlineScript: true`.
- Ran the CommonJS generator `generate_albums.cjs`; it generated several album pages (see git diff for details).

Backups & Recovery
- All edited HTML files have `.bak` or `.regen.html.bak` backups in the repo; stale duplicates moved to `backups/stale_album_duplicates/`.

Next steps (optional)
- Restore missing DB product entries into `server/data/db.json` and re-run generator to canonicalize restored pages.
- Start a clean local server for visual QA: run `.
un_local_server.ps1 -Port 3026 -Watch` from the repo root (PowerShell).

If you want me to proceed with DB restore or start the local server, tell me and I'll continue.
