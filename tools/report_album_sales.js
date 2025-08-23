#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

function walk(dir){
  const out = [];
  const list = fs.readdirSync(dir, { withFileTypes: true });
  for(const d of list){
    if(d.name === 'node_modules' || d.name === 'backups' || d.name === '.git' || d.name === 'tools') continue;
    const full = path.join(dir, d.name);
    if(d.isDirectory()) out.push(...walk(full));
    else if(d.isFile() && full.toLowerCase().endsWith('.html')) out.push(full);
  }
  return out;
}

function findSaleJson(txt){
  // match JSON.parse('...') inside sale placeholder
  const re = /sale:\s*\(function\(\)\{[\s\S]*?return\s+JSON\.parse\('([\s\S]*?)'\)\;/i;
  const m = re.exec(txt);
  if(!m) return {found:false};
  const raw = m[1];
  if(raw === 'null') return {found:true, raw:'null', parsed:null};
  // html-escaped quotes might appear (e.g., &quot;) — unescape common entities
  const unescaped = raw.replace(/&quot;/g, '"').replace(/&amp;/g,'&');
  try{
    const parsed = JSON.parse(unescaped);
    return {found:true, raw:unescaped, parsed};
  }catch(e){
    try{ const parsed2 = JSON.parse(raw); return {found:true, raw, parsed:parsed2}; }catch(_){ return {found:true, raw, parsed:null, error:'invalid-json'}; }
  }
}

const files = walk(process.cwd());
const report = [];
for(const f of files){
  try{
    const txt = fs.readFileSync(f,'utf8');
    const sale = findSaleJson(txt);
    if(sale.found){
      report.push({file:f, sale});
    }
  }catch(e){ }
}

if(report.length===0){
  console.log('No album placeholder sale entries found in generated HTML files.');
  process.exit(0);
}

for(const r of report){
  if(r.sale.parsed === null){
    console.log('NO-SALE:', r.file);
  } else if(r.sale.error){
    console.log('BAD-SALE JSON:', r.file, '-', r.sale.raw.slice(0,200));
  } else {
    console.log('HAS-SALE:', r.file, '-', JSON.stringify(r.sale.parsed));
  }
}
