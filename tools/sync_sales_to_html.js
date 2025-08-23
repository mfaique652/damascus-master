const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const dbPath = path.join(root, 'server', 'data', 'db.json');
if (!fs.existsSync(dbPath)) {
  console.error('DB not found at', dbPath);
  process.exit(1);
}
const db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
const products = Array.isArray(db.products) ? db.products : [];
products.forEach(prod => {
  if(!prod.page) return;
  const filePath = path.join(root, prod.page);
  if(!fs.existsSync(filePath)) { console.warn('missing file', filePath); return; }
  let content = fs.readFileSync(filePath, 'utf8');
  const saleObj = (prod.sale && prod.sale.active && Number(prod.sale.price) > 0) ? { active: true, price: Number(prod.sale.price), prevPrice: prod.sale.prevPrice ? Number(prod.sale.prevPrice) : null } : null;
  const saleStrRaw = saleObj ? JSON.stringify(saleObj) : 'null';
  const saleAttrSafe = saleObj ? saleStrRaw.replace(/'/g, "&#39;") : 'null';

  // backup
  try { fs.copyFileSync(filePath, filePath + '.bak'); } catch(e){ /* ignore */ }

  // update or insert data-wishlist-sale attribute inside wishlist-heart tag
  if(/data-wishlist-sale=["'][^"']*["']/.test(content)){
    content = content.replace(/data-wishlist-sale=["'][^"']*["']/, `data-wishlist-sale='${saleAttrSafe}'`);
  } else {
    content = content.replace(/(<div[^>]*class=["'][^"']*wishlist-heart[^"']*["'][^>]*)(>)/, `$1 data-wishlist-sale='${saleAttrSafe}'$2`);
  }

  // update unitPrice and totalPrice (match product-card styling when on sale)
  if (saleObj) {
    const prev = (saleObj.prevPrice && Number(saleObj.prevPrice) > 0) ? Number(saleObj.prevPrice) : (Number(prod.price) || 0);
    const sp = Number(saleObj.price);
    const saleUnitHtml = `<div style="display:flex;gap:0.6rem;align-items:center"><div class="orig-price" style="text-decoration:line-through;color:#999">$${Number(prev).toFixed(2)}</div><div class="sale-price" style="background:#fff;color:#000;font-weight:800;font-size:1.15rem;padding:0.2em 0.6em;border-radius:0.5em">$${Number(sp).toFixed(2)}</div></div>`;
    content = content.replace(/<div\s+id=["']unitPrice["'][^>]*>[^<]*<\/div>/, `<div id="unitPrice">${saleUnitHtml}</div>`);
    content = content.replace(/<div\s+id=["']totalPrice["'][^>]*>[^<]*<\/div>/, `<div id="totalPrice" style="font-weight:700">$${Number(sp).toFixed(2)}</div>`);
  } else {
    const unitPrice = (prod.price || 0);
    content = content.replace(/<div\s+id=["']unitPrice["'][^>]*>[^<]*<\/div>/, `<div id="unitPrice">$${Number(unitPrice).toFixed(2)}</div>`);
    content = content.replace(/<div\s+id=["']totalPrice["'][^>]*>[^<]*<\/div>/, `<div id="totalPrice" style="font-weight:700">$${Number(unitPrice).toFixed(2)}</div>`);
  }

  // update saleRibbon block
  if(saleObj){
  const pct = (saleObj.prevPrice && saleObj.prevPrice>0) ? Math.round((1 - (saleObj.price / saleObj.prevPrice)) * 100) : null;
  const pctText = pct ? ('-' + pct + '%') : 'SALE';
  // Product cards show only the percent (e.g. -20%), keep same format here
  const ribbonHtml = `<div id="saleRibbon" class="sale-ribbon" style="display:inline-block;visibility:hidden;opacity:0;"><span id="saleRibbonPct" class="sale-pct">${pctText}</span><span class="sale-price" id="saleRibbonPrice" style="display:inline-block;">$${Number(saleObj.price).toFixed(2)}</span></div>`;
    if(/<div\s+id=["']saleRibbon["'][\s\S]*?<\/div>/.test(content)){
      content = content.replace(/<div\s+id=["']saleRibbon["'][\s\S]*?<\/div>/, ribbonHtml);
    } else {
      // insert after main-img-wrap opening
      content = content.replace(/(<div\s+class=["']main-img-wrap["'][^>]*>)/, `$1${ribbonHtml}`);
    }
  } else {
  const hiddenHtml = `<div id="saleRibbon" class="sale-ribbon" style="display:inline-block;visibility:hidden;opacity:0;"><span id="saleRibbonPct" class="sale-pct"></span><span class="sale-price" id="saleRibbonPrice" style="display:inline-block;"></span></div>`;
    if(/<div\s+id=["']saleRibbon["'][\s\S]*?<\/div>/.test(content)){
      content = content.replace(/<div\s+id=["']saleRibbon["'][\s\S]*?<\/div>/, hiddenHtml);
    }
  }

  fs.writeFileSync(filePath, content, 'utf8');
  console.log('Updated', prod.page);
});
