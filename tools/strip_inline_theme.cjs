const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const targets = fs.readdirSync(root).filter(f => f.endsWith('.html'));
let modified = [];
for (const f of targets) {
  const p = path.join(root, f);
  let txt = '';
  try { txt = fs.readFileSync(p, 'utf8'); } catch(e){ continue; }
  const original = txt;
  // Remove any :root { ... } blocks inside <style> tags conservatively
  // This regex finds :root { ... } including balanced braces naive (no nested braces expected)
  const newTxt = txt.replace(/:root\s*\{[\s\S]*?\}/gi, function(m){
    // keep a single-line comment marker to show removal (so manual review easier)
    return '/* removed inline :root by strip_inline_theme.cjs */';
  });
  if (newTxt !== original) {
    try {
      fs.copyFileSync(p, p + '.bak');
      fs.writeFileSync(p, newTxt, 'utf8');
      modified.push(f);
    } catch (e) {
      console.error('Failed to update', f, e);
    }
  }
}
console.log('Processed', targets.length, 'html files; modified', modified.length, 'files.');
modified.forEach(m => console.log(' -', m));
process.exit(0);
