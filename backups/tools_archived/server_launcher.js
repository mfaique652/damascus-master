const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Launcher for server that starts a child node process and pipes its stdout/stderr
try {
  const repoRoot = path.resolve(__dirname, '..');
  const outPath = path.join(repoRoot, 'server-local.log');
  const errPath = path.join(repoRoot, 'server.err.log');

  const out = fs.createWriteStream(outPath, { flags: 'a' });
  const err = fs.createWriteStream(errPath, { flags: 'a' });

  // If a port was provided on argv[2], prefer it
  const chosenPort = process.argv[2] || process.env.PORT || '';

  const serverPath = path.join(repoRoot, 'server', 'server.js');
  const nodeExec = process.execPath || 'node';

  const env = Object.assign({}, process.env);
  if (chosenPort) env.PORT = String(chosenPort);

  // Spawn node child with --input-type=module so ESM imports in server/server.js parse correctly.
  const child = spawn(nodeExec, ['--input-type=module', serverPath], { env, cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] });

  child.stdout.on('data', (chunk) => {
    try { out.write(chunk); } catch (e) {}
    try { process.stdout.write(chunk); } catch (e) {}
  });
  child.stderr.on('data', (chunk) => {
    try { err.write(chunk); } catch (e) {}
    try { process.stderr.write(chunk); } catch (e) {}
  });

  child.on('close', (code, signal) => {
    try { out.write('\n[child exited] code=' + code + ' signal=' + signal + '\n'); } catch (e) {}
    try { err.write('\n[child exited] code=' + code + ' signal=' + signal + '\n'); } catch (e) {}
    process.exit(code || (signal ? 1 : 0));
  });

  child.on('error', (e) => {
    try { err.write('Child spawn error: ' + (e && (e.stack || e)) + '\n'); } catch (x) {}
    try { console.error('Server launcher child spawn error:', e && (e.stack || e)); } catch (x) {}
    process.exit(1);
  });

  // Ensure streams flush on exit
  process.on('exit', () => { try { out.end(); err.end(); } catch (e) {} });

} catch (e) {
  console.error('Server launcher failed:', e && (e.stack || e));
  process.exit(1);
}
