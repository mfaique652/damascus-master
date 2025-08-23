#!/usr/bin/env node
// Report leftover '*.regen*.html' files in the workspace so you can inspect and clean them up.
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');

function walk(dir){
  let out = [];
  for (const name of fs.readdirSync(dir)){
    const full = path.join(dir, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) out = out.concat(walk(full));
    else if (/\.regen(\.html)?$/i.test(name)) out.push(path.relative(root, full));
  }
  return out;
}

const files = walk(root);
if (!files.length) {
  console.log('No .regen HTML files found.');
  process.exit(0);
}
console.log('Found .regen HTML files:');
for (const f of files) console.log(' -', f);
console.log('\nNext steps: inspect these files and remove or replace them with the canonical .html files.');
console.log('Example: move unwanted file to a backup folder:');
console.log('  mkdir backups\\regen-backup-<timestamp> ; move <file> backups\\regen-backup-<timestamp>');
