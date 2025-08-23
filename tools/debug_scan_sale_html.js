const fs = require('fs');
const path = require('path');

function walk(dir){
  const res = [];
  for(const name of fs.readdirSync(dir)){
    const p = path.join(dir,name);
    const stat = fs.statSync(p);
    if(stat.isDirectory()) res.push(...walk(p));
    else if(stat.isFile() && p.endsWith('.html')) res.push(p);
  }
  return res;
}

const root = path.resolve(__dirname,'..');
const files = walk(root);
let total=0, withPlaceholder=0, withSaleJson=0, withRibbon=0, withSalePrice=0, withOrigPrice=0;
const details = [];
for(const f of files){
  total++;
  let txt='';
  try{ txt = fs.readFileSync(f,'utf8'); } catch(e){ continue; }
  const hasPlaceholder = /window\.__ALBUM_PLACEHOLDERS/.test(txt) || /__ALBUM_PLACEHOLDERS/.test(txt);
  if(!hasPlaceholder) continue;
  withPlaceholder++;
  const saleJson = /"active"\s*:\s*true|\bactive\s*:\s*true/i.test(txt);
  const saleRibbon = /class\s*=\s*["']?[^>]*sale-?ribbon[^>"']*/i.test(txt) || /id\s*=\s*["']?saleRibbon["']?/i.test(txt);
  const salePrice = /class\s*=\s*["']?[^>]*sale-?price[^>"']*/i.test(txt) || /sale-?price/i.test(txt);
  const origPrice = /class\s*=\s*["']?[^>]*orig-?price[^>"']*/i.test(txt) || /orig-?price/i.test(txt);
  if(saleJson) withSaleJson++;
  if(saleRibbon) withRibbon++;
  if(salePrice) withSalePrice++;
  if(origPrice) withOrigPrice++;
  details.push({file: path.relative(root,f), saleJson, saleRibbon, salePrice, origPrice});
}

console.log('scanned html files:', total);
console.log('files with placeholders:', withPlaceholder);
console.log('files with saleJson:true:', withSaleJson);
console.log('files with saleRibbon:', withRibbon);
console.log('files with salePrice:', withSalePrice);
console.log('files with origPrice:', withOrigPrice);
console.log('\nDetails:');
for(const d of details) console.log(d.file, JSON.stringify({saleJson:d.saleJson, saleRibbon:d.saleRibbon, salePrice:d.salePrice, origPrice:d.origPrice}));

// Exit code non-zero if mismatch (DB indicates sales but none detected) is up to caller
