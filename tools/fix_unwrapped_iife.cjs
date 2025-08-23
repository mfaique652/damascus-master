#!/usr/bin/env node
// Scans .html files (excluding backups/.git/node_modules) for top-level IIFE occurrences
// and wraps them in <script>...</script>. Creates backups under backups/auto-iife-fix/<ts>/

const fs = require('fs');
const path = require('path');
const glob = require('glob');

const root = path.resolve(__dirname, '..');
const ts = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = path.join(root, 'backups', 'auto-iife-fix', ts);
fs.mkdirSync(backupDir, { recursive: true });

const files = glob.sync('**/*.html', { cwd: root, nodir: true, absolute: true });
const skipPatterns = [/\\backups\\/, /\/backups\//, /\\node_modules\\/, /\/node_modules\//, /\\.git\\/, /\/\.git\//];

function shouldSkip(p) {
  for (const r of skipPatterns) if (r.test(p)) return true;
  // skip template file because it legitimately contains IIFEs
  if (p.endsWith('album_template.html')) return true;
  return false;
}

const iifeRegex = /\(function\(\)\s*\{/g;
let patched = [];

for (const f of files) {
  if (shouldSkip(f)) continue;
  let src = fs.readFileSync(f, 'utf8');
  let m;
  let offset = 0;
  let changed = false;
  let newSrc = src;

  while ((m = iifeRegex.exec(src)) !== null) {
    const idx = m.index;
    // Determine if inside <script> ... </script>
    const before = src.lastIndexOf('<script', idx);
    const beforeClose = src.lastIndexOf('</script>', idx);
    if (before > beforeClose) {
      // inside script tag - skip
      continue;
    }
    // find end of IIFE - search for '})();' after idx
    const lookahead = src.slice(idx);
    const endMatch = lookahead.match(/\}\)\s*\(\)\s*;?/);
    if (!endMatch) continue; // can't find end - skip
    const endRel = lookahead.indexOf(endMatch[0]) + endMatch[0].length;
    const absEnd = idx + endRel;
    // Make sure we're not wrapping something already within a script tag later
    const afterOpen = src.indexOf('<script', idx);
    if (afterOpen !== -1 && afterOpen < absEnd) {
      // there's a <script> start inside the IIFE span - skip to be safe
      continue;
    }
    // Extract the exact snippet
    const snippet = src.slice(idx, absEnd);
    // If snippet already contains '<script' or '</script>' skip
    if (snippet.includes('<script') || snippet.includes('</script>')) continue;

    // Prepare to replace in newSrc: but compute positions in newSrc when prior replacements exist
    const pre = newSrc.slice(0, idx + offset);
    const post = newSrc.slice(idx + offset);
    const insert = `<script>\n${snippet}\n</script>`;
    newSrc = pre + insert + post.slice(snippet.length);

    // update offset: we added script tag wrappers length
    offset += insert.length - snippet.length;
    changed = true;
  }

  if (changed && newSrc !== src) {
    // backup original
    const rel = path.relative(root, f);
    const backupPath = path.join(backupDir, rel);
    const backupDirForFile = path.dirname(backupPath);
    fs.mkdirSync(backupDirForFile, { recursive: true });
    fs.writeFileSync(backupPath, src, 'utf8');
    fs.writeFileSync(f, newSrc, 'utf8');
    patched.push(f);
    console.log('Patched:', f);
  }
}

console.log('Done. Patched files count:', patched.length);
if (patched.length) console.log('Backups saved at:', backupDir);
process.exit(0);
