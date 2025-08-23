const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(root).filter(f => f.endsWith('.html'));
const report = [];
for (const f of files) {
  const p = path.join(root, f);
  let txt = '';
  try { txt = fs.readFileSync(p, 'utf8'); } catch(e){ continue; }
  const styleTags = [];
  // find all <style ...>...</style> occurrences
  const re = /<style[^>]*>[\s\S]*?<\/style>/gi;
  let m;
  while ((m = re.exec(txt)) !== null) {
    styleTags.push({ index: m.index, text: m[0] });
  }
  if (styleTags.length <= 1) continue;
  // Merge contents preserving order. We'll keep the attributes from the first style tag if any.
  const first = styleTags[0];
  // extract inner contents
  const innerRe = /^<style[^>]*>([\s\S]*?)<\/style>$/i;
  const mergedContents = styleTags.map(st => {
    const mm = st.text.match(innerRe);
    return mm ? mm[1].trim() : '';
  }).join('\n\n/* merged: separator */\n\n');
  const newFirstTag = first.text.replace(innerRe, `<style>\n${mergedContents}\n</style>`);
  // Build new file: replace the first tag with newFirstTag, and remove other tags
  let newTxt = txt.slice(0, first.index) + newFirstTag + txt.slice(first.index + first.text.length);
  // Now remove subsequent occurrences (which still exist later in newTxt)
  // Remove all other <style>...</style> occurrences except the first one we just replaced
  let removed = 0;
  newTxt = newTxt.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, function(m, off){
    if (off === first.index) return m; // keep the first occurrence (approx)
    // For safety, skip replacing if this matches the newFirstTag again
    if (m === newFirstTag) return m;
    removed++;
    return '';
  });
  if (removed <= 0) continue;
  try {
    fs.copyFileSync(p, p + '.bak');
    fs.writeFileSync(p, newTxt, 'utf8');
    report.push({ file: f, removed });
  } catch (e) {
    console.error('Failed to merge style blocks in', f, e);
  }
}
console.log('Merged style blocks in', report.length, 'files.');
report.forEach(r => console.log(' -', r.file, 'removed blocks:', r.removed));
process.exit(0);
