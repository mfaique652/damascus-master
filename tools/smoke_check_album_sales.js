const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(root).filter(f => f.endsWith('.html'));
let found = 0;
const results = [];
for (const f of files) {
  const p = path.join(root, f);
  let txt = '';
  try { txt = fs.readFileSync(p,'utf8'); } catch(e){ continue; }
  const hasPlace = txt.includes('window.__ALBUM_PLACEHOLDERS');
  if (!hasPlace) continue;
  found++;
  const res = { file: f, sale: null, hasUnit: txt.includes('id="unitPrice"') || txt.includes("id='unitPrice'"), hasTotal: txt.includes('id="totalPrice"') || txt.includes("id='totalPrice'") };
  // try to detect sale JSON presence the same way report_album_sales.js does
  // Look for a JSON object nearby the string "active":true
  const activeMatch = txt.match(/("active"\s*:\s*true|\bactive\s*:\s*true)/i);
  if (activeMatch) {
    // try to extract the nearest { ... } surrounding the match
    const idx = activeMatch.index;
    // search backwards for '{' and forwards for '}' naive boundaries
    const left = txt.lastIndexOf('{', idx);
    const right = txt.indexOf('}', idx);
    if (left !== -1 && right !== -1 && right > left) {
      const candidate = txt.slice(left, right + 1);
      try {
        // Try JSON.parse first; if that fails, try to fix single quotes
        let cleaned = candidate;
        // Replace single quotes with double where reasonable
        cleaned = cleaned.replace(/'(\s*:[^,}]+\s*)/g, function(m){ return m.replace(/'/g,'"'); });
        cleaned = cleaned.replace(/\b([a-zA-Z0-9_]+)\s*:/g, '"$1":');
        const obj = JSON.parse(cleaned);
        res.sale = obj;
      } catch(e) {
        res.sale = { parseError: e.message };
      }
    } else {
      res.sale = { parseError: 'unable to locate surrounding JSON braces' };
    }
  }
  // check inline sale script presence
  res.inlineScript = txt.includes('window.__ALBUM_PLACEHOLDERS.sale') || txt.includes('const sale =');
  results.push(res);
}

console.log('Checked', files.length, 'html files; found', found, 'album pages with placeholders.');
const active = results.filter(r => r.sale && r.sale.active);
console.log('Albums with active sale:', active.length);
for (const r of results) {
  console.log('\n- ' + r.file);
  console.log('  hasUnitPrice:', r.hasUnit, ' hasTotalPrice:', r.hasTotal, ' inlineScript:', r.inlineScript);
  if (r.sale && r.sale.parseError) console.log('  sale parse error:', r.sale.parseError);
  else if (r.sale) console.log('  sale:', JSON.stringify(r.sale));
}

process.exit(0);
