const fs = require('fs');
const path = require('path');
(async ()=>{
  const dbPath = path.join(__dirname, 'server', 'data', 'db.json');
  const raw = fs.readFileSync(dbPath, 'utf8');
  const db = JSON.parse(raw);
  const id = '8b17d2d1-112c-4c33-bea4-c2b4ca9247cd';
  const p = db.products.find(x => x.id === id);
  if(!p) { console.error('product not found'); process.exit(2); }
  console.log('Before:', JSON.stringify({ id: p.id, price: p.price, sale: p.sale }, null, 2));
  // Incoming request: remove sale
  const incomingSale = { active: false };
  if (incomingSale.active) {
    const incomingPrice = (incomingSale.price !== undefined && incomingSale.price !== null) ? Number(incomingSale.price) : NaN;
    if (!Number.isFinite(incomingPrice) || incomingPrice <= 0) {
      console.error('Invalid sale price'); process.exit(3);
    }
    const explicitPrev = (incomingSale.prevPrice !== undefined && incomingSale.prevPrice !== null) ? Number(incomingSale.prevPrice) : NaN;
    const prev = (Number.isFinite(explicitPrev) && explicitPrev > 0) ? explicitPrev : (Number.isFinite(Number(p.price)) && Number(p.price) > 0 ? Number(p.price) : undefined);
    p.sale = { active: true, price: incomingPrice };
    if (prev !== undefined) p.sale.prevPrice = prev;
  } else {
    if (p.sale && p.sale.prevPrice !== undefined && Number.isFinite(Number(p.sale.prevPrice)) && Number(p.sale.prevPrice) > 0) {
      p.price = Number(p.sale.prevPrice);
    }
    p.sale = { active: false };
  }
  console.log('After:', JSON.stringify({ id: p.id, price: p.price, sale: p.sale }, null, 2));
})();
