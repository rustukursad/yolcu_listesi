/* Liste Güncelleme — arayüz */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const $$ = s => Array.from(document.querySelectorAll(s));
  const esc = v => String(v === null || v === undefined ? '' : (v instanceof Date ? v.toLocaleDateString('tr-TR') : v))
    .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const MAX_ROWS = 1500;
  /* Ortam (Chrome uzantısı / Outlook eklentisi) bu nesneyle yeteneklerini bildirir */
  const H = window.LGHost || {};

  /* ── Depolama (chrome.storage, yoksa localStorage) ─────── */
  const hasChrome = typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local;
  const store = H.store || {
    async get(k, d) {
      if (hasChrome) { const o = await chrome.storage.local.get(k); return o[k] === undefined ? d : o[k]; }
      try { const v = localStorage.getItem('lg_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; }
    },
    async set(k, v) {
      if (hasChrome) return chrome.storage.local.set({ [k]: v });
      try { localStorage.setItem('lg_' + k, JSON.stringify(v)); } catch (e) { /* */ }
    },
  };

  function toast(msg, err) {
    const t = $('#toast'); t.textContent = msg; t.className = 'show' + (err ? ' err' : '');
    clearTimeout(toast._t); toast._t = setTimeout(() => { t.className = ''; }, err ? 6000 : 2600);
  }

  /* ── Sekmeler ───────────────────────────────────────────── */
  $$('#tabs button').forEach(b => b.addEventListener('click', () => {
    $$('#tabs button').forEach(x => x.classList.toggle('on', x === b));
    $$('.tab').forEach(t => t.classList.toggle('on', t.id === 'tab-' + b.dataset.tab));
  }));

  /* ── Profiller ─────────────────────────────────────────── */
  const BUILTIN = {
    sync: { 'EKOL': { mmap: { id: 'Sicil No', ad: 'Adı', soyad: 'Soyadı', tel: 'Tel', adres: 'Adresi', durak: 'Kısa Adres', departman: 'Departman', gkodu: 'G.Kodu', guzergah: 'Güzergah Adı' },
      smap: { id: 'SAP NO', adsoyad: 'ADI-SOYADI', tel: 'TELEFON', adres: 'ADRES', gkodu: 'SERVİS KODU', guzergah: 'BÖLGE' } } },
    stops: {},
  };
  let profiles = { sync: {}, stops: {} };
  async function loadProfiles() {
    const p = await store.get('profiles', null);
    profiles = p || { sync: {}, stops: {} };
    for (const k of ['sync', 'stops']) for (const [n, v] of Object.entries(BUILTIN[k])) if (!profiles[k][n]) profiles[k][n] = JSON.parse(JSON.stringify(v));
    fillProfileSelect('sync'); fillProfileSelect('stops'); renderProfileList();
  }
  async function saveProfiles() { await store.set('profiles', profiles); fillProfileSelect('sync'); fillProfileSelect('stops'); renderProfileList(); }
  async function fillProfileSelect(kind) {
    const sel = $('#' + kind + '-profile');
    const cur = sel.value || await store.get('lastProfile_' + kind, kind === 'sync' ? 'EKOL' : '');
    sel.innerHTML = '<option value="">(otomatik algıla)</option>' + Object.keys(profiles[kind]).sort().map(n => `<option>${esc(n)}</option>`).join('');
    sel.value = profiles[kind][cur] ? cur : '';
  }
  function renderProfileList() {
    const rows = [];
    for (const kind of ['sync', 'stops']) for (const n of Object.keys(profiles[kind]).sort()) {
      rows.push(`<div><span><b>${esc(n)}</b> <span class="tag gray">${kind === 'sync' ? 'Yolcu listesi' : 'Durak'}</span></span><button class="ghost" data-del="${esc(kind)}|${esc(n)}">Sil</button></div>`);
    }
    $('#profile-list').innerHTML = rows.length ? '<div class="plist">' + rows.join('') + '</div>' : '<p class="hint">Kayıtlı profil yok.</p>';
    $$('#profile-list [data-del]').forEach(b => b.addEventListener('click', async () => {
      const [k, n] = b.dataset.del.split('|');
      if (!confirm(`"${n}" profili silinsin mi?`)) return;
      delete profiles[k][n]; await saveProfiles(); toast('Profil silindi');
    }));
  }
  async function askSaveProfile(kind, maps) {
    const sel = $('#' + kind + '-profile');
    const name = (prompt('Profil adı (ör. EKOL, AKPRES):', sel.value || '') || '').trim().toLocaleUpperCase('tr-TR');
    if (!name) return;
    profiles[kind][name] = JSON.parse(JSON.stringify(maps));
    await saveProfiles(); sel.value = name; await store.set('lastProfile_' + kind, name);
    toast(`"${name}" profili kaydedildi`);
  }
  $('#prof-export').addEventListener('click', () => {
    download(new Blob([JSON.stringify(profiles, null, 2)], { type: 'application/json' }), 'liste_guncelleme_profiller.json');
  });
  $('#prof-import').addEventListener('change', async e => {
    try {
      const p = JSON.parse(await e.target.files[0].text());
      for (const k of ['sync', 'stops']) Object.assign(profiles[k], (p && p[k]) || {});
      await saveProfiles(); toast('Profiller içe aktarıldı');
    } catch (err) { toast('Profil dosyası okunamadı: ' + err.message, true); }
    e.target.value = '';
  });

  /* Profil haritası + başlıklar → geçerli harita (eksikleri otomatik doldur) */
  function resolveMap(headers, fields, profMap) {
    const auto = LG.autoMap(headers, fields);
    if (!profMap) return auto;
    const out = {}, used = new Set();
    for (const d of fields) {
      const want = profMap[d.f];
      if (want && headers.includes(want)) { out[d.f] = want; used.add(want); }
    }
    for (const d of fields) if (!out[d.f] && !(d.f in profMap) && auto[d.f] && !used.has(auto[d.f])) { out[d.f] = auto[d.f]; used.add(auto[d.f]); }
    return out;
  }

  /* ── Dosya bırakma alanları ────────────────────────────── */
  function makeDrop(el, onFile) {
    const inp = el.querySelector('input');
    el.addEventListener('click', () => inp.click());
    inp.addEventListener('change', () => { if (inp.files[0]) onFile(inp.files[0]); inp.value = ''; });
    el.addEventListener('dragover', e => { e.preventDefault(); el.classList.add('over'); });
    el.addEventListener('dragleave', () => el.classList.remove('over'));
    el.addEventListener('drop', e => { e.preventDefault(); el.classList.remove('over'); if (e.dataTransfer.files[0]) onFile(e.dataTransfer.files[0]); });
  }

  /* Dosya yüklenince: sayfa seçici + rozet */
  function badge(el, src, onSheet) {
    const sheets = src.sheets;
    const sel = sheets.length > 1 ? `<select>${sheets.map((s, i) => `<option value="${i}"${i === src.sheetIdx ? ' selected' : ''}>${esc(s.name)} (${s.rows.length})</option>`).join('')}</select>` : '';
    el.innerHTML = `<span class="ok">✓</span> <b>${esc(src.fileName)}</b> ${sel} <span class="hint">${src.table.rows.length} satır · ${src.table.headers.length} sütun</span>`;
    const s = el.querySelector('select');
    if (s) s.addEventListener('change', () => { src.sheetIdx = +s.value; src.table = sheets[src.sheetIdx]; badge(el, src, onSheet); onSheet(); });
  }
  async function loadInto(target, file, badgeEl, after) {
    try {
      /* file: tarayıcı File nesnesi ya da { name, read: async () => ArrayBuffer } (mail eki) */
      const sheets = (typeof File !== 'undefined' && file instanceof File) ? await LG.readFile(file) : await LG.readBuffer(await file.read(), file.name);
      if (!sheets.length) throw new Error('Dosyada tablo bulunamadı.');
      /* En çok satırlı sayfayı varsayılan seç */
      let idx = 0; sheets.forEach((s, i) => { if (s.rows.length > sheets[idx].rows.length) idx = i; });
      Object.assign(target, { fileName: file.name, sheets, sheetIdx: idx, table: sheets[idx] });
      badge(badgeEl, target, after); after();
    } catch (e) { console.error(e); toast(e.message || String(e), true); }
  }

  /* Dar panelde (Outlook) eşleme kapalı başlar; boş kalan zorunlu alan varsa açık kalır */
  function collapseMapIfNarrow(card) {
    const det = $(card + ' .mapdet');
    if (!det) return;
    const narrow = window.innerWidth < 620;
    const missing = card === '#map-card' ? !((S.mmap.ad || S.mmap.adsoyad) && (S.smap.ad || S.smap.adsoyad)) : !(D.omap.durak || D.omap.lat || D.omap.koord);
    det.open = !narrow || missing;
  }

  /* ── Sütun eşleme arayüzü ──────────────────────────────── */
  function renderMap(container, fields, table, map, onChange) {
    const headers = table.headers;
    const sample = h => { for (const r of table.rows.slice(0, 30)) { const v = r[h]; if (LG.str(v instanceof Date ? 'x' : v)) return v; } return ''; };
    container.innerHTML = fields.map(d => `
      <label for="m-${container.id}-${d.f}">${esc(d.label)}</label>
      <select id="m-${container.id}-${d.f}" data-f="${d.f}"><option value="">— yok —</option>${headers.map(h => `<option${map[d.f] === h ? ' selected' : ''}>${esc(h)}</option>`).join('')}</select>
      <div class="sample" data-s="${d.f}">${map[d.f] ? 'örn: ' + esc(sample(map[d.f])) : ''}</div>`).join('');
    container.querySelectorAll('select').forEach(s => s.addEventListener('change', () => {
      if (s.value) map[s.dataset.f] = s.value; else delete map[s.dataset.f];
      container.querySelector(`[data-s="${s.dataset.f}"]`).textContent = s.value ? 'örn: ' + LG.str(sample(s.value) instanceof Date ? sample(s.value).toLocaleDateString('tr-TR') : sample(s.value)) : '';
      onChange && onChange();
    }));
  }

  /* ═══════════ YOLCU LİSTESİ ═══════════ */
  const S = { main: null, src: null, mmap: {}, smap: {}, res: null, view: 'changes' };

  function syncReady() {
    if (!S.main || !S.src || !S.main.table || !S.src.table) return;
    const prof = profiles.sync[$('#sync-profile').value];
    S.mmap = resolveMap(S.main.table.headers, LG.MAIN_FIELDS, prof && prof.mmap);
    S.smap = resolveMap(S.src.table.headers, LG.SRC_FIELDS, prof && prof.smap);
    renderMap($('#map-main'), LG.MAIN_FIELDS, S.main.table, S.mmap);
    renderMap($('#map-src'), LG.SRC_FIELDS, S.src.table, S.smap);
    $('#map-card').hidden = false;
    $('#sync-result').hidden = true;
    collapseMapIfNarrow('#map-card');
  }
  makeDrop($('#drop-main'), f => loadInto(S.main = {}, f, $('#badge-main'), syncReady));
  makeDrop($('#drop-src'), f => loadInto(S.src = {}, f, $('#badge-src'), syncReady));
  $('#gs-load').addEventListener('click', async () => {
    const url = $('#gs-url').value.trim(); if (!url) return;
    $('#gs-load').disabled = true;
    try {
      const sheets = await LG.readGSheet(url);
      S.src = { fileName: 'Google Sheets', sheets, sheetIdx: 0, table: sheets[0] };
      await store.set('lastGs', url);
      badge($('#badge-src'), S.src, syncReady); syncReady();
    } catch (e) { toast(e.message, true); }
    $('#gs-load').disabled = false;
  });
  $('#sync-profile').addEventListener('change', async () => { await store.set('lastProfile_sync', $('#sync-profile').value); syncReady(); });
  $('#sync-save-profile').addEventListener('click', () => {
    if (!S.main || !S.src || !S.main.table || !S.src.table) return toast('Önce iki dosyayı da yükleyin', true);
    askSaveProfile('sync', { mmap: S.mmap, smap: S.smap, opts: syncOpts() });
  });
  $('#opt-addr').addEventListener('input', () => { $('#opt-addr-v').textContent = (+$('#opt-addr').value).toFixed(2); });
  const syncOpts = () => ({ addrThreshold: +$('#opt-addr').value, matchByName: $('#opt-name').checked, matchByPhone: $('#opt-phone').checked });

  $('#sync-run').addEventListener('click', () => {
    const hasName = S.mmap.adsoyad || S.mmap.ad, hasNameS = S.smap.adsoyad || S.smap.ad;
    if (!hasName || !hasNameS) return toast('Her iki taraf için de ad (ya da ad soyad) sütunu seçilmeli', true);
    if (!S.mmap.id && !S.mmap.tel) toast('Uyarı: yolcu listesinde sicil ve telefon yok, yalnız isimle eşleşecek', true);
    try {
      S.res = LG.runSync(S.main.table.rows, S.src.table.rows, S.mmap, S.smap, syncOpts());
      renderSyncStats(); S.view = 'changes';
      $$('#sync-subtabs button').forEach(b => b.classList.toggle('on', b.dataset.v === 'changes'));
      renderSyncView();
      $('#sync-result').hidden = false;
      $('#sync-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { console.error(e); toast('Hata: ' + e.message, true); }
  });

  function renderSyncStats() {
    const st = S.res.stats;
    const c = (cls, n, t) => `<div class="stat ${cls}"><b>${n}</b><span>${t}</span></div>`;
    $('#sync-stats').innerHTML =
      c('', st.main, 'Yolcu listesi') + c('', st.src, 'Kaynak') +
      c('red', st.removed, 'Çıkacak (kırmızı)') + c('green', st.added, 'Yeni eklenen') +
      c('blue', st.updated, 'Güncellenen kişi') + c('orange', st.midChanges, 'Kontrol gereken değişiklik') +
      c('blue', st.routeChanges, 'Güzergah/durak değişen') + c(st.ilceWarnings ? 'red' : '', st.ilceWarnings, 'İlçe değiştiren') +
      c('', st.idChanges, 'Sicil güncellenen') + c('', S.res.warnings.length + S.res.dups.length, 'Uyarı / mükerrer');
  }

  $$('#sync-subtabs button').forEach(b => b.addEventListener('click', () => {
    S.view = b.dataset.v;
    $$('#sync-subtabs button').forEach(x => x.classList.toggle('on', x === b));
    renderSyncView();
  }));
  $('#chg-filter').addEventListener('change', renderSyncView);
  let searchT; $('#sync-search').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(renderSyncView, 150); });

  const confTag = c => ({ id: '<span class="tag high">Sicil</span>', both: '<span class="tag high">İsim+tel</span>', name: '<span class="tag mid">İsim</span>', phone: '<span class="tag mid">Telefon</span>' }[c] || '');
  const lvlTag = l => l === 'high' ? '<span class="tag high">Kesin</span>' : '<span class="tag mid">Kontrol</span>';
  const matchQ = (q, ...vals) => !q || vals.some(v => LG.key(v).includes(q));

  function renderSyncView() {
    const R = S.res; if (!R) return;
    const q = LG.key($('#sync-search').value);
    const filt = $('#chg-filter').value;
    $('#chg-filter').style.display = S.view === 'changes' ? '' : 'none';
    let html = '', hint = '';
    if (S.view === 'changes') {
      hint = 'İşareti kaldırdığın değişiklik Excel\'e uygulanmaz (DEĞİŞİKLİKLER sayfasında “Uygulanmadı” olarak kalır).';
      const list = R.changes.filter(c => (!filt || (filt === 'mid' ? c.level === 'mid' : c.kind === filt)) && matchQ(q, c.name, c.id, c.old, c.val));
      html = table(['', 'Ad Soyad', 'Sicil', 'Alan', 'Eski', 'Yeni', 'Güven', 'Eşleşme'], list.slice(0, MAX_ROWS).map((c, i) => {
        const idx = R.changes.indexOf(c);
        return `<tr class="${c.skip ? 'skip' : ''}"><td><input type="checkbox" data-chg="${idx}"${c.skip ? '' : ' checked'}></td><td>${esc(c.name)}</td><td>${esc(c.id)}</td><td>${esc(LG.FIELD_TXT[c.field] || c.field)}${c.ratio !== undefined ? ` <span class="hint">(%${Math.round(c.ratio * 100)} benzer)</span>` : ''}</td><td class="old">${esc(c.old) || '<span class="hint">(boş)</span>'}</td><td class="new">${esc(c.val)}</td><td>${lvlTag(c.level)}</td><td>${confTag(c.conf)}</td></tr>`;
      }), list.length);
    } else if (S.view === 'removed') {
      hint = 'Kaynakta karşılığı bulunamayan kişiler. İşareti kaldırırsan satır kırmızıya boyanmaz.';
      const list = R.rows.filter(r => r.status === 'removed' && matchQ(q, r.m.nameDisp, r.m.id, r.m.guzergah, r.m.tel));
      html = table(['', 'Ad Soyad', 'Sicil', 'Telefon', 'Güzergah', 'Durak'], list.slice(0, MAX_ROWS).map(r =>
        `<tr class="${r.skip ? 'skip' : ''}"><td><input type="checkbox" data-rem="${r.rn}"${r.skip ? '' : ' checked'}></td><td>${esc(r.m.nameDisp)}</td><td>${esc(r.m.id)}</td><td>${esc(r.m.tel)}</td><td>${esc(LG.clean(r.m.gkodu ? r.m.gkodu + ' ' + r.m.guzergah : r.m.guzergah))}</td><td>${esc(r.m.durak)}</td></tr>`), list.length);
    } else if (S.view === 'added') {
      hint = 'Excel\'de “YENİ EKLENENLER” sayfasına bu formatta yazılır. Ad/soyad ayrımı ve cinsiyet tahmini otomatik; yanlışsa Ayarlar\'dan sözlüğe ekle.';
      const nl = LG.newListRows(R.added, R.smap);
      const list = R.added.map((s, i) => ({ s, o: nl[i] })).filter(x => matchQ(q, x.s.nameDisp, x.s.id, x.s.guzergah, x.s.tel));
      html = table(['', 'Cinsiyet', 'Sicil', 'Adı', 'Soyadı', 'Tel', 'Adres', 'Durak', 'G.Kodu', 'Güzergah'], list.slice(0, MAX_ROWS).map(({ s, o }) =>
        `<tr class="${s.skip ? 'skip' : ''}"><td><input type="checkbox" data-add="${s.rn}"${s.skip ? '' : ' checked'}></td><td>${esc(o['Cinsiyet']) || '<span class="tag yel">?</span>'}</td><td>${esc(o['Sicil No'])}</td><td>${esc(o['Adı'])}</td><td>${esc(o['Soyadı'])}</td><td>${esc(o['Tel'])}</td><td>${esc(o['Adresi'])}</td><td>${esc(o['Kısa Adres'])}</td><td>${esc(o['G.Kodu'])}</td><td>${esc(o['Güzergah Adı'])}</td></tr>`), list.length);
    } else if (S.view === 'routes') {
      hint = 'Önce: mevcut listedeki kişi sayısı. Sonra: çıkanlar düşülüp yeni eklenenler ve güzergah değiştirenler eklendikten sonraki sayı.';
      const list = R.routeSummary.filter(g => matchQ(q, g.route, g.code));
      const n = v => `<td class="num">${v || ''}</td>`;
      html = table(['Güzergah', 'Kod', 'Önce', 'Çıkan', 'Başka güz. geçen', 'Başka güz. gelen', 'Yeni', 'Sonra', 'Fark'], list.map(g =>
        `<tr><td><b>${esc(g.route)}</b></td><td>${esc(g.code)}</td>${n(g.before)}${n(g.removed)}${n(g.movedOut)}${n(g.movedIn)}${n(g.added)}<td class="num"><b>${g.after}</b></td><td class="num ${g.diff > 0 ? 'pos' : g.diff < 0 ? 'neg' : ''}">${g.diff > 0 ? '+' : ''}${g.diff || ''}</td></tr>`), list.length);
    } else if (S.view === 'warnings') {
      hint = 'İlçe değişimi güzergahı etkileyebilir; aynı telefon/farklı isim ve mükerrer kayıtlar elle kontrol edilmeli.';
      const w = R.warnings.filter(x => matchQ(q, x.name, x.text, x.type)).map(x =>
        `<tr><td>${x.severity === 'high' ? '<span class="tag red">Yüksek</span>' : '<span class="tag yel">Orta</span>'}</td><td><b>${esc(x.type)}</b></td><td>${esc(x.name)}</td><td>${esc(x.text)}</td></tr>`);
      const d = R.dups.filter(x => matchQ(q, ...x.rows.map(r => r.name))).map(x =>
        `<tr><td><span class="tag yel">Orta</span></td><td><b>MÜKERRER</b> <span class="hint">${esc(x.side)} · ${esc(x.tier)}</span></td><td>${esc(x.rows.map(r => r.name).join(' / '))}</td><td>${esc(x.rows.map(r => [r.tel, r.id && 'sicil ' + r.id, r.guzergah].filter(Boolean).join(' ')).join('  |  '))}</td></tr>`);
      html = table(['Önem', 'Tür', 'Kişi', 'Açıklama'], w.concat(d), w.length + d.length);
    }
    $('#sync-viewhint').textContent = hint;
    $('#sync-table').innerHTML = html; labelize($('#sync-table'));
    $$('#sync-table [data-chg]').forEach(cb => cb.addEventListener('change', () => { R.changes[+cb.dataset.chg].skip = !cb.checked; syncSkipToRows(); cb.closest('tr').classList.toggle('skip', !cb.checked); }));
    $$('#sync-table [data-rem]').forEach(cb => cb.addEventListener('change', () => { R.rows.find(r => r.rn === +cb.dataset.rem).skip = !cb.checked; cb.closest('tr').classList.toggle('skip', !cb.checked); }));
    $$('#sync-table [data-add]').forEach(cb => cb.addEventListener('change', () => { R.added.find(s => s.rn === +cb.dataset.add).skip = !cb.checked; cb.closest('tr').classList.toggle('skip', !cb.checked); }));
  }
  /* changes[] ile rows[].ch aynı nesneleri değil kopyaları tutar → skip'i eşitle */
  function syncSkipToRows() {
    const R = S.res;
    for (const c of R.changes) {
      const row = R.rows.find(r => r.rn === c.rn);
      const t = row && row.ch.find(x => x.field === c.field);
      if (t) t.skip = c.skip;
    }
  }
  function table(cols, rows, total) {
    if (!rows.length) return '<div class="empty">Kayıt yok</div>';
    const more = total > rows.length ? `<div class="empty">İlk ${rows.length} satır gösteriliyor (toplam ${total}). Tamamı Excel'de.</div>` : '';
    return `<table><thead><tr>${cols.map(c => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>${more}`;
  }

  async function syncOutput() {
    syncSkipToRows();
    const wb = await LG.buildSyncWorkbook(S.res, S.main.table, S.main.table.name);
    const base = S.main.fileName.replace(/\.(xlsx|csv|xls)$/i, '');
    return { blob: await LG.wbToBlob(wb), name: `${base}_GUNCELLENDI_${today()}.xlsx` };
  }
  function syncSummaryHtml() {
    const st = S.res.stats;
    return `<p>Merhaba,</p><p>Güncellenmiş yolcu listesi ektedir.</p><ul>` +
      `<li>Çıkacak: ${st.removed}</li><li>Yeni eklenen: ${st.added}</li><li>Güncellenen kişi: ${st.updated}</li>` +
      `<li>Güzergah/durak değişen: ${st.routeChanges}</li><li>İlçe değiştiren: ${st.ilceWarnings}</li></ul>` +
      `<p>Renkler: kırmızı satır çıkacak, yeşil hücre kesin değişiklik, turuncu hücre kontrol edilmeli.</p>`;
  }
  busyButton('#sync-download', 'Excel indir', async () => { const o = await syncOutput(); download(o.blob, o.name); });

  /* ═══════════ DURAK LİSTESİ ═══════════ */
  const D = { old: null, new: null, omap: {}, nmap: {}, res: null, view: 'items' };
  function stopsReady() {
    if (!D.old || !D.new || !D.old.table || !D.new.table) return;
    const prof = profiles.stops[$('#stops-profile').value];
    D.omap = resolveMap(D.old.table.headers, LG.STOP_FIELDS, prof && prof.omap);
    D.nmap = resolveMap(D.new.table.headers, LG.STOP_FIELDS, prof && (prof.nmap || prof.omap));
    renderMap($('#map-old'), LG.STOP_FIELDS, D.old.table, D.omap);
    renderMap($('#map-new'), LG.STOP_FIELDS, D.new.table, D.nmap);
    $('#smap-card').hidden = false; $('#stops-result').hidden = true;
    collapseMapIfNarrow('#smap-card');
  }
  makeDrop($('#drop-old'), f => loadInto(D.old = {}, f, $('#badge-old'), stopsReady));
  makeDrop($('#drop-new'), f => loadInto(D.new = {}, f, $('#badge-new'), stopsReady));
  $('#stops-profile').addEventListener('change', async () => { await store.set('lastProfile_stops', $('#stops-profile').value); stopsReady(); });
  $('#stops-save-profile').addEventListener('click', () => {
    if (!D.old || !D.new || !D.old.table || !D.new.table) return toast('Önce iki dosyayı da yükleyin', true);
    askSaveProfile('stops', { omap: D.omap, nmap: D.nmap });
  });
  $('#stops-run').addEventListener('click', () => {
    if (!D.omap.durak && !(D.omap.lat || D.omap.koord)) return toast('Durak adı ya da koordinat sütunu seçilmeli', true);
    try {
      D.res = LG.runStops(D.old.table.rows, D.new.table.rows, D.omap, D.nmap, { minMoveM: +$('#opt-move').value || 50, renameRadiusM: +$('#opt-rename').value || 120 });
      const st = D.res.stats;
      const c = (cls, n, t) => `<div class="stat ${cls}"><b>${n}</b><span>${t}</span></div>`;
      $('#stops-stats').innerHTML = c('', st.old, 'Eski listede durak') + c('', st.new, 'Yeni listede durak') + c('green', st.added, 'Eklenen') + c('red', st.removed, 'Kalkan') +
        c('orange', st.timeChanged, 'Saati değişen') + c('orange', st.moved, 'Konumu değişen') + c('blue', st.renamed, 'Adı değişen') + c('', st.same, 'Aynı kalan');
      D.view = 'items'; $$('#stops-subtabs button').forEach(b => b.classList.toggle('on', b.dataset.v === 'items'));
      renderStopsView(); $('#stops-result').hidden = false;
      $('#stops-result').scrollIntoView({ behavior: 'smooth', block: 'start' });
    } catch (e) { console.error(e); toast('Hata: ' + e.message, true); }
  });
  $$('#stops-subtabs button').forEach(b => b.addEventListener('click', () => {
    D.view = b.dataset.v; $$('#stops-subtabs button').forEach(x => x.classList.toggle('on', x === b)); renderStopsView();
  }));
  $('#stops-filter').addEventListener('change', renderStopsView);
  $('#stops-search').addEventListener('input', () => { clearTimeout(searchT); searchT = setTimeout(renderStopsView, 150); });
  function renderStopsView() {
    const R = D.res; if (!R) return;
    const q = LG.key($('#stops-search').value), f = $('#stops-filter').value;
    $('#stops-filter').style.display = D.view === 'items' ? '' : 'none';
    let html;
    if (D.view === 'items') {
      const ST = { added: '<span class="tag high">Eklendi</span>', removed: '<span class="tag red">Kalktı</span>', changed: '<span class="tag mid">Değişti</span>', same: '<span class="tag gray">Aynı</span>' };
      const list = R.items.filter(it => (f === 'all' || (!f && it.status !== 'same') || it.status === f || it.notes.some(n => n.t === f)) &&
        matchQ(q, it.route, it.o && it.o.durak, it.n && it.n.durak));
      html = table(['Güzergah', 'Durum', 'Eski', 'Yeni', 'Değişiklik'], list.slice(0, MAX_ROWS).map(it => {
        const side = s => s ? `${s.sira !== null ? s.sira + '. ' : ''}${esc(s.durak)} ${s.saat !== null ? '<b>' + LG.fmtMin(s.saat) + '</b>' : ''}` : '';
        return `<tr><td>${esc(it.route)}</td><td>${ST[it.status]}</td><td class="old">${side(it.o)}</td><td class="new">${side(it.n)}</td><td>${it.notes.map(n => `<span class="tag ${n.t === 'SAAT' || n.t === 'KONUM' ? 'mid' : 'blue'}">${esc(n.t)}</span> ${esc(n.d)}`).join('<br>')}</td></tr>`;
      }), list.length);
    } else {
      const ST = { 'YENİ': 'high', 'KALKTI': 'red', 'DEĞİŞTİ': 'mid', 'AYNI': 'gray' };
      const list = R.routeSummary.filter(g => matchQ(q, g.route));
      const n = v => `<td class="num">${v || ''}</td>`;
      html = table(['Güzergah', 'Durum', 'Durak önce', 'Durak sonra', 'Eklenen', 'Kalkan', 'Değişen', 'İlk durak', 'Son durak', 'Yolcu'], list.map(g =>
        `<tr><td><b>${esc(g.route)}</b></td><td><span class="tag ${ST[g.status]}">${g.status}</span></td>${n(g.before)}${n(g.after)}${n(g.added)}${n(g.removed)}${n(g.changed)}<td>${esc(g.firstOldT)}${g.firstOldT !== g.firstNewT ? ' → <b>' + esc(g.firstNewT) + '</b>' + (g.firstDelta ? ` <span class="${g.firstDelta < 0 ? 'neg' : 'pos'}">(${g.firstDelta > 0 ? '+' : ''}${g.firstDelta} dk)</span>` : '') : ''}</td><td>${esc(g.lastOldT)}${g.lastOldT !== g.lastNewT ? ' → <b>' + esc(g.lastNewT) + '</b>' : ''}</td><td>${g.yolcuOld || g.yolcuNew ? `${g.yolcuOld} → ${g.yolcuNew}` : ''}</td></tr>`), list.length);
    }
    $('#stops-table').innerHTML = html; labelize($('#stops-table'));
  }
  /* Dar panelde tablo satırları kart olarak gösterilir: her hücreye sütun adını etiket olarak yaz */
  function labelize(box) {
    const ths = Array.from(box.querySelectorAll('thead th')).map(th => th.textContent);
    box.querySelectorAll('tbody tr').forEach(tr => Array.from(tr.children).forEach((td, i) => { if (ths[i]) td.dataset.label = ths[i]; }));
  }
  async function stopsOutput() {
    const wb = await LG.buildStopsWorkbook(D.res);
    return { blob: await LG.wbToBlob(wb), name: `DURAK_KARSILASTIRMA_${today()}.xlsx` };
  }
  function stopsSummaryHtml() {
    const st = D.res.stats;
    return `<p>Merhaba,</p><p>Durak listesi karşılaştırması ektedir.</p><ul><li>Eklenen durak: ${st.added}</li><li>Kalkan durak: ${st.removed}</li>` +
      `<li>Saati değişen: ${st.timeChanged}</li><li>Konumu değişen: ${st.moved}</li><li>Adı değişen: ${st.renamed}</li></ul>`;
  }
  busyButton('#stops-download', 'Excel indir', async () => { const o = await stopsOutput(); download(o.blob, o.name); });

  /* Ortam cevaba ek eklemeyi destekliyorsa "Cevaba ekle" düğmeleri */
  if (H.attachToReply) {
    for (const [after, id, out, sum] of [['#sync-download', 'sync-reply', syncOutput, syncSummaryHtml], ['#stops-download', 'stops-reply', stopsOutput, stopsSummaryHtml]]) {
      const b = document.createElement('button'); b.id = id; b.className = 'ghost'; b.textContent = 'Cevaba ekle';
      b.title = 'Sonucu bu maile verilecek cevabın ekine koyar; alıcıları gönderirken değiştirebilirsin';
      $(after).insertAdjacentElement('afterend', b);
      busyButton('#' + id, 'Cevaba ekle', async () => { const o = await out(); await H.attachToReply(o.blob, o.name, sum()); toast('Cevap taslağı açıldı'); });
    }
  }
  function busyButton(sel, label, fn) {
    $(sel).addEventListener('click', async () => {
      const btn = $(sel); btn.disabled = true; btn.textContent = 'Hazırlanıyor…';
      try { await fn(); } catch (e) { console.error(e); toast('İşlem yapılamadı: ' + (e.message || e), true); }
      btn.disabled = false; btn.textContent = label;
    });
  }

  /* ═══════════ MAİL EKLERİ (Outlook) ═══════════ */
  const SLOTS = {
    main: { card: '#drop-main', badge: '#badge-main', set: v => (S.main = v), ready: () => syncReady() },
    src:  { card: '#drop-src',  badge: '#badge-src',  set: v => (S.src = v),  ready: () => syncReady() },
    old:  { card: '#drop-old',  badge: '#badge-old',  set: v => (D.old = v),  ready: () => stopsReady() },
    new:  { card: '#drop-new',  badge: '#badge-new',  set: v => (D.new = v),  ready: () => stopsReady() },
  };
  let attList = [];
  function loadAttachment(slot, att) {
    const sl = SLOTS[slot];
    return loadInto(sl.set({}), { name: att.name, read: () => H.readAttachment(att.id) }, $(sl.badge), sl.ready);
  }
  async function refreshAttachments() {
    if (!H.listAttachments) return;
    try { attList = (await H.listAttachments()).filter(a => /\.(xlsx|csv|xls)$/i.test(a.name)); }
    catch (e) { attList = []; console.error(e); }
    for (const [slot, sl] of Object.entries(SLOTS)) {
      let box = document.querySelector(`.att[data-slot="${slot}"]`);
      if (!box) { box = document.createElement('div'); box.className = 'att'; box.dataset.slot = slot; $(sl.card).insertAdjacentElement('beforebegin', box); }
      box.innerHTML = attList.length
        ? `<label>Maildeki ek</label><select><option value="">— seç —</option>${attList.map((a, i) => `<option value="${i}">${esc(a.name)}</option>`).join('')}</select>`
        : '<span class="hint">Bu mailde Excel/CSV eki yok, dosyayı aşağıdan seç.</span>';
      const sel = box.querySelector('select');
      if (sel) sel.addEventListener('change', () => { if (sel.value !== '') loadAttachment(slot, attList[+sel.value]); });
    }
    /* Otomatik atama */
    const pick = (slot, att) => { if (!att) return; const sel = document.querySelector(`.att[data-slot="${slot}"] select`); sel.value = String(attList.indexOf(att)); loadAttachment(slot, att); };
    const yolcu = attList.find(a => /yolcu/i.test(a.name));
    const others = attList.filter(a => a !== yolcu);
    if (attList.length === 1) pick('src', attList[0]);
    else if (attList.length >= 2) { if (yolcu) pick('main', yolcu); pick('src', others[0]); }
    const eski = attList.find(a => /eski|old/i.test(a.name)), yeni = attList.find(a => /yeni|new|güncel|guncel/i.test(a.name));
    if (eski && yeni && eski !== yeni) { pick('old', eski); pick('new', yeni); }
  }
  if (H.onItemChanged) H.onItemChanged(() => {
    for (const k of ['main', 'src', 'old', 'new']) { const b = $(SLOTS[k].badge); if (b) b.innerHTML = ''; }
    S.main = S.src = D.old = D.new = null; S.res = D.res = null;
    $('#map-card').hidden = $('#sync-result').hidden = $('#smap-card').hidden = $('#stops-result').hidden = true;
    refreshAttachments();
  });

  /* ═══════════ AYARLAR: isim sözlüğü ═══════════ */
  let custom = {};
  async function loadNames() { custom = await store.get('customNames', {}); LG.setCustomNames(custom); renderNames(); }
  function renderNames() {
    const keys = Object.keys(custom).sort();
    $('#nm-list').innerHTML = keys.length ? keys.map(k => `<span class="chip">${esc(k)} · ${custom[k] === 'K' ? 'Kadın' : 'Erkek'}<button data-k="${esc(k)}" title="Sil">×</button></span>`).join('') : '<span class="hint">Henüz ekleme yok</span>';
    $$('#nm-list [data-k]').forEach(b => b.addEventListener('click', async () => { delete custom[b.dataset.k]; await store.set('customNames', custom); LG.setCustomNames(custom); renderNames(); }));
  }
  $('#nm-add').addEventListener('click', async () => {
    const k = LG.key($('#nm-name').value); if (!k) return;
    custom[k] = $('#nm-g').value; await store.set('customNames', custom); LG.setCustomNames(custom);
    $('#nm-name').value = ''; renderNames(); toast('Sözlüğe eklendi');
    if (S.res && S.view === 'added') renderSyncView();
  });
  $('#nm-test').addEventListener('input', () => {
    const v = $('#nm-test').value.trim(); if (!v) { $('#nm-test-out').textContent = ''; return; }
    const sp = LG.splitName(v);
    $('#nm-test-out').textContent = `Ad: ${sp.ad} · Soyad: ${sp.soyad} · Cinsiyet: ${sp.cinsiyet || '?'}`;
  });

  /* ── Yardımcılar ───────────────────────────────────────── */
  function today() { const d = new Date(); return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`; }
  function download(blob, name) {
    if (H.download) return H.download(blob, name);
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
    toast('İndirildi: ' + name);
  }

  (async () => {
    if (H.ready) await H.ready;
    if (H.subtitle) $('.brand small').textContent = H.subtitle;
    document.body.classList.add('host-' + (H.name || 'web'));
    await loadProfiles(); await loadNames();
    await refreshAttachments();
    const gs = await store.get('lastGs', ''); if (gs) $('#gs-url').value = gs;
  })();
})();
