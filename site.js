(function(){
  const backendBase = (location.origin && location.origin !== 'null' && location.protocol.startsWith('http')) ? location.origin : 'http://localhost:3026';
  function absUrl(u){
    const v = String(u||'').trim();
    if (!v) return v;
    if (/^https?:\/\//i.test(v)) return v;
    if (v.startsWith('/')) {
      // If file:// context, prefix backendBase; if http(s), leave as-is (same-origin)
      if (!location.protocol.startsWith('http')) return backendBase + v;
      return v;
    }
    return v; // relative asset in repo
  }
  async function fetchProducts(){
    const r = await fetch(backendBase + '/api/products');
    if(!r.ok) throw new Error('Failed to load products: ' + r.statusText);
    return safeJson(r);
  }
  async function fetchProduct(id){
    const r = await fetch(backendBase + '/api/products/' + encodeURIComponent(id));
    if(!r.ok) throw new Error('Product not found: ' + r.statusText);
    return safeJson(r);
  }
  // Safe JSON parser: avoid calling .json() on HTML error pages (causes "Unexpected token '<'")
  async function safeJson(resp){
    if (!resp) return null;
    // If response status is not OK, try to read JSON body if content-type indicates JSON, otherwise return null
    const ct = resp.headers && (resp.headers.get && resp.headers.get('content-type') || resp.headers['content-type'] || '');
    if (!resp.ok) {
      if (ct && ct.toLowerCase().includes('application/json')) {
        try { return await resp.json(); } catch(e){ return null; }
      }
      return null;
    }
    // OK response: ensure content-type is JSON before parsing
    if (ct && ct.toLowerCase().includes('application/json')) {
      try { return await resp.json(); } catch(e){ return null; }
    }
    // Fallback: attempt json parse but catch errors
    try { return await resp.json(); } catch(e){ return null; }
  }
  function el(html){ const t=document.createElement('template'); t.innerHTML=html.trim(); return t.content.firstElementChild; }
  function price(n){ return '$' + Number(n||0).toFixed(2); }
  function normalize(v){ return String(v||'').trim().toLowerCase(); }
  // Escape helpers to avoid HTML injection when inserting user-provided content
  function escapeHtml(s){
    return String(s||'').replace(/[&<>"'`=\/]/g, function(c){
      return ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;','/':'&#x2F;','`':'&#96;','=':'&#61;'}[c]);
    });
  }
  function escapeAttr(s){ return escapeHtml(s).replace(/\r?\n/g,' '); }
  // Forward-declare deleteProduct so inline/admin handlers can reference it before its full implementation.
  async function deleteProduct(id){ if (typeof window !== 'undefined' && typeof window.deleteProduct === 'function') return window.deleteProduct(id); return null; }
  function fallbackImage(ctx){
    const key = normalize(ctx?.key || ctx || '');
    if (key.includes('axe')) return 'axes.png';
    if (key.includes('ring')) return 'rings.png';
    if (key.includes('sword')) return 'swords.png';
    if (key.includes('knife') || key.includes('knives') || key.includes('kitchen') || key.includes('hunting') || key.includes('pocket')) return 'kn1.png';
    if (key.includes('other')) return 'custom.png';
    return 'pic1.png';
  }

  async function renderList(container, arr){
  // Track context and ensure Admin UI is mounted (await verification to avoid race)
  window.__dm_ctx = arr.__context || {};
  // ensureAdminUI returns a boolean indicating whether the current token is a verified admin
  let isAdminVerified = false;
  try { isAdminVerified = !!(await ensureAdminUI(window.__dm_ctx)); } catch(e) { isAdminVerified = false; }
  ensureHeartStyle();

    container.innerHTML = '';
    const ctx = arr.__context || {};
    const isAlbumCtx = (ctx && ctx.type === 'album' && ctx.key);
    // Prefer any explicit incoming 'from' query (e.g. from=order). If missing, default to 'gallery'
    let srcParams = '';
    try {
      const curFrom = (new URLSearchParams(location.search)).get('from');
      if (isAlbumCtx) {
        const fromVal = curFrom ? String(curFrom) : 'gallery';
        srcParams = 'from=' + encodeURIComponent(fromVal) + '&cat=' + encodeURIComponent(String(ctx.key));
      }
    } catch (err) {
      if (isAlbumCtx) srcParams = 'from=gallery&cat=' + encodeURIComponent(String(ctx.key));
    }

  arr.forEach(p => {
      const fb = fallbackImage(arr.__context);
      const img = absUrl((p.images && p.images[0]) || fb);
      const desc = p.desc || '';
      const id = p.id || (p.title||'item').replace(/\s+/g,'-');
      const heartId = (p.details && p.details.displayId) ? p.details.displayId : id;
  let href = p.page ? p.page : (p.album ? p.album : ('album_template.html?id=' + encodeURIComponent(id)));
      // Ensure navigation carries the source when rendering inside an album/gallery
      // but do not overwrite an existing explicit 'from=' on the target href
      if (srcParams && !/[\?&]from=/.test(href)) {
        href = href + (href.includes('?') ? '&' : '?') + srcParams;
      }
  // Determine price display with optional sale
  const isOnSale = p.sale && p.sale.active && Number(p.sale.price) > 0;
  // Determine original price fallback: prefer preserved prevPrice when available
  const origPriceVal = (isOnSale && p.sale && p.sale.prevPrice && Number(p.sale.prevPrice) > 0) ? Number(p.sale.prevPrice) : Number(p.price || 0);
  const salePriceVal = (isOnSale ? Number(p.sale.price) : 0);
  // Calculate percent off when sale active
  const percentOff = (isOnSale && origPriceVal > 0) ? Math.round(((origPriceVal - salePriceVal) / origPriceVal) * 100) : 0;
  // Sale ribbon placed on the left as a diagonal badge showing percentage
  // Ensure the inline style forces visibility/stacking in case page-level CSS hides .sale-ribbon
  // Use inside-card positioning (left/top 0.6rem) so the badge isn't clipped when parent has overflow:hidden
  const saleHtml = isOnSale ? `<div class="sale-ribbon" style="position:absolute;top:0.6rem;left:0.6rem;transform:none;min-width:48px;padding:6px 8px;background:linear-gradient(90deg,#ff5a5a,#ff8a5a);color:#fff;font-weight:800;font-size:0.85rem;text-align:center;border-radius:0.45rem;box-shadow:0 2px 8px rgba(0,0,0,0.22);display:inline-block !important;visibility:visible !important;opacity:1 !important;z-index:9999">-${percentOff}%</div>` : '';
  // Price HTML: original struck-through and sale price with white background and black text
  const priceHtml = isOnSale ? `<div style="display:flex;gap:0.6rem;align-items:center"><div class="orig-price" style="text-decoration:line-through;color:#999">${price(origPriceVal)}</div><div class="sale-price" style="background:#fff;color:#000;font-weight:800;font-size:1.15rem;padding:0.2em 0.6em;border-radius:0.5em">${price(salePriceVal)}</div></div>` : `<div class="knife-price" style="color:#fff;background:#181c23;font-weight:800;font-size:1.35rem;margin-top:0.7rem;padding:0.3em 0.9em;border-radius:0.6em;box-shadow:0 2px 10px #0006;letter-spacing:0.03em;display:inline-block;float:none;clear:both;">${price(p.price)}</div>`;
  const node = el(`
    <div class="knife-item" style="position:relative;overflow:hidden;border-radius:12px;">
    ${saleHtml}
  <div class="wishlist-heart" data-wishlist-id="${heartId}" data-wishlist-productid="${p.id || ''}" data-wishlist-title="${(p.title||'').replace(/'/g,"&#39;")}" data-wishlist-desc="${(desc||'').replace(/'/g,"&#39;")}" data-wishlist-price="${Number(p.price)||0}" data-wishlist-img="${img}" data-wishlist-album="${href}" data-wishlist-sale='${p.sale?JSON.stringify(p.sale):''}' title="Wishlist">
      <svg width='28' height='28' viewBox='0 0 24 24' stroke='#ff4d6d' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><path d='M12 21s-6.5-4.35-9-7.5C1.5 10.5 2.5 7 6 7c2.1 0 3.5 1.5 4 2.5C10.5 8.5 11.9 7 14 7c3.5 0 4.5 3.5 3 6.5-2.5 3.15-9 7.5-9 7.5z'/></svg>
      </div>
      <a href="${href}"><img src="${escapeAttr(img)}" alt="${escapeAttr(p.title||'Product')}" /></a>
          <h3>${escapeHtml(p.title||'')}</h3>
          ${priceHtml}
        </div>`);
      // Admin overlays: attach only when server verification confirmed admin and admin mode toggled
  if (isAdminVerified && window.__dm_adminMode === true) {
        attachAdminControls(node, p);
      }
      container.appendChild(node);
    });
    // Ensure wishlist heart fill-state is updated
    try {
      if (typeof renderAlbumWishlistHeart !== 'function') {
        window.renderAlbumWishlistHeart = function(){
          document.querySelectorAll('.wishlist-heart').forEach(function(heartDiv){
            // Prefer explicit dataset product id; fallback to attribute onclick parsing for legacy markup
            var id = null;
            try { if (heartDiv.dataset && (heartDiv.dataset.wishlistProductid || heartDiv.dataset.wishlistId || heartDiv.dataset.id)) id = heartDiv.dataset.wishlistProductid || heartDiv.dataset.wishlistId || heartDiv.dataset.id; } catch(e){ console.warn('renderAlbumWishlistHeart dataset access error', e); }
            if (!id) {
              var onclick = heartDiv.getAttribute('onclick');
              var idMatch = onclick && onclick.match(/addToWishlist\(['\"]([^'\"]+)['\"]/);
              id = idMatch ? idMatch[1] : null;
            }
            var svg = heartDiv.querySelector('svg');
            if (!id || !svg) return;
            let wishlist = (typeof getWishlist === 'function') ? getWishlist() : JSON.parse(localStorage.getItem('wishlist') || '[]');
            const found = wishlist.some(item => item.id === id);
            if (found) svg.classList.add('heart-filled'); else svg.classList.remove('heart-filled');
          });
        }
      }
      renderAlbumWishlistHeart();
    } catch(e){}
  }

  // Simple Edit product modal used by admin edit button
  function openEditProduct(p){
    if (!p || !p.id) return;
    if (document.getElementById('dm-edit-modal')) return;
    const modal = el(`
      <div id="dm-edit-modal" style="position:fixed;inset:0;background:#0009;display:flex;align-items:center;justify-content:center;z-index:10000">
        <div style="width:min(640px,94vw);background:#1c202a;color:#fff;border-radius:12px;border:1px solid #2a2f3a;padding:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0">Edit product</h3><button id="dm-edit-close" style="border:0;background:#232737;color:#c9d1d9;border-radius:8px;padding:6px 10px;cursor:pointer">Close</button></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <input id="dm_e_title" placeholder="Title" value="${(p.title||'').replace(/"/g,'&quot;')}" />
            <input id="dm_e_price" type="number" step="0.01" placeholder="Price" value="${Number(p.price)||0}" />
            <input id="dm_e_image" placeholder="Main image URL (optional)" value="${(p.images && p.images[0]) ? p.images[0] : ''}" />
            <input id="dm_e_album" placeholder="Album/Category" value="${p.album||p.category||''}" />
          </div>
          <textarea id="dm_e_desc" placeholder="Description" style="width:100%;margin-top:8px;min-height:48px;resize:vertical">${(p.desc||'').replace(/</g,'&lt;')}</textarea>
          <div style="margin-top:8px;text-align:right">
            <button id="dm_edit_save" style="padding:.5rem .8rem;border-radius:8px;background:#ffd166;color:#181a20;font-weight:700;border:1px solid #ffda79;cursor:pointer">Save</button>
          </div>
        </div>
      </div>`);
    document.body.appendChild(modal);
    document.getElementById('dm-edit-close').addEventListener('click', ()=>{ document.getElementById('dm-edit-modal')?.remove(); });
    document.getElementById('dm_edit_save').addEventListener('click', async ()=>{
      const token = localStorage.getItem('adm_token') || '';
      if (!token) { alert('Please login as admin'); return; }
      const title = (document.getElementById('dm_e_title').value||'').trim();
      const price = Number(document.getElementById('dm_e_price').value || 0);
      const img = (document.getElementById('dm_e_image').value || '').trim();
      const album = (document.getElementById('dm_e_album').value || '').trim();
      const desc = (document.getElementById('dm_e_desc').value || '').trim();
      try{
        const payload = { title, price, album, desc };
        if (img) payload.images = [img];
        const r = await fetch(backendBase + '/api/products/' + encodeURIComponent(p.id), { method:'PUT', headers:{ 'Content-Type':'application/json', Authorization: 'Bearer '+token }, body: JSON.stringify(payload) });
        if (!r.ok) { alert('Save failed'); return; }
        document.getElementById('dm-edit-modal')?.remove();
        refreshCurrentView();
      } catch(e){ alert('Error saving'); }
    });
  }

  async function renderProductsForAlbum(album){
    const container = document.querySelector('.gallery');
    if(!container) return;
    let list = [];
    try { list = await fetchProducts(); } catch(e){ console.error(e); return; }
  const arr = list
      .filter(p => normalize(p.album) === normalize(album) || normalize(p.category) === normalize(album))
      .sort((a,b)=>(a.position||0)-(b.position||0));
  arr.__context = { type: 'album', key: album };
  await renderList(container, arr);
  }

  async function renderProductsForPage(page){
    const container = document.querySelector('.gallery');
    if(!container) return;
    let list = [];
    try { list = await fetchProducts(); } catch(e){ console.error(e); return; }
    const me = normalize(page || location.pathname.split('/').pop());
    const arr = list
      .filter(p => normalize(p.page) === me)
      .sort((a,b)=>(a.position||0)-(b.position||0));
    arr.__context = { type: 'page', key: me };
  await renderList(container, arr);
  }

  window.renderProductsForAlbum = renderProductsForAlbum;
  window.renderProductsForPage = renderProductsForPage;
  function refreshCurrentView(){
    let ctx = window.__dm_ctx || {};
    if (!ctx.type) {
      const cat = guessCategoryFromPage();
      if (cat) ctx = { type:'album', key: cat };
      else ctx = { type:'page', key: location.pathname.split('/').pop() };
      window.__dm_ctx = ctx;
    }
    if (ctx.type === 'album') renderProductsForAlbum(ctx.key);
    else if (ctx.type === 'page') renderProductsForPage(ctx.key || location.pathname.split('/').pop());
  }
  // Fallback wishlist helper if not present on page
  if (typeof window.addToWishlist !== 'function') {
    // Accept optional sale parameter as last arg for flows that provide sale metadata
    window.addToWishlist = async function(id, title, desc, price, img, album, e, _sale){
      try { if(e) e.stopPropagation(); } catch(err){ console.warn('addToWishlist stopPropagation failed', err); }
      try {
        // Normalize inputs similarly to central handler
        title = (typeof title === 'string') ? title : (title && typeof title === 'object' ? (title.title || title.name || '') : String(title || ''));
        desc = (typeof desc === 'string') ? desc : (desc && typeof desc === 'object' ? (desc.description || '') : String(desc || ''));
        img = img ? String(img) : '';
        price = (price === undefined || price === null) ? 0 : Number(price) || 0;

        // Prefer centralized per-user helpers when available
        let wishlist = (typeof getWishlist === 'function') ? getWishlist() : JSON.parse(localStorage.getItem('wishlist') || '[]');
        // match common id aliases to avoid duplicate entries
        const idx = wishlist.findIndex(it => it && (it.id === id || it.gallery === id || it.productId === id || it.productID === id));

        // Determine initial sale from param
        let sale = _sale || null;
        // If adding and sale missing, try to fetch latest product record to obtain up-to-date sale metadata
        if (idx === -1 && !sale) {
          try {
            const url = (typeof backendBase !== 'undefined' ? backendBase : 'http://localhost:3026') + '/api/products/' + encodeURIComponent(id);
            if (typeof fetch !== 'undefined') {
              const resp = await fetch(url, { method: 'GET', credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
              if (resp && resp.ok) {
                const p = await resp.json();
                if (p && p.sale && p.sale.active && Number(p.sale.price) > 0) {
                  sale = p.sale;
                }
              }
            }
          } catch(e) { /* ignore network errors, proceed without sale */ }
        }

        if (idx === -1) wishlist.push({ id, title, desc, price, img, album, sale: sale || null });
        else wishlist.splice(idx, 1);
        if (typeof setWishlist === 'function') setWishlist(wishlist); else localStorage.setItem('wishlist', JSON.stringify(wishlist));
        if (typeof renderAlbumWishlistHeart === 'function') renderAlbumWishlistHeart();
      } catch(err){ console.warn('addToWishlist failed', err); }
    }
  }

  // ---- Product detail page renderer ----
  async function renderProductDetailFromQuery(){
    const params = new URLSearchParams(location.search);
    const id = params.get('id');
    if(!id) return;
    let p; try { p = await fetchProduct(id); } catch(e){ console.error(e); return; }
    const container = document.querySelector('.product-detail');
    if(!container) return;
    const img = absUrl((p.images && p.images[0]) || fallbackImage(p.category || p.album || p.page || ''));
    const images = (p.images||[]).map(absUrl);
  // Default backHref derived from product metadata
  let backHref = p.page ? p.page : (p.category ? guessPageFromCategory(p.category) : '#');
  // If the incoming URL included a 'from' parameter, map well-known sources to their preferred back destination
  try {
    const params = new URLSearchParams(window.location.search);
    const from = params.get('from');
    if (from) {
      // Explicit source mappings should override any default backHref
      if (from === 'order') {
        backHref = 'order.html';
      } else if (from === 'wishlist') {
        backHref = 'index.html?open=wishlist';
      } else if (from === 'catalogue' || from === 'cart') {
        backHref = 'index.html?open=catalogue';
      } else {
        // For unknown sources, preserve context by appending the source to the derived backHref when available
        if (backHref && backHref !== '#') backHref = backHref + (backHref.includes('?') ? '&' : '?') + 'from=' + encodeURIComponent(from);
      }
    }
  } catch(e) { }
  const heartId = (p.details && p.details.displayId) ? p.details.displayId : p.id;
    const gallery = images.length ? images.map(u=>`<img src="${u}" style="width:92px;height:92px;object-fit:cover;border:1px solid #ddd;border-radius:8px;margin-right:8px" />`).join('') : '';
    container.innerHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">
        <div>
          <img src="${img}" alt="${p.title||''}" style="width:100%;max-width:520px;border-radius:12px;border:1px solid #e1e1e1" />
          <div style="margin-top:8px;display:flex;flex-wrap:wrap">${gallery}</div>
        </div>
        <div>
          <h1 style="margin:0 0 8px">${p.title||''}</h1>
          <div style="font-weight:800;font-size:1.5rem;margin-bottom:12px">
            ${(() => {
              try {
                const isOnSale = p.sale && p.sale.active && Number(p.sale.price) > 0;
                const origPriceVal = (isOnSale && p.sale && p.sale.prevPrice && Number(p.sale.prevPrice) > 0) ? Number(p.sale.prevPrice) : Number(p.price || 0);
                const salePriceVal = (isOnSale ? Number(p.sale.price) : 0);
                if (isOnSale) {
                  return `<div style="display:flex;gap:0.6rem;align-items:center"><div style="text-decoration:line-through;color:#999;font-weight:700">${price(origPriceVal)}</div><div style="color:#fff;background:#d93f4d;font-weight:800;font-size:1.25rem;padding:0.2em 0.6em;border-radius:0.4em">${price(salePriceVal)}</div></div>`;
                }
                return `${price(p.price)}`;
              } catch(e){ return `${price(p.price)}`; }
            })()}
          </div>
          <p>${p.desc||''}</p>
          <div style="margin-top:12px">
            <button class="add-wishlist-btn" data-wishlist-id="${heartId}" data-wishlist-title="${(p.title||'').replace(/'/g,"&#39;")}" data-wishlist-desc="${(p.desc||'').replace(/'/g,"&#39;")}" data-wishlist-price="${Number(p.price)||0}" data-wishlist-img="${img}" data-wishlist-album="${backHref}" style="padding:.6rem .9rem;border-radius:10px;border:1px solid #ccc;background:#fafafa;cursor:pointer">❤ Add to wishlist</button>
          </div>
          ${backHref && backHref !== '#' ? `<div style=\"margin-top:10px\"><a href=\"${backHref}\">← Back</a></div>`: ''}
        </div>
      </div>`;
  }
  function guessPageFromCategory(cat){
    const c = normalize(cat);
    if (c.includes('axe')) return 'Axes.html';
    if (c.includes('ring')) return 'Rings.html';
    if (c.includes('sword')) return 'Swords.html';
    if (c.includes('pocket')) return 'pocket-knives.html';
    if (c.includes('hunting')) return 'hunting-knives.html';
    if (c.includes('kitchen')) return 'kitchen-knives.html';
    if (c.includes('other')) return 'Others.html';
    return 'index.html';
  }
  window.renderProductDetailFromQuery = renderProductDetailFromQuery;
  // Cross-tab sync: update hearts and header when wishlist/users/orders change elsewhere
  window.addEventListener('storage', function(e){
    try {
      if (!e) return;
      // React to legacy 'wishlist' key and to the centralized 'users' or 'orders' keys
      const key = (e.key || '').toLowerCase();
      if (key && key !== 'wishlist' && key !== 'users' && key !== 'orders') return;
      try { if (typeof renderAlbumWishlistHeart === 'function') renderAlbumWishlistHeart(); } catch(e){}
      try { updateHeaderWishlist(); } catch(e){}
    } catch(err) { /* ignore */ }
  });

  // Site-wide compact mode: initialize from localStorage and listen for cross-tab updates
  try {
    try { if (localStorage.getItem('dm_compact')) document.body.classList.add('compact'); else document.body.classList.remove('compact'); } catch(e){}
    if (window.BroadcastChannel) {
      const bc = new BroadcastChannel('dm_prefs');
      bc.addEventListener('message', (ev)=>{
        try {
          if (!ev || !ev.data) return;
          if (ev.data.type === 'compact') {
            if (ev.data.value) document.body.classList.add('compact'); else document.body.classList.remove('compact');
          }
        } catch(e){}
      });
    } else {
      window.addEventListener('storage', function(e){
        try {
          if (!e) return;
          // Support both explicit toggle key and direct dm_compact writes
          if (e.key === 'dm_compact_toggle') {
            const obj = JSON.parse(e.newValue||'{}');
            if (obj && obj.v) document.body.classList.add('compact'); else document.body.classList.remove('compact');
          } else if (e.key === 'dm_compact') {
            const v = String(e.newValue || '').toLowerCase() === 'true';
            if (v) document.body.classList.add('compact'); else document.body.classList.remove('compact');
          }
        } catch(e){}
      });
    }
  } catch(e){}

  // --- Admin inline add product ---
  async function getCurrentUser(){
    try {
      const token = localStorage.getItem('adm_token') || '';
      if(!token) return null;
  const r = await fetch(backendBase + '/api/auth/profile', { headers: { Authorization: 'Bearer '+token }});
  if(!r.ok) return null;
  const data = await safeJson(r);
  return data && data.user ? data.user : null;
    } catch { return null }
  }
  function isAdminLoggedIn(){ return !!localStorage.getItem('adm_token'); }
  // --- Admin Mode UI (implemented later) ---

  function attachAdminControls(node, p){
    const bar = el(`<div style="position:absolute;top:8px;left:8px;display:flex;gap:6px;z-index:9999">
  <button title="Edit" style="background:#232737;color:#c9d1d9;border:1px solid #384152;border-radius:6px;padding:2px 6px;font-size:12px;cursor:pointer">✎</button>
  <button title="Sale" style="background:#232737;color:#ff6b6b;border:1px solid #384152;border-radius:6px;padding:2px 6px;font-size:12px;cursor:pointer">% Sale</button>
  <button title="Toggle Top Seller" style="background:#232737;color:#ffd166;border:1px solid #384152;border-radius:6px;padding:2px 6px;font-size:12px;cursor:pointer">★</button>
      <button title="Move Left" style="background:#232737;color:#c9d1d9;border:1px solid #384152;border-radius:6px;padding:2px 6px;font-size:12px;cursor:pointer">◀</button>
      <button title="Move Right" style="background:#232737;color:#c9d1d9;border:1px solid #384152;border-radius:6px;padding:2px 6px;font-size:12px;cursor:pointer">▶</button>
      <button title="Delete" style="background:#3a1f24;color:#ff8585;border:1px solid #6a2a33;border-radius:6px;padding:2px 6px;font-size:12px;cursor:pointer">🗑</button>
    </div>`);
    // Positioning context
    node.style.position = node.style.position || 'relative';
    const buttons = bar.querySelectorAll('button');
    const btnEdit = buttons[0];
    const btnSale = buttons[1];
    const btnToggleTop = buttons[2];
    const btnLeft = buttons[3];
    const btnRight = buttons[4];
    const btnDel = buttons[5];
    // Edit
    btnEdit && btnEdit.addEventListener('click', (e)=>{ e.stopPropagation(); e.preventDefault(); openEditProduct(p); });
    // Sale button
    btnSale && btnSale.addEventListener('click', async (e)=>{
      e.stopPropagation(); e.preventDefault();
      try{
        const existing = (p.sale && p.sale.active) ? (p.sale.price || '') : '';
        const val = prompt('Enter sale price (numeric) or leave empty to remove sale', existing);
        if (val === null) return;
        const price = parseFloat(String(val).trim());
        const token = localStorage.getItem('adm_token') || '';
        if (!val || isNaN(price)) {
          // If empty or invalid, remove sale
          const r = await fetch(backendBase + '/api/products/' + encodeURIComponent(p.id), {
            method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer '+token },
            body: JSON.stringify({ sale: { active: false } })
          });
          if (!r.ok) return alert('Failed to remove sale');
          p.sale = { active: false };
          refreshCurrentView();
          return;
        }
        // When setting a sale, include prevPrice so original price is preserved for rendering
        const r = await fetch(backendBase + '/api/products/' + encodeURIComponent(p.id), {
          method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer '+token },
          body: JSON.stringify({ sale: { active: true, price: Number(price), prevPrice: Number(p.price) || 0 } })
        });
        if (!r.ok) return alert('Failed to set sale');
        p.sale = { active: true, price: Number(price), prevPrice: Number(p.price) || 0 };
        refreshCurrentView();
      } catch(err){ console.error(err); alert('Error setting sale'); }
    });
    // Toggle Top Seller (calls backend PUT to flip topSeller)
    btnToggleTop && btnToggleTop.addEventListener('click', async (e)=>{
      e.stopPropagation(); e.preventDefault();
      try{
        const token = localStorage.getItem('adm_token') || '';
        const r = await fetch(backendBase + '/api/products/' + encodeURIComponent(p.id), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer '+token },
          body: JSON.stringify({ topSeller: !p.topSeller })
        });
        if (!r.ok) { alert('Failed to toggle Top Seller'); return; }
        // Update local object state and refresh
        p.topSeller = !p.topSeller;
        refreshCurrentView();
      } catch(err){ console.error(err); alert('Error toggling Top Seller'); }
    });
    // Move / Delete
    btnDel && btnDel.addEventListener('click', async (e)=>{ e.stopPropagation(); e.preventDefault(); if (!confirm('Delete this product?')) return; await deleteProduct(p.id); refreshCurrentView(); });
    btnLeft && btnLeft.addEventListener('click', async (e)=>{ e.stopPropagation(); e.preventDefault(); await moveProduct(p, -1); refreshCurrentView(); });
    btnRight && btnRight.addEventListener('click', async (e)=>{ e.stopPropagation(); e.preventDefault(); await moveProduct(p, +1); refreshCurrentView(); });
    node.appendChild(bar);
  }

  // Safe helper for moving product positions. If backend API exists, call it; otherwise no-op.
  async function moveProduct(p, delta){
    // p: product object (must have .id), delta: integer (-1 or +1 typically)
    if (!p || !p.id) return null;
    const token = localStorage.getItem('adm_token') || '';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    try{
      // Preferred backend endpoint (server may accept POST /api/products/:id/move)
      const url = backendBase + '/api/products/' + encodeURIComponent(p.id) + '/move';
      const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify({ delta }) });
      if (r.ok) {
        try { return await safeJson(r); } catch(e){ return null; }
      }
      // If backend doesn't expose move, don't throw — just warn and no-op
      if (r.status === 404 || r.status === 501) {
        console.warn('moveProduct: backend move endpoint not available:', r.status);
        return null;
      }
      console.warn('moveProduct: move request failed', r.status);
      return null;
    }catch(err){
      // Network or other error: log and no-op to avoid breaking admin UI
      console.warn('moveProduct error (falling back to no-op):', err);
      return null;
    }
  }

  // Create and show the Add Product modal (used when admin FAB is clicked)
  function openAddModal(ctx){
    // If modal already exists, don't recreate
    if (document.getElementById('dm-add-modal')) return;
    const modal = el(`
      <div id="dm-add-modal" style="position:fixed;inset:0;background:#0009;display:flex;align-items:start;justify-content:center;z-index:10000;padding-top:48px">
        <div style="width:min(720px,96vw);background:#1c202a;color:#fff;border-radius:12px;border:1px solid #2a2f3a;padding:16px;max-height:92vh;overflow:auto">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><h3 style="margin:0">Add product</h3><button id="dm-add-close" style="border:0;background:#232737;color:#c9d1d9;border-radius:8px;padding:6px 10px;cursor:pointer">Close</button></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <input id="dm_p_title" placeholder="Title" />
            <input id="dm_p_price" type="number" step="0.01" placeholder="Price" />
            <input id="dm_p_image" placeholder="Main image URL (optional)" />
            <input id="dm_p_album" placeholder="Album/Category" />
            <input id="dm_p_page" placeholder="Exact page (e.g., album3.html)" />
          </div>
          <textarea id="dm_p_desc" placeholder="Description" style="width:100%;margin-top:8px;min-height:48px;resize:vertical"></textarea>
          <textarea id="dm_p_details" placeholder="Details (JSON or text, e.g. {\"displayId\":\"kn2\"})" style="width:100%;margin-top:8px;min-height:32px;resize:vertical"></textarea>
          <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
            <input id="dm_p_file" type="file" accept="image/*" multiple />
            <button id="dm_p_upload" style="padding:.3rem .6rem;border-radius:6px;border:1px solid #555;background:#2b2f3a;color:#fff;cursor:pointer">Upload</button>
            <div id="dm_add_msg" style="margin-left:auto;color:#ff7575"></div>
          </div>
          <div id="dm_p_imgs" style="display:flex;flex-wrap:wrap;gap:6px;margin-top:6px"></div>
          <div style="margin-top:8px;text-align:right">
            <button id="dm_add_save" style="padding:.5rem .8rem;border-radius:8px;background:#ffd166;color:#181a20;font-weight:700;border:1px solid #ffda79;cursor:pointer">Save</button>
          </div>
        </div>
      </div>`);
    document.body.appendChild(modal);
    // Close wiring
    document.getElementById('dm-add-close').addEventListener('click', ()=>{ document.getElementById('dm-add-modal')?.remove(); });
    // Prefill based on context
    try { if (ctx?.type === 'album') document.getElementById('dm_p_album').value = ctx.key; } catch(e){}
    try { if (ctx?.type === 'page') document.getElementById('dm_p_page').value = ctx.key; } catch(e){}
    document.getElementById('dm_add_save').addEventListener('click', saveNewProduct);
    document.getElementById('dm_p_upload').addEventListener('click', uploadInlineImages);
  }
  // Global add/save handlers for Admin Mode
  async function saveNewProduct(){
    const msg = document.getElementById('dm_add_msg'); if (msg) msg.textContent='';
    const token = localStorage.getItem('adm_token') || '';
    if (!token) { if (msg) msg.textContent='Please login first.'; openAdminLoginModal(window.__dm_ctx||{}); return; }
    const title = (document.getElementById('dm_p_title')?.value || '').trim();
    const price = Number(document.getElementById('dm_p_price')?.value);
    const mainImage = (document.getElementById('dm_p_image')?.value || '').trim();
    let album = (document.getElementById('dm_p_album')?.value || '').trim();
    let page = (document.getElementById('dm_p_page')?.value || '').trim();
    const desc = (document.getElementById('dm_p_desc')?.value || '').trim();
    let details = (document.getElementById('dm_p_details')?.value || '').trim();
    if (!title || !(price>=0)) { if (msg) msg.textContent='Title and price are required.'; return; }
    // Default from context when fields empty
    const ctx = window.__dm_ctx || {};
    if (!album && ctx.type==='album') album = ctx.key;
    if (!page && ctx.type==='page') page = ctx.key;
    // If there are files selected but not uploaded yet, force upload and block save if not successful
    const fileInput = document.getElementById('dm_p_file');
    if (fileInput?.files?.length) {
      await uploadInlineImages();
      // Check if images were actually added
      if (![...document.querySelectorAll('#dm_p_imgs .img-url')].length) {
        if (msg) msg.textContent = 'Please upload images before saving.';
        return;
      }
    }
    let images = [...document.querySelectorAll('#dm_p_imgs .img-url')].map(n=>n.textContent);
    if (mainImage) {
      if (images.length === 0 || images[0] !== mainImage) images.unshift(mainImage);
    }
    // De-duplicate while preserving order
    const seen = new Set(); images = images.filter(u=>{ const k=String(u||''); if(seen.has(k)) return false; seen.add(k); return true; });
    if (!images.length) {
      if (msg) msg.textContent = 'At least one image is required.';
      return;
    }
    // Parse details as JSON if possible
    let detailsObj = undefined;
    if (details) {
      try { detailsObj = JSON.parse(details); } catch { detailsObj = details; }
    }
    const payload = { title, price, desc, album, category: album, page, images };
    if (detailsObj !== undefined) payload.details = detailsObj;
    try{
      const r = await fetch(backendBase + '/api/products', { method:'POST', headers:{ 'Content-Type':'application/json', Authorization: 'Bearer '+token }, body: JSON.stringify(payload) });
      if (!r.ok) {
        const t = await r.text().catch(()=> '');
        if (msg) msg.textContent = 'Add failed. ' + (t||'Ensure you are logged in as admin.');
        return;
      }
      document.getElementById('dm-add-modal')?.remove();
      refreshCurrentView();
    } catch(e){ if (msg) msg.textContent='Error while saving.'; }
  }

  async function uploadInlineImages(e){
    if (e) e.preventDefault();
    const msg = document.getElementById('dm_add_msg'); if (msg) msg.textContent='';
    const token = localStorage.getItem('adm_token') || '';
    if (!token) { if (msg) msg.textContent='Please login first.'; openAdminLoginModal(window.__dm_ctx||{}); return; }
    const inp = document.getElementById('dm_p_file');
    if(!inp || !inp.files || !inp.files.length){ if (msg) msg.textContent='Choose files to upload'; return; }
    try{
      const fd = new FormData();
      [...inp.files].forEach(f=> fd.append('files', f));
      const r = await fetch(backendBase + '/api/uploads', { method:'POST', headers: { Authorization: 'Bearer '+token }, body: fd });
      if(!r.ok){ if (msg) msg.textContent='Upload failed'; return }
  const d = await safeJson(r);
      (d.files||[]).forEach(f=> addInlineImgChip(f.url));
      inp.value='';
    }catch{ if (msg) msg.textContent='Upload error' }
  }

  function addInlineImgChip(url){
    const chip = el(`<div style="display:inline-flex;align-items:center;gap:6px;border:1.5px solid #2b2f3a;padding:3px 5px;border-radius:8px;background:#232737;box-shadow:0 2px 8px #0002"><img src="${absUrl(url)}" style="width:54px;height:54px;object-fit:cover;border-radius:6px;border:1px solid #444"><span class="img-url" style="display:none">${url}</span><button type="button" style="background:#ff7575;color:#fff;border:0;padding:0 .5rem;border-radius:6px;font-size:1.1em;cursor:pointer" title="Remove image" onclick="this.parentElement.remove()">×</button></div>`);
    document.getElementById('dm_p_imgs')?.appendChild(chip);
  }
  function ensureHeartStyle(){
    if (document.getElementById('dm-heart-style')) return;
    const style = document.createElement('style');
    style.id = 'dm-heart-style';
    style.textContent = `.wishlist-heart{position:absolute;top:.7em;right:.7em;z-index:2;background:rgba(24,28,35,.85);border-radius:50%;padding:.18em;cursor:pointer;transition:background .2s;box-shadow:0 2px 8px #0005;display:flex;align-items:center;justify-content:center}.wishlist-heart:hover{background:#ff4d6d22}.wishlist-heart svg.heart-filled path{fill:#ff4d6d;stroke:#ff4d6d}
    /* Header liked icon and badge */
    .liked-icon{position:relative;display:inline-flex;align-items:center;justify-content:center}
    .liked-icon.filled svg path{fill:#ff4d6d;stroke:#ff4d6d}
    .wishlist-badge{position:absolute;top:-6px;right:-6px;min-width:18px;height:18px;padding:0 5px;border-radius:999px;background:#ff4d6d;color:#fff;font-size:11px;font-weight:700;display:inline-flex;align-items:center;justify-content:center;box-shadow:0 1px 4px #0004}
    `;
    document.head.appendChild(style);
  }
  
  // Helper: resolve current user storage key (returns lowercased email/username or null)
  function getCurrentUserKey() {
    try {
      const cur = localStorage.getItem('currentUser');
      if (!cur) return null;
      try {
        const parsed = JSON.parse(cur);
        if (parsed && typeof parsed === 'object') {
          const key = (parsed.email || parsed.username || '') && String((parsed.email || parsed.username || '')).toLowerCase();
          return key || null;
        }
      } catch (e) {
        // not JSON — treat as key
        return String(cur || '').toLowerCase() || null;
      }
      return null;
    } catch (e) { return null; }
  }

  // Users map helpers — store public profiles under 'users' map in localStorage
  function getUsersMap() { try { return JSON.parse(localStorage.getItem('users') || '{}'); } catch { return {}; } }
  function setUsersMap(m) { try { localStorage.setItem('users', JSON.stringify(m || {})); } catch {} }
  function getUserProfile(key) { try { if (!key) return null; const users = getUsersMap(); return users[String(key).toLowerCase()] || null; } catch { return null; } }
  function setUserProfile(key, profile) { try { if (!key) return; const users = getUsersMap(); users[String(key).toLowerCase()] = Object.assign({}, users[String(key).toLowerCase()] || {}, profile || {}); setUsersMap(users); } catch {} }

  // Normalize logo path when persisting a profile: prefer /uploads/avatars/<basename> when applicable
  const _orig_setUserProfile = setUserProfile;
  function _normalizeLogoInProfile(key, profile){
    try {
      if (!profile || !profile.logo) return profile;
      const logo = String(profile.logo || '');
      if (logo.indexOf('/uploads/') === 0 && !logo.includes('/uploads/avatars/')){
        const base = logo.split('/').pop();
        profile.logo = '/uploads/avatars/' + base;
      }
    } catch(e){}
    return profile;
  }
  function setUserProfileNormalized(key, profile){ try { _orig_setUserProfile(key, _normalizeLogoInProfile(key, Object.assign({}, profile||{}))); } catch(e){} }
  // Expose normalized setter as primary
  window.setUserProfile = setUserProfileNormalized;

  // Per-user wishlist/orders helpers — fall back to global localStorage 'wishlist' for guests
  function getWishlist(){
    try {
      const key = getCurrentUserKey();
      if (key) {
        const profile = getUserProfile(key) || {};
        return Array.isArray(profile.wishlist) ? profile.wishlist : [];
      }
  return JSON.parse(localStorage.getItem('wishlist') || '[]');
    } catch { return []; }
  }
  function setWishlist(arr){
    try {
      const key = getCurrentUserKey();
      if (key) {
        const profile = getUserProfile(key) || {};
        profile.wishlist = Array.isArray(arr) ? arr : [];
        setUserProfile(key, profile);
        // also notify cross-tab
        localStorage.setItem('users', JSON.stringify(getUsersMap()));
        return;
      }
      localStorage.setItem('wishlist', JSON.stringify(arr || []));
    } catch {} }
  function getOrders(){
    try {
      const key = getCurrentUserKey();
      if (key) {
        const profile = getUserProfile(key) || {};
        return Array.isArray(profile.orders) ? profile.orders : [];
      }
  return JSON.parse(localStorage.getItem('orders') || '[]');
    } catch { return []; }
  }
  function setOrders(arr){
    try {
      const key = getCurrentUserKey();
      if (key) {
        const profile = getUserProfile(key) || {};
        profile.orders = Array.isArray(arr) ? arr : [];
        setUserProfile(key, profile);
        localStorage.setItem('users', JSON.stringify(getUsersMap()));
        return;
      }
      localStorage.setItem('orders', JSON.stringify(arr || []));
    } catch {} }

  // Expose helpers globally for other inline scripts
  window.getWishlist = getWishlist;
  window.setWishlist = setWishlist;
  window.getOrders = getOrders;
  window.setOrders = setOrders;

  // Resolve avatar URL helper: prefer /uploads/avatars when available
  window.resolveAvatarUrl = function(logo){
    try {
      if (!logo) return logo;
      const s = String(logo || '');
      if (s.indexOf('/uploads/avatars/') === 0) return s;
      if (s.indexOf('/uploads/') === 0) {
        const base = s.split('/').pop();
        return '/uploads/avatars/' + base;
      }
      return s;
    } catch(e){ return logo; }
  };

  // Normalize any existing stored users to prefer avatars subfolder when possible.
  (async function normalizeStoredUsersToAvatars(){
    try {
      // Fetch server uploads list (server returns files and avatars)
      const r = await fetch((typeof backendBase !== 'undefined' ? backendBase : '') + '/api/uploads');
      if (!r.ok) return;
  const d = await safeJson(r);
      const avatars = new Set((d.files || []).filter(f=> String(f.url||'').indexOf('/uploads/avatars/')!==-1).map(f=> {
        const parts = String(f.url||'').split('/'); return parts[parts.length-1];
      }));
      if (!avatars.size) return;
      const users = getUsersMap();
      let changed = false;
      Object.keys(users||{}).forEach(k=>{
        try {
          const p = users[k] || {};
          if (p.logo && String(p.logo).indexOf('/uploads/') === 0 && String(p.logo).indexOf('/uploads/avatars/') === -1){
            const base = String(p.logo).split('/').pop();
            if (avatars.has(base)){
              p.logo = '/uploads/avatars/' + base;
              users[k] = p;
              changed = true;
            }
          }
        } catch(e){}
      });
      if (changed){
        try {
          // Use normalized setter when available
          Object.keys(users).forEach(k => { if (typeof window.setUserProfile === 'function') window.setUserProfile(k, users[k]); });
  
  // Safe helper to delete a product via backend when available. No-op on failure.
  async function deleteProduct(id){
    if (!id) return null;
    const token = localStorage.getItem('adm_token') || '';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    try{
      const url = backendBase + '/api/products/' + encodeURIComponent(id);
      const r = await fetch(url, { method: 'DELETE', headers });
      if (r.ok) return await r.json().catch(()=>null);
      console.warn('deleteProduct failed', r.status);
      return null;
    }catch(err){ console.warn('deleteProduct error (no-op):', err); return null; }
  }
  // Expose to global for inline handlers and legacy callers
  window.deleteProduct = deleteProduct;
          // Touch profileUpdatedAt for cross-tab notification
          localStorage.setItem('profileUpdatedAt', String(Date.now()));
        } catch(e){ localStorage.setItem('users', JSON.stringify(users)); }
      }
    } catch (e) { /* non-fatal */ }
  })();

  // Update the header heart (fill state) and numeric badge according to wishlist contents
  function updateHeaderWishlist(){
    try{
      const likedEl = document.querySelector('.liked-icon');
      if (!likedEl) return;
      // ensure CSS exists
      ensureHeartStyle();
      // find or create badge
      let badge = likedEl.querySelector('#wishlist-badge');
      if (!badge) {
        badge = document.createElement('span');
        badge.id = 'wishlist-badge';
        badge.className = 'wishlist-badge';
        likedEl.appendChild(badge);
      }
      const count = (Array.isArray(getWishlist()) ? getWishlist().length : 0);
      if (count && count > 0) {
        likedEl.classList.add('filled');
        badge.textContent = count > 99 ? '99+' : String(count);
        badge.style.display = 'inline-flex';
      } else {
        likedEl.classList.remove('filled');
        badge.textContent = '';
        badge.style.display = 'none';
      }
    } catch(e) { console.warn('updateHeaderWishlist failed', e); }
  }

  function isInWishlistId(id){ const w = getWishlist(); return (Array.isArray(w) ? w.some(item => item.id === id || item.gallery === id) : false); }

  // Migrate/normalize any existing (global) wishlist entries into per-user storage when possible
  (function normalizeStoredWishlist(){
    try {
      // If there is a legacy global wishlist and a logged-in user, migrate it into their profile
  const legacyRaw = (function(){ try { return JSON.parse(localStorage.getItem('wishlist') || '[]'); } catch { return []; } })();
      const key = getCurrentUserKey();
      if (Array.isArray(legacyRaw) && legacyRaw.length && key) {
        // merge with any existing user wishlist (avoid duplicates)
        const existing = Array.isArray(getWishlist()) ? getWishlist() : [];
        const merged = existing.slice();
        legacyRaw.forEach(it => {
          const id = it && (it.id || it.gallery) ? (it.id || it.gallery) : '';
          if (!merged.some(m => m.id === id)) merged.push(it);
        });
        setWishlist(merged);
        try { localStorage.removeItem('wishlist'); } catch(e) {}
      } else {
        // Even for guests, ensure stored shape is normalized
        const raw = getWishlist();
        if (!Array.isArray(raw) || raw.length === 0) return;
        const norm = raw.map(it => {
          const id = it && (it.id || it.gallery) ? (it.id || it.gallery) : '';
          const title = (it && typeof it.title === 'string') ? it.title : (it && typeof it.title === 'object' ? (it.title && (it.title.title || it.title.name)) || '' : String((it && it.title) || ''));
          const desc = (it && typeof it.desc === 'string') ? it.desc : (it && typeof it.desc === 'object' ? (it.desc && (it.desc.description || '')) || '' : String((it && it.desc) || ''));
          const img = it && it.img ? String(it.img) : '';
          const album = it && it.album ? String(it.album) : '';
          const price = (it && (it.price !== undefined && it.price !== null)) ? Number(it.price) || 0 : 0;
          const quantity = it && it.quantity && Number(it.quantity) ? Number(it.quantity) : 1;
          return Object.assign({}, it || {}, { id, title, desc, img, album, price, quantity });
        });
        if (JSON.stringify(raw) !== JSON.stringify(norm)) {
          setWishlist(norm);
        }
      }
      try { if (typeof renderAlbumWishlistHeart === 'function') renderAlbumWishlistHeart(); } catch {}
      try { updateHeaderWishlist(); } catch {}
    } catch (e) {
      // ignore migration failures
    }
  })();
  // id, title, desc, price, img, album, event
  // Centralised add/remove for wishlist. Optional 7th param `sale` may be provided.
  async function addToWishlistCentral(id, title, desc, price, img, album, e, _sale){
    try { if (e) e.stopPropagation(); } catch {}
    try {
  // Normalize inputs to avoid storing non-string titles/descriptions (which caused details objects to show)
  title = (typeof title === 'string') ? title : (title && typeof title === 'object' ? (title.title || title.name || '') : String(title || ''));
  desc = (typeof desc === 'string') ? desc : (desc && typeof desc === 'object' ? (desc.description || '') : String(desc || ''));
  img = img ? String(img) : '';
  price = (price === undefined || price === null) ? 0 : Number(price) || 0;
  // Attempt to extract sale metadata when provided as data attribute string or passed in
  let sale = _sale || null;
  try {
    // if a sale param was passed, prefer it; otherwise try to infer from title/desc
    if (!sale) {
      if (typeof title === 'object' && title && title.sale) sale = title.sale; // defensive
      else if (typeof desc === 'object' && desc && desc.sale) sale = desc.sale;
    }
  } catch(e){}
  album = album ? String(album) : '';

  const wishlist = getWishlist();
      const idx = wishlist.findIndex(it => it.id === id || it.gallery === id);
  // If adding and no sale provided, try to fetch latest product to obtain sale metadata
  if (idx === -1 && !sale) {
    try {
  const url = (typeof backendBase !== 'undefined' ? backendBase : 'http://localhost:3026') + '/api/products/' + encodeURIComponent(id);
      if (typeof fetch !== 'undefined') {
        const res = await fetch(url, { method: 'GET', credentials: 'same-origin', headers: { 'Accept': 'application/json' } });
        if (res && res.ok) {
                const p = await safeJson(resp);
          if (p && p.sale && p.sale.active && Number(p.sale.price) > 0) {
            sale = p.sale;
          }
        }
      }
    } catch (e) { /* ignore */ }
  }
  if (idx === -1) wishlist.push({ id, title, desc, price, img, album, sale }); else wishlist.splice(idx, 1);
  setWishlist(wishlist);
  renderAlbumWishlistHeart();
  try { updateHeaderWishlist(); } catch {}
  // If user is authenticated, attempt to persist change to server as well
  try {
    const token = localStorage.getItem('authToken') || '';
    if (token) {
      // If we just added the item (idx === -1 before), POST to server; otherwise DELETE
      if (idx === -1) {
        // Fire-and-forget add
        fetch((typeof backendBase !== 'undefined' ? backendBase : '') + '/api/wishlist', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + token },
          body: JSON.stringify({ productId: id, title: title || '', price: price || 0, img: img || '', album: album || '' })
        }).catch(err => console.warn('Failed to sync wishlist add to server', err));
      } else {
        // Fire-and-forget remove
        fetch((typeof backendBase !== 'undefined' ? backendBase : '') + '/api/wishlist/' + encodeURIComponent(id), {
          method: 'DELETE',
          headers: { 'Authorization': 'Bearer ' + token }
        }).catch(err => console.warn('Failed to sync wishlist remove to server', err));
      }
    }
  } catch (err) { /* ignore */ }
    } catch {}
  }
  function renderAlbumWishlistHeart(){
    document.querySelectorAll('.wishlist-heart').forEach(function(heart){
      // Prefer productid dataset for stable mapping
      const id = heart && heart.dataset ? (heart.dataset.wishlistProductid || heart.dataset.wishlistId || heart.dataset.id) : null;
      const svg = heart.querySelector && heart.querySelector('svg');
      if (!id || !svg) return;
      if (isInWishlistId(id)) svg.classList.add('heart-filled'); else svg.classList.remove('heart-filled');
    });
  }
  // Debounced processing to avoid duplicate toggles from touch -> click sequences
  const __dm_recentToggle = new WeakMap();
  function __dm_shouldProcess(el, windowMs){
    try{
      const now = Date.now();
      const last = __dm_recentToggle.get(el) || 0;
      if (now - last < (windowMs||700)) return false;
      __dm_recentToggle.set(el, now);
      return true;
    } catch(e){ return true; }
  }

  function __dm_processHeartElement(heart, e){
    if (!heart || !__dm_shouldProcess(heart)) return;
    const id = heart.dataset.wishlistProductid || heart.dataset.wishlistId || heart.dataset.id;
    if (!id) return;
    const title = heart.dataset.wishlistTitle || '';
    const desc = heart.dataset.wishlistDesc || '';
    const price = heart.dataset.wishlistPrice || 0;
    const img = heart.dataset.wishlistImg || '';
    const album = heart.dataset.wishlistAlbum || '';
    // Attempt to parse optional sale metadata from dataset and pass it through
    let sale = null;
    try {
      if (heart.dataset && heart.dataset.wishlistSale) {
        sale = JSON.parse(heart.dataset.wishlistSale);
      }
    } catch (err) { sale = null; }
    addToWishlistCentral(id, title, desc, price, img, album, e, sale);
  }

  // Delegate click handler for elements with data-wishlist-id (mouse and generic clicks)
  document.addEventListener('click', function(e){
    const target = e.target;
    const heart = target.closest && target.closest('.wishlist-heart');
    if (!heart) return;
    __dm_processHeartElement(heart, e);
  }, false);

  // Support pointer (touch) devices explicitly to avoid relying on synthesized click events
  document.addEventListener('pointerup', function(e){
    try{
      if (e.pointerType !== 'touch') return;
      const target = e.target;
      const heart = target.closest && target.closest('.wishlist-heart');
      if (heart) { __dm_processHeartElement(heart, e); return; }
    } catch(err){}
  }, false);
  // Support explicit 'Add to wishlist' buttons rendered on product detail pages
  document.addEventListener('click', function(e){
    const btn = e.target && e.target.closest && e.target.closest('.add-wishlist-btn');
    if (!btn) return;
    if (!__dm_shouldProcess(btn)) return;
    const id = btn.dataset.wishlistId || btn.dataset.id;
    if (!id) return;
    const title = btn.dataset.wishlistTitle || '';
    const desc = btn.dataset.wishlistDesc || '';
    const price = btn.dataset.wishlistPrice || 0;
    const img = btn.dataset.wishlistImg || '';
    const album = btn.dataset.wishlistAlbum || '';
    addToWishlistCentral(id, title, desc, price, img, album, e);
  }, false);

  // Also support pointerup for add-wishlist-btn on touch devices
  document.addEventListener('pointerup', function(e){
    try{
      if (e.pointerType !== 'touch') return;
      const btn = e.target && e.target.closest && e.target.closest('.add-wishlist-btn');
      if (!btn) return;
      if (!__dm_shouldProcess(btn)) return;
      const id = btn.dataset.wishlistId || btn.dataset.id;
      if (!id) return;
      const title = btn.dataset.wishlistTitle || '';
      const desc = btn.dataset.wishlistDesc || '';
      const price = btn.dataset.wishlistPrice || 0;
      const img = btn.dataset.wishlistImg || '';
      const album = btn.dataset.wishlistAlbum || '';
      addToWishlistCentral(id, title, desc, price, img, album, e);
    } catch(err){}
  }, false);
  function ensureResponsiveImageStyle(){
    if (document.getElementById('dm-responsive-img')) return;
    const style = document.createElement('style');
    style.id = 'dm-responsive-img';
    style.textContent = `
      /* Global responsive images */
      img { max-width: 100%; height: auto; }
      /* Common gallery/product cards */
      .gallery img, .knife-item img, .item img { width: 100%; height: auto; display: block; object-fit: contain; }
      /* Product detail thumbnail rail keeps square thumbs but responsive container already constrains width */
    `;
    document.head.appendChild(style);
  }
  async function ensureAdminUI(ctx){
    const me = await getCurrentUser();
    let bar = document.getElementById('dm-admin-bar');
    const existingFab = document.getElementById('dm-fab-add');
  if (!bar) {
      bar = el(`<div id=\"dm-admin-bar\" style=\"position:fixed;top:12px;right:12px;z-index:9999;background:#181c23;color:#fff;border:1px solid #2a2f3a;border-radius:999px;padding:6px 10px;display:flex;gap:8px;align-items:center;box-shadow:0 4px 16px #0006\"></div>`);
      document.body.appendChild(bar);
    }
  // Respect hidden state
  // Default hidden to true for non-admin visitors
  if (localStorage.getItem('admin_bar_hidden') === null) {
    try { localStorage.setItem('admin_bar_hidden','true'); } catch {}
  }
  const hidden = localStorage.getItem('admin_bar_hidden') === 'true';
  bar.style.display = hidden ? 'none' : 'flex';
    // Render bar content depending on auth
    if (!me || me.role !== 'admin') {
      bar.innerHTML = `<span style=\"font-weight:700;color:#ffb347;margin-left:6px\">Admin</span>
        <button id=\"dm-login\" title=\"Login\" style=\"border:1px solid #384152;background:#232737;color:#c9d1d9;border-radius:999px;padding:4px 10px;cursor:pointer\">Login</button>
        <button id=\"dm-hide\" title=\"Hide\" style=\"border:1px solid #384152;background:#232737;color:#c9d1d9;border-radius:999px;padding:4px 10px;cursor:pointer\">Hide</button>`;
      const loginBtn = document.getElementById('dm-login');
      loginBtn.onclick = ()=> openAdminLoginModal(ctx);
      document.getElementById('dm-hide').onclick = ()=>{ localStorage.setItem('admin_bar_hidden','true'); ensureAdminUI(ctx); };
      if (existingFab) existingFab.remove();
      window.__dm_adminMode = false; localStorage.removeItem('admin_mode');
      return false;
    }
    // Admin controls view
    bar.innerHTML = `<span style=\"font-weight:700;color:#ffb347;margin-left:6px\">Admin</span>
      <label style=\"display:flex;align-items:center;gap:6px;font-size:12px;cursor:pointer;margin-right:8px\">
        <input id=\"dm-admin-toggle\" type=\"checkbox\" ${localStorage.getItem('admin_mode')==='true'?'checked':''} /> Mode
      </label>
      <button id=\"dm-hide\" title=\"Hide\" style=\"border:1px solid #384152;background:#232737;color:#c9d1d9;border-radius:999px;padding:4px 10px;cursor:pointer\">Hide</button>
      <button id=\"dm-logout\" title=\"Logout\" style=\"border:1px solid #384152;background:#232737;color:#c9d1d9;border-radius:999px;padding:4px 10px;cursor:pointer\">Logout</button>`;
    document.getElementById('dm-admin-toggle').addEventListener('change', (e)=>{
      window.__dm_adminMode = !!e.target.checked;
      localStorage.setItem('admin_mode', String(window.__dm_adminMode));
      refreshCurrentView();
      ensureAdminUI(window.__dm_ctx||{});
    });
    document.getElementById('dm-hide').addEventListener('click', ()=>{ localStorage.setItem('admin_bar_hidden','true'); ensureAdminUI(ctx); });
    document.getElementById('dm-logout').addEventListener('click', ()=>{ localStorage.removeItem('adm_token'); localStorage.removeItem('admin_mode'); location.reload(); });
    window.__dm_adminMode = localStorage.getItem('admin_mode')==='true';
    // Floating Add FAB when in Admin Mode
    if (window.__dm_adminMode) {
      if (!document.getElementById('dm-fab-add')) {
        const fab = el(`<button id=\"dm-fab-add\" title=\"Add product\" style=\"position:fixed;bottom:18px;right:18px;width:56px;height:56px;border-radius:50%;border:0;background:linear-gradient(135deg,#4fc3f7,#0288d1);color:#fff;box-shadow:0 8px 24px #0288d177;cursor:pointer;z-index:9999;font-size:28px;display:flex;align-items:center;justify-content:center\">+</button>`);
        fab.addEventListener('click', ()=> openAddModal(ctx));
        document.body.appendChild(fab);
      }
    } else {
      if (existingFab) existingFab.remove();
    }
    return true;
  }

  function openAdminLoginModal(ctx){
    const modal = el(`
      <div id=\"dm-login-modal\" style=\"position:fixed;inset:0;background:#0009;display:flex;align-items:center;justify-content:center;z-index:10000\">
        <div style=\"width:min(420px,92vw);background:#1c202a;color:#fff;border-radius:12px;border:1px solid #2a2f3a;padding:16px\">
          <div style=\"display:flex;justify-content:space-between;align-items:center;margin-bottom:10px\"><h3 style=\"margin:0\">Admin Login</h3><button style=\"border:0;background:#232737;color:#c9d1d9;border-radius:8px;padding:6px 10px;cursor:pointer\" onclick=\"document.getElementById('dm-login-modal').remove()\">Close</button></div>
          <div style=\"display:grid;gap:8px\">
            <input id=\"dm_l_email\" placeholder=\"Email\" />
            <input id=\"dm_l_pass\" placeholder=\"Password\" type=\"password\" value=\"\" />
            <button id=\"dm_l_btn\" style=\"padding:.5rem .8rem;border-radius:8px;background:#ffd166;color:#181a20;font-weight:700;border:1px solid #ffda79\">Login</button>
            <div id=\"dm_l_msg\" style=\"color:#ff7575\"></div>
          </div>
        </div>
      </div>`);
    document.body.appendChild(modal);
    document.getElementById('dm_l_btn').addEventListener('click', async ()=>{
      const email = document.getElementById('dm_l_email').value.trim();
      const password = document.getElementById('dm_l_pass').value;
      const msg = document.getElementById('dm_l_msg'); msg.textContent='';
      try{
        const r = await fetch(backendBase + '/api/auth/login', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ email, password }) });
  if (!r.ok) { msg.textContent = 'Login failed'; return }
  const data = await safeJson(r);
        localStorage.setItem('adm_token', data.token);
        document.getElementById('dm-login-modal')?.remove();
        // Enable admin mode by default and show UI
        localStorage.setItem('admin_mode','true');
        window.__dm_adminMode = true;
        ensureAdminUI(ctx);
        refreshCurrentView();
      } catch { msg.textContent = 'Error logging in'; }
    });
  }
  // Configurable admin activation chord (default: Ctrl+Alt+Shift+P)
  // Priority for config: localStorage 'admin_shortcut' -> /server/data/dev-config.json (if present) -> default
  let __dm_adminShortcut = { ctrl: true, alt: true, shift: true, meta: false, key: 'p' };
  function parseShortcutString(s) {
    try {
      if (!s || typeof s !== 'string') return null;
      const parts = s.split('+').map(p => p.trim().toLowerCase());
      const cfg = { ctrl: false, alt: false, shift: false, meta: false, key: '' };
      parts.forEach(part => {
        if (part === 'ctrl' || part === 'control') cfg.ctrl = true;
        else if (part === 'alt' || part === 'option') cfg.alt = true;
        else if (part === 'shift') cfg.shift = true;
        else if (part === 'meta' || part === 'cmd' || part === 'win') cfg.meta = true;
        else if (part.length === 1) cfg.key = part;
        else cfg.key = part; // accept full names like 'enter' (not used here)
      });
      if (!cfg.key) return null;
      return cfg;
    } catch (e) { return null; }
  }

  // Try to load from localStorage first
  try {
    const s = localStorage.getItem('admin_shortcut');
    const p = parseShortcutString(s);
    if (p) __dm_adminShortcut = p;
  } catch(e) {}

  // Attempt to read dev-config file (best-effort; non-blocking)
  (async function tryLoadDevConfig(){
    try {
      const res = await fetch('/server/data/dev-config.json', { cache: 'no-store' });
  if (!res.ok) return;
  const json = await safeJson(res);
      if (json && json.admin_shortcut) {
        const p = parseShortcutString(String(json.admin_shortcut));
        if (p) __dm_adminShortcut = p;
      }
    } catch (e) {
      // silent
    }
  })();

  // Key handler: compare event to configured chord
  document.addEventListener('keydown', (e)=>{
    try {
      if (!e || !e.key) return;
      const k = String(e.key).toLowerCase();
      const cfg = __dm_adminShortcut;
      if (!cfg || !cfg.key) return;
      // Match modifier booleans strictly
      if (!!e.ctrlKey !== !!cfg.ctrl) return;
      if (!!e.altKey !== !!cfg.alt) return;
      if (!!e.shiftKey !== !!cfg.shift) return;
      if (!!e.metaKey !== !!cfg.meta) return;
      // Key match
      if (k !== cfg.key) return;
      e.preventDefault();
      // Activate admin bar and toggle mode (or prompt login)
      localStorage.setItem('admin_bar_hidden','false');
      const loggedIn = isAdminLoggedIn();
      if (!loggedIn) { openAdminLoginModal(window.__dm_ctx||{}); return; }
      const current = localStorage.getItem('admin_mode')==='true';
      localStorage.setItem('admin_mode', String(!current));
      window.__dm_adminMode = !current;
      ensureAdminUI(window.__dm_ctx||{});
      refreshCurrentView();
    } catch (err) { /* ignore */ }
  });
  function guessCategoryFromPage(){
    const file = location.pathname.split('/').pop().toLowerCase();
    if (file.includes('axes')) return 'axes';
    if (file.includes('rings')) return 'rings';
    if (file.includes('swords')) return 'swords';
    if (file.includes('pocket')) return 'pocket-knives';
    if (file.includes('hunting')) return 'hunting-knives';
    if (file.includes('kitchen')) return 'kitchen-knives';
    if (file.includes('others')) return 'others';
    return '';
  }
  document.addEventListener('DOMContentLoaded', function(){
    // Always mount Admin UI early with a best-effort context
    const cat0 = guessCategoryFromPage();
    const ctx0 = cat0 ? { type:'album', key:cat0 } : { type:'page', key: location.pathname.split('/').pop() };
    window.__dm_ctx = ctx0;
    // Attempt a safe, local-only auto-login to enable Admin Mode for development
    // This will only run on localhost or file:// and only if no adm_token exists.
    // Auto-login disabled: no client-side credential candidates will be attempted for safety.
    (async function tryAutoAdmin(){
      try{
        // Intentionally left empty to prevent accidental exposure or use of credentials in the browser.
      } catch (e) {}
      // Ensure admin bar is mounted without attempting login
      ensureAdminUI(ctx0);
    })();
  ensureResponsiveImageStyle();

    const container = document.querySelector('.gallery');
    const cat = cat0;
    if (container) {
      if (cat) renderProductsForAlbum(cat);
      else renderProductsForPage(location.pathname.split('/').pop());
    }
  // Sync header heart/badge on initial load
  try { updateHeaderWishlist(); } catch {}
  });
 
})();
