Local dev server and smoke tests

This repository includes a small PowerShell wrapper and several lightweight smoke tests so you can run and verify locally without heavy dependencies.

Quick start (Windows PowerShell)

1. Start the local server (wrapper will pick a free port starting at 3026):

   powershell.exe -ExecutionPolicy Bypass -File .\run_local_server.ps1 -Port 3026 -Watch

   - The wrapper will try the requested port and increment until it finds a free one.
   - It will launch Node (or nodemon if `-Watch` requested and nodemon is installed).
   - Logs are captured to `server-local.log` (stdout) and `server.err.log` (stderr) in the repo root.

2. Check server health:

   Invoke-WebRequest -Uri "http://localhost:3026/api/health" -UseBasicParsing

   Replace `3026` with the port the wrapper reported if different.

Generator / verification / sales report

- Regenerate album pages:
  node generate_albums.js

- Check generated HTML for malformed tokens:
  node tools/check_generated_html.js

- Report which generated album pages contain (`sale.active=true`):
  node tools/report_album_sales.js

Lightweight UI smoke tests (portable)

- Portable (no extra deps):
  node tools/ui_smoke_fallback.js

  This will try Puppeteer if present and otherwise fall back to a pure-HTTP DOM check. Use this in CI or when you do not want to install Chromium.

- Full headless browser (recommended for final sign-off):
  1) Install Puppeteer as a dev dependency (this downloads Chromium):
     npm install --save-dev puppeteer
  2) Run the headless UI smoke test:
     node tools/ui_smoke_puppeteer.js

  The fallback script above will also run the DOM check if Puppeteer is not installed.

Site-wide smoke-check

- Run the repository's site smoke-check (fast, inspects HTML files):
  node tools/smoke_check_album_sales.js

Notes about dependencies & hosting

- Adding heavy dev dependencies (like Puppeteer) affects CI and host builds because Chromium is downloaded. To avoid platform issues:
  - Keep `tools/ui_smoke_fallback.js` in CI so the DOM-only check runs if Puppeteer isn't installed.
  - Make Puppeteer installation opt-in in CI (e.g., install only on the test job/step that needs screenshots).
  - For minimal Docker images, set `PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=1` and rely on a system Chrome provided by the image.

- The repository now includes `tools/server_launcher.js` and an updated `run_local_server.ps1` wrapper that:
  - Finds a free port starting from the requested port.
  - Starts the server via the launcher which pipes stdout/stderr into `server-local.log` / `server.err.log`.
  - Uses a detached Start-Process so the wrapper exits while server keeps running.

If you want, I can:
- Add a small CI job YAML for your runner (GitHub Actions / Azure Pipelines) that runs the portable smoke checks.
- Add a small `npm` script wrapper for the smoke checks.
- Revert Puppeteer install if you prefer not to track the devDependency here.

That's the practical, low-risk set of actions I recommend to finalize today. Let me know which follow-up you want and I'll apply it.
