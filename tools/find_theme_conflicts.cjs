const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const files = fs.readdirSync(root).filter(f => f.endsWith('.html'));
const report = [];
for (const f of files) {
  const p = path.join(root, f);
  let txt = '';
  try { txt = fs.readFileSync(p, 'utf8'); } catch(e){ continue; }
  const issues = [];
  const linkThemeMatches = (txt.match(/<link[^>]+theme\.css[^>]*>/gi) || []).length;
  if (linkThemeMatches > 1) issues.push(`multiple theme.css links (${linkThemeMatches})`);
  if (linkThemeMatches === 0 && /<link[^>]+href=["']css\/theme\.css["']/i.test(txt)) {
    // handled
  }
  // detect inline :root definitions in style blocks
  const rootCount = (txt.match(/:root\s*\{/g) || []).length;
  if (rootCount > 0) issues.push(`inline :root blocks: ${rootCount}`);
  // detect repeated <style> blocks more than 1
  const styleCount = (txt.match(/<style[\s>]/gi) || []).length;
  if (styleCount > 1) issues.push(`multiple <style> blocks: ${styleCount}`);
  // detect duplicated token names (e.g., --accent) repeated in file
  const tokenOcc = (txt.match(/--accent\b/g) || []).length;
  if (tokenOcc > 1) issues.push(`--accent token occurrences: ${tokenOcc}`);

  if (issues.length) report.push({ file: f, issues });
}

console.log('Theme conflict scan results:');
for (const r of report) {
  console.log(`- ${r.file}: ${r.issues.join('; ')}`);
}
console.log(`Scanned ${files.length} html files; ${report.length} files with potential theme conflicts.`);
process.exit(0);
