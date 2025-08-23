#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const ts = new Date().toISOString().replace(/[:.]/g,'-');
const outDir = path.join(root, 'backups', 'regen-backup-' + ts);
fs.mkdirSync(outDir, { recursive: true });

function walkAndMove(dir){
  for (const name of fs.readdirSync(dir)){
    const full = path.join(dir, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) { walkAndMove(full); continue; }
    if (/\.regen(\.html)?$/i.test(name)) {
      const rel = path.relative(root, full);
      const dest = path.join(outDir, rel.replace(/[\\/]+/g,'_'));
      try { fs.renameSync(full, dest); console.log('Moved', rel, '->', path.relative(root, dest)); } catch (e) { console.warn('Failed to move', rel, e && e.message ? e.message : e); }
    }
  }
}

walkAndMove(root);
console.log('Cleanup complete. Backup folder:', path.relative(root, outDir));
