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

function backupFile(fp){
  const bak = fp + '.bak';
  if (!fs.existsSync(bak)) fs.copyFileSync(fp, bak);
}

function fixFile(fp){
  let txt = fs.readFileSync(fp,'utf8');
  let changed = false;

  // remove data-wishlist-sale attributes (conservative)
  const before = txt;
  // Remove data-wishlist-sale='...' or data-wishlist-sale="..." (simple, conservative)
  txt = txt.replace(/\sdata-wishlist-sale=(?:"[\s\S]*?"|'[\s\S]*?')/ig, '');
  if (txt !== before) changed = true;

  // replace token occurrences of {{SALE_JSON}} with null
  if (txt.indexOf('{{SALE_JSON}}') !== -1){
    txt = txt.split('{{SALE_JSON}}').join('null');
    changed = true;
  }

  if (changed){
    backupFile(fp);
    fs.writeFileSync(fp, txt, 'utf8');
  }
  return changed;
}

const files = walk(process.cwd());
let fixed = 0;
for (const f of files){
  try{
    if (fixFile(f)){
      console.log('Fixed:', f);
      fixed++;
    }
  }catch(e){
    console.error('Error processing', f, e.message);
  }
}

console.log('Done. Files fixed:', fixed);
