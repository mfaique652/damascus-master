const urls = [
  'http://localhost:3026/hand_forged_damascus_steel_5_pcs_rosewood_handle_chef_knife_set.html',
  'http://localhost:3026/hunting_bowie_knife_gift_for_men.html'
];

async function domCheck() {
  const http = require('http');
  const results = [];
  const fetch = (u) => new Promise((res, rej) => {
    http.get(u, (r) => {
      let s = '';
      r.setEncoding('utf8');
      r.on('data', c => s += c);
      r.on('end', () => res(s));
      r.on('error', e => rej(e));
    }).on('error', e => rej(e));
  });

  for (const u of urls) {
    try {
      const html = await fetch(u);
      const hasPlaceholder = /window\.__ALBUM_PLACEHOLDERS/.test(html) || /__ALBUM_PLACEHOLDERS/.test(html);
      const saleJson = /"active"\s*:\s*true|\bactive\s*:\s*true/i.test(html);
      const hasRibbon = /sale-?ribbon/i.test(html) || /saleRibbon/i.test(html);
      const salePrice = /sale-?price/i.test(html);
      const origPrice = /orig-?price/i.test(html);
      results.push({ url: u, ok: saleJson && (hasRibbon || salePrice), details: { hasPlaceholder, saleJson, hasRibbon, salePrice, origPrice } });
    } catch (e) {
      results.push({ url: u, ok: false, error: String(e) });
    }
  }
  console.log('DOM-check results:');
  console.log(JSON.stringify(results, null, 2));
  process.exit(results.every(r => r.ok) ? 0 : 2);
}

async function tryPuppeteer() {
  try {
    const puppeteer = require('puppeteer');
    const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();
    const results = [];
    for (const u of urls) {
      try {
        await page.goto(u, { waitUntil: 'networkidle0', timeout: 20000 });
        await page.waitForTimeout(200);
        const res = await page.evaluate(() => {
          const hasRibbon = !!document.querySelector('.sale-ribbon, [data-sale-ribbon], #saleRibbon');
          const salePriceEl = document.querySelector('.sale-price, [data-sale-price]');
          const origPriceEl = document.querySelector('.orig-price, [data-orig-price]');
          return {
            hasRibbon,
            salePriceText: salePriceEl ? salePriceEl.textContent.trim() : null,
            origPriceText: origPriceEl ? origPriceEl.textContent.trim() : null,
            htmlContainsPlaceholder: /window\.__ALBUM_PLACEHOLDERS/.test(document.documentElement.innerHTML)
          };
        });
        results.push({ url: u, ok: res.hasRibbon && !!res.salePriceText, details: res });
      } catch (e) {
        results.push({ url: u, ok: false, error: String(e) });
      }
    }
    await browser.close();
    console.log('Puppeteer results:');
    console.log(JSON.stringify(results, null, 2));
    process.exit(results.every(r => r.ok) ? 0 : 2);
  } catch (e) {
    if (e && e.code === 'MODULE_NOT_FOUND') {
      console.error('Puppeteer not present — falling back to lightweight DOM check.');
      return domCheck();
    }
    console.error('Puppeteer run failed, falling back to DOM check. Error:', e && (e.stack || e));
    return domCheck();
  }
}

tryPuppeteer();
