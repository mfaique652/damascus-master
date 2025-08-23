Local server: start and debug
=================================

This project includes a small PowerShell helper `run_local_server.ps1` that finds a free port, rotates logs, and launches the Node server detached.

Quick start (PowerShell)

1. Open PowerShell at the repository root.
2. Run the helper (example):

   powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\run_local_server.ps1 -Port 3026 -Watch

- `-Watch` prefers `nodemon` if available. The helper sets `PORT` and starts the server detached, writing stdout to `server-local.log` and stderr to `server.err.log`.
- Old logs are archived under `backups/logs` with timestamped filenames.

VS Code

Use the provided VS Code task (in `.vscode/tasks.json`) labelled "Start Local Server" to run the helper from within VS Code.

Notes

- We intentionally run Node directly against `server/server.js` and use `package.json` with `"type":"module"` so ESM imports work without `--input-type` flags.
- If logs indicate the port is in use, stop the existing node process or pick a different port.
