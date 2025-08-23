const puppeteer = require('puppeteer');
(async ()=>{
  const url = process.argv[2] || 'http://localhost:3026/hand_forged_damascus_steel_5_pcs_rosewood_handle_chef_knife_set.html';
  try{
    const browser = await puppeteer.launch({ args: ['--no-sandbox','--disable-setuid-sandbox'] });
    const page = await browser.newPage();
    page.on('console', msg => { try{ console.log('PAGE:', msg.text()); } catch(e){} });
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    // give client scripts a moment
    await page.waitForTimeout(500);
    const info = await page.evaluate(()=>{
      function cs(el){ try{ const s = window.getComputedStyle(el); return { display: s.display, visibility: s.visibility, opacity: s.opacity, innerHTML: el.innerHTML && el.innerHTML.slice(0,400) }; }catch(e){ return null; } }
      const unit = document.getElementById('unitPrice');
      const ribbon = document.getElementById('saleRibbon');
      const saleEls = Array.from(document.querySelectorAll('.sale-price'));
      return {
        url: location.href,
        unit: unit ? cs(unit) : null,
        ribbon: ribbon ? cs(ribbon) : null,
        saleEls: saleEls.map((el,i)=> ({ idx:i, info: cs(el) }))
      };
    });
    console.log(JSON.stringify(info, null, 2));
    await browser.close();
    process.exit(0);
  }catch(err){ console.error('ERR', err && err.message); process.exit(2); }
})();
