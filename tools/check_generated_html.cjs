#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function walk(dir) {
  const res = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for (const d of list) {
    const name = d.name;
    if (name === 'node_modules' || name === 'backups' || name === '.git') continue;
    const full = path.join(dir, name);
    if (d.isDirectory()) res.push(...walk(full));
    else if (d.isFile() && full.toLowerCase().endsWith('.html')) res.push(full);
  }
  return res;
}

function excerpt(s, idx, len=80){
  const start = Math.max(0, idx - len/2 | 0);
  const end = Math.min(s.length, start + len);
  return s.slice(start, end).replace(/\n/g,'⏎');
}

function checkFile(fp){
  const txt = fs.readFileSync(fp,'utf8');
  const problems = [];
  // Find wishlist-heart tags with data-wishlist-sale attribute
  const attrRegex = /<div\s+class=(['"])wishlist-heart\1[^>]*?data-wishlist-sale=(["'])([\s\S]*?)\2/ig;
  let m;
  while((m = attrRegex.exec(txt))){
    const raw = m[3] || '';
    // detect obvious malformed concatenations
    if (/}'\s*active|}\'active|\}active"|\}\"active/.test(raw) || /\}'active/.test(raw)){
      problems.push({type:'malformed-concat', sample: raw.slice(0,200), idx: m.index});
      continue;
    }
    // if value is 'null' it's OK
    if (String(raw).trim() === 'null' || String(raw).trim() === '') continue;
    try {
      JSON.parse(raw);
    } catch(e){
      problems.push({type:'invalid-json', sample: raw.slice(0,200), idx: m.index});
    }
  }

  // Also search for the specific concatenation artifact elsewhere
  const concatRegex = /\}'active"?:/i;
  if (concatRegex.test(txt)) problems.push({type:'concat-artifact', sample: excerpt(txt, txt.search(concatRegex)), idx: txt.search(concatRegex)});

  return problems;
}

const files = walk(process.cwd());
const report = [];
for (const f of files){
  const probs = checkFile(f);
  if (probs && probs.length) report.push({file:f, problems:probs});
}

if (report.length === 0){
  console.log('OK: No issues found in generated HTML files.');
  process.exit(0);
} else {
  console.error('Found issues in generated HTML:');
  for (const r of report){
    console.error('\n-- ' + r.file);
    for (const p of r.problems){
      console.error(' *', p.type, '-', (p.sample||'').slice(0,240));
    }
  }
  process.exit(2);
}
