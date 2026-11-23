/* Liste Güncelleme — dosya okuma (xlsx/csv/Google Sheets) ve Excel çıktıları. ExcelJS gerekir. */
(function (root) {
  'use strict';
  const LG = root.LG;
  const XL = () => root.ExcelJS || (typeof require !== 'undefined' ? require('exceljs') : null);

  /* ── Okuma ─────────────────────────────────────────────── */
  function cellVal(v) {
    if (v === null || v === undefined) return '';
    if (v instanceof Date) return v;
    if (typeof v === 'object') {
      if (Array.isArray(v.richText)) return v.richText.map(t => t.text).join('');
      if ('result' in v) return cellVal(v.result);
      if ('text' in v) return cellVal(v.text);
      if ('error' in v) return '';
      if ('sharedFormula' in v || 'formula' in v) return '';
      return String(v);
    }
    return v;
  }

  /* Başlık satırını bul: ilk 15 satırda en çok dolu metin hücresi olan satır */
  function tableFromMatrix(matrix) {
    let best = -1, bestN = 1;
    for (let i = 0; i < Math.min(15, matrix.length); i++) {
      const n = (matrix[i] || []).filter(x => typeof x === 'string' && x.trim()).length;
      if (n > bestN) { bestN = n; best = i; }
    }
    if (best < 0) return { headers: [], rows: [], headerRow: 0 };
    const seen = {};
    const width = Math.max(...matrix.slice(best).map(r => (r || []).length));
    const headers = [];
    for (let c = 0; c < width; c++) {
      let h = LG.str((matrix[best] || [])[c]) || `Sütun ${c + 1}`;
      if (seen[h]) { seen[h]++; h = `${h} (${seen[h]})`; } else seen[h] = 1;
      headers.push(h);
    }
    const rows = [];
    for (let i = best + 1; i < matrix.length; i++) {
      const r = matrix[i] || [];
      if (!r.some(x => LG.str(x instanceof Date ? 'd' : x))) continue;
      const o = {};
      headers.forEach((h, c) => { o[h] = r[c] === undefined ? '' : r[c]; });
      rows.push(o);
    }
    const pre = matrix.slice(0, best).map(r => (r || []).map(v => v === undefined ? '' : v));
    return { headers, rows, headerRow: best, pre };
  }

  async function readXlsx(buf) {
    const wb = new (XL().Workbook)();
    await wb.xlsx.load(buf);
    const sheets = [];
    wb.eachSheet(ws => {
      if (ws.state && ws.state !== 'visible') return;
      const matrix = [];
      ws.eachRow({ includeEmpty: true }, (row, rn) => {
        const arr = [];
        row.eachCell({ includeEmpty: true }, (cell, cn) => { arr[cn - 1] = cellVal(cell.value); });
        matrix[rn - 1] = arr;
      });
      for (let i = 0; i < matrix.length; i++) if (!matrix[i]) matrix[i] = [];
      const t = tableFromMatrix(matrix);
      if (t.headers.length) sheets.push(Object.assign({ name: ws.name }, t));
    });
    return sheets;
  }

  function parseCsv(text) {
    text = text.replace(/^﻿/, '');
    const first = text.split(/\r?\n/, 1)[0] || '';
    const delim = (first.split(';').length > first.split(',').length) ? ';' : (first.split('\t').length > first.split(',').length ? '\t' : ',');
    const out = []; let row = [], f = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; }
        else f += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(f); f = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(f); out.push(row); row = []; f = ''; }
      else f += ch;
    }
    if (f !== '' || row.length) { row.push(f); out.push(row); }
    return out;
  }

  function decodeText(buf) {
    let t = new TextDecoder('utf-8').decode(buf);
    if ((t.match(/�/g) || []).length > 3) { try { t = new TextDecoder('windows-1254').decode(buf); } catch (e) { /* */ } }
    return t;
  }

  async function readFile(file) { return readBuffer(await file.arrayBuffer(), file.name); }
  async function readBuffer(buf, fileName) {
    const name = String(fileName || '').toLowerCase();
    if (name.endsWith('.csv') || name.endsWith('.txt') || name.endsWith('.tsv')) {
      return [Object.assign({ name: fileName }, tableFromMatrix(parseCsv(decodeText(buf))))];
    }
    if (name.endsWith('.xls')) throw new Error('Eski .xls biçimi okunamıyor. Dosyayı Excel\'de açıp "Farklı Kaydet → .xlsx" yapın.');
    return readXlsx(buf);
  }

  /* Google Sheets bağlantısı → CSV dışa aktarım */
  function gsheetCsvUrl(url) {
    const m = String(url).match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    if (!m) throw new Error('Geçerli bir Google Sheets bağlantısı değil.');
    const g = String(url).match(/[#&?]gid=(\d+)/);
    return `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv${g ? '&gid=' + g[1] : ''}`;
  }
  async function readGSheet(url) {
    let res;
    try { res = await fetch(gsheetCsvUrl(url), { credentials: 'include' }); }
    catch (e) { throw new Error('Google Sheets bu ortamdan okunamadı (tarayıcı erişimi engelledi). Sayfayı Excel olarak indirip yükleyin ya da Chrome uzantısını kullanın.'); }
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || ct.includes('text/html')) {
      throw new Error('Google Sheets okunamadı. Sayfayı "bağlantıya sahip herkes görüntüleyebilir" yapın ya da Chrome\'da bu sayfaya erişimi olan hesapla oturum açın.');
    }
    const text = await res.text();
    return [Object.assign({ name: 'Google Sheets' }, tableFromMatrix(parseCsv(text)))];
  }

  /* ── Yazma yardımcıları ────────────────────────────────── */
  const FILL = c => ({ type: 'pattern', pattern: 'solid', fgColor: { argb: c } });
  const C = { RED: 'FFFF0000', GREEN: 'FF00B050', ORANGE: 'FFFF6600', HDR: 'FFD9D9D9', YEL: 'FFFFF2CC', LGRN: 'FFE2EFDA', LRED: 'FFFCE4E4', LORG: 'FFFDE9D9' };
  const WHITE = { color: { argb: 'FFFFFFFF' } };
  function header(ws, cols, widths, pre) {
    (pre || []).forEach(p => { const r = ws.addRow(p); r.font = { bold: true }; });
    const hr = (pre || []).length + 1;
    ws.addRow(cols);
    const r = ws.getRow(hr);
    r.eachCell(c => { c.font = { bold: true }; c.fill = FILL(C.HDR); c.alignment = { vertical: 'middle', wrapText: true }; c.border = { bottom: { style: 'thin' } }; });
    ws.views = [{ state: 'frozen', ySplit: hr }];
    cols.forEach((h, i) => { ws.getColumn(i + 1).width = (widths && widths[h]) || Math.min(45, Math.max(10, String(h).length + 4)); });
    ws.autoFilter = { from: { row: hr, column: 1 }, to: { row: hr, column: cols.length } };
  }
  const typed = (oldVal, v) => (typeof oldVal === 'number' && /^\d+$/.test(String(v)) && String(v).length < 16) ? Number(v) : v;
  const CONF_TXT = { id: 'Sicil', both: 'İsim + telefon', name: 'İsim', phone: 'Telefon' };
  const FIELD_TXT = { id: 'Sicil No', tel: 'Telefon', gkodu: 'Güzergah kodu', guzergah: 'Güzergah adı', durak: 'Durak', adres: 'Adres', departman: 'Departman', isim: 'Ad Soyad' };

  /* ── Senkron çıktısı ───────────────────────────────────── */
  async function buildSyncWorkbook(res, mainTable, mainSheetName) {
    const wb = new (XL().Workbook)();
    wb.creator = 'Liste Güncelleme';
    const mm = res.mmap;
    const headers = mainTable.headers;

    /* 1) Güncellenmiş yolcu listesi (sıfırdan kurulur; stil bozulması olmaz) */
    const ws = wb.addWorksheet((mainSheetName || 'YOLCU LİSTESİ').slice(0, 31));
    header(ws, headers, null, mainTable.pre);
    const byRn = new Map(res.rows.map(r => [r.rn, r]));
    mainTable.rows.forEach((raw, rn) => {
      const st = byRn.get(rn);
      const vals = headers.map(h => raw[h] === undefined ? '' : raw[h]);
      const marks = {}; // sütun indeksi → {level, old}
      if (st && st.status !== 'removed') {
        for (const c of st.ch) {
          if (c.skip) continue;
          if (c.field === 'isim') {
            if (mm.adsoyad) { const i = headers.indexOf(mm.adsoyad); vals[i] = c.val; marks[i] = { level: c.level, old: c.old }; }
            else {
              const sp = LG.splitName(c.val);
              if (mm.ad) { const i = headers.indexOf(mm.ad); marks[i] = { level: c.level, old: vals[i] }; vals[i] = sp.ad; }
              if (mm.soyad) { const i = headers.indexOf(mm.soyad); marks[i] = { level: c.level, old: vals[i] }; vals[i] = sp.soyad; }
            }
            continue;
          }
          const i = headers.indexOf(c.col);
          if (i < 0) continue;
          vals[i] = typed(raw[c.col], c.val);
          marks[i] = { level: c.level, old: c.old };
        }
      }
      const row = ws.addRow(vals);
      if (st && st.status === 'removed' && !st.skip) {
        row.eachCell({ includeEmpty: true }, cell => { cell.fill = FILL(C.RED); cell.font = WHITE; });
        row.getCell(1).note = 'Kaynakta eşleşme yok — çıkacak';
      } else {
        for (const [i, mk] of Object.entries(marks)) {
          const cell = row.getCell(+i + 1);
          cell.fill = FILL(mk.level === 'high' ? C.GREEN : C.ORANGE);
          cell.font = WHITE;
          cell.note = 'Eski: ' + (LG.str(mk.old instanceof Date ? mk.old.toLocaleDateString('tr-TR') : mk.old) || '(boş)') + (mk.level === 'mid' ? '\nKontrol edin (orta güven)' : '');
        }
      }
    });

    /* 2) YENİ EKLENENLER */
    const wn = wb.addWorksheet('YENİ EKLENENLER');
    const W = { 'Cinsiyet': 8, 'Sicil No': 10, 'Adı': 18, 'Soyadı': 18, 'Tel': 13, 'Email': 20, 'Site': 13, 'Semt': 13, 'Adresi': 50, 'Kısa Adres': 22, 'Görev': 10, 'Departman': 22, 'Açıklama': 15, 'G.Kodu': 13, 'Güzergah Adı': 25 };
    header(wn, LG.NEW_COLS, W);
    const COLOR = new Set(['Cinsiyet', 'Sicil No', 'Adı', 'Soyadı', 'Tel', 'Adresi', 'Kısa Adres', 'Departman', 'G.Kodu', 'Güzergah Adı']);
    LG.newListRows(res.added.filter(s => !s.skip), res.smap).forEach(o => {
      const row = wn.addRow(LG.NEW_COLS.map(h => (h === 'Sicil No' || h === 'Tel') && /^\d+$/.test(o[h]) && o[h].length < 16 ? Number(o[h]) : o[h]));
      LG.NEW_COLS.forEach((h, i) => { if (COLOR.has(h) && LG.str(o[h])) { const c = row.getCell(i + 1); c.fill = FILL(C.GREEN); c.font = WHITE; } });
    });

    /* 3) DEĞİŞİKLİKLER (denetim izi) */
    const wc = wb.addWorksheet('DEĞİŞİKLİKLER');
    header(wc, ['Satır', 'Sicil No', 'Ad Soyad', 'Alan', 'Eski', 'Yeni', 'Güven', 'Eşleşme', 'Durum'], { 'Ad Soyad': 26, 'Eski': 40, 'Yeni': 40, 'Eşleşme': 16 });
    for (const c of res.changes) {
      const r = wc.addRow([c.rn + mainTable.headerRow + 2, c.id || '', c.name, FIELD_TXT[c.field] || c.field, LG.str(c.old), LG.str(c.val), c.level === 'high' ? 'Yüksek' : 'Kontrol', CONF_TXT[c.conf] || c.conf, c.skip ? 'Uygulanmadı' : 'Uygulandı']);
      r.getCell(7).fill = FILL(c.level === 'high' ? C.LGRN : C.LORG);
      if (c.skip) r.font = { color: { argb: 'FF999999' } };
    }
    for (const r of res.rows.filter(r => r.status === 'removed')) {
      const x = wc.addRow([r.rn + mainTable.headerRow + 2, r.m.id, r.m.nameDisp, 'Satır', LG.clean(r.m.guzergah || r.m.gkodu), 'ÇIKACAK', '', 'Eşleşme yok', r.skip ? 'Uygulanmadı' : 'Kırmızı']);
      x.getCell(6).fill = FILL(C.LRED);
    }

    /* 4) GÜZERGAH ÖZETİ */
    const wr = wb.addWorksheet('GÜZERGAH ÖZETİ');
    header(wr, ['Güzergah', 'Kod', 'Önce', 'Çıkan', 'Başka güzergaha geçen', 'Başka güzergahtan gelen', 'Yeni eklenen', 'Sonra', 'Fark'], { 'Güzergah': 30 });
    for (const g of res.routeSummary) {
      const r = wr.addRow([g.route, g.code, g.before, g.removed, g.movedOut, g.movedIn, g.added, g.after, g.diff]);
      if (g.diff) r.getCell(9).fill = FILL(g.diff > 0 ? C.LGRN : C.LRED);
    }
    const tot = k => res.routeSummary.reduce((a, g) => a + g[k], 0);
    const tr = wr.addRow(['TOPLAM', '', tot('before'), tot('removed'), tot('movedOut'), tot('movedIn'), tot('added'), tot('after'), tot('diff')]);
    tr.font = { bold: true };

    /* 5) UYARILAR */
    const wu = wb.addWorksheet('UYARILAR');
    header(wu, ['Önem', 'Tür', 'Kişi', 'Açıklama'], { 'Tür': 28, 'Kişi': 28, 'Açıklama': 70 });
    for (const w of res.warnings) {
      const r = wu.addRow([w.severity === 'high' ? 'Yüksek' : 'Orta', w.type, w.name, w.text]);
      r.getCell(1).fill = FILL(w.severity === 'high' ? C.LRED : C.YEL);
    }
    for (const d of res.dups) {
      const r = wu.addRow(['Orta', `MÜKERRER (${d.side}) — ${d.tier}`, d.rows.map(x => x.name).join(' / '), d.rows.map(x => `${x.name} ${x.tel || ''} ${x.id ? 'sicil ' + x.id : ''} ${x.guzergah || ''}`.trim()).join('  |  ')]);
      r.getCell(1).fill = FILL(C.YEL);
    }
    return wb;
  }

  /* ── Durak karşılaştırma çıktısı ───────────────────────── */
  async function buildStopsWorkbook(res) {
    const wb = new (XL().Workbook)();
    const ws = wb.addWorksheet('DURAK DEĞİŞİKLİKLERİ');
    const cols = ['Güzergah', 'Durum', 'Eski sıra', 'Eski durak', 'Eski saat', 'Yeni sıra', 'Yeni durak', 'Yeni saat', 'Saat farkı (dk)', 'Yolcu (eski → yeni)', 'Değişiklikler'];
    header(ws, cols, { 'Güzergah': 26, 'Eski durak': 30, 'Yeni durak': 30, 'Değişiklikler': 60, 'Yolcu (eski → yeni)': 16 });
    const ST = { added: 'EKLENDİ', removed: 'KALKTI', changed: 'DEĞİŞTİ', same: 'AYNI' };
    for (const it of res.items) {
      const o = it.o || {}, n = it.n || {};
      const td = it.notes.find(x => x.t === 'SAAT');
      const r = ws.addRow([it.route, ST[it.status], o.sira ?? '', o.durak || '', LG.fmtMin(o.saat ?? null), n.sira ?? '', n.durak || '', LG.fmtMin(n.saat ?? null),
        td && td.delta !== undefined ? td.delta : '', (it.o && it.n && (o.yolcu !== null || n.yolcu !== null)) ? `${o.yolcu ?? '-'} → ${n.yolcu ?? '-'}` : '',
        it.notes.map(x => x.t + (x.d ? ': ' + x.d : '')).join(' · ')]);
      if (it.status === 'added') for (let i = 6; i <= 8; i++) { r.getCell(i).fill = FILL(C.GREEN); r.getCell(i).font = WHITE; }
      if (it.status === 'removed') for (let i = 3; i <= 5; i++) { r.getCell(i).fill = FILL(C.RED); r.getCell(i).font = WHITE; }
      if (it.status === 'changed') {
        const hit = t => it.notes.some(x => x.t === t);
        const paint = i => { r.getCell(i).fill = FILL(C.ORANGE); r.getCell(i).font = WHITE; };
        if (hit('SAAT')) { paint(8); paint(9); }
        if (hit('AD DEĞİŞTİ')) paint(7);
        if (hit('SIRA')) paint(6);
        if (hit('YOLCU')) paint(10);
        if (hit('KONUM')) paint(11);
      }
      if (it.status === 'same') r.font = { color: { argb: 'FF888888' } };
    }
    const wr = wb.addWorksheet('GÜZERGAH ÖZETİ');
    header(wr, ['Güzergah', 'Durum', 'Durak (önce)', 'Durak (sonra)', 'Eklenen', 'Kalkan', 'Değişen', 'İlk durak (önce)', 'İlk durak (sonra)', 'İlk durak farkı (dk)', 'Son durak (önce)', 'Son durak (sonra)', 'Yolcu (önce)', 'Yolcu (sonra)'], { 'Güzergah': 28 });
    for (const g of res.routeSummary) {
      const r = wr.addRow([g.route, g.status, g.before, g.after, g.added, g.removed, g.changed, g.firstOldT, g.firstNewT, g.firstDelta ?? '', g.lastOldT, g.lastNewT, g.yolcuOld || '', g.yolcuNew || '']);
      const col = { 'YENİ': C.LGRN, 'KALKTI': C.LRED, 'DEĞİŞTİ': C.YEL }[g.status];
      if (col) r.getCell(2).fill = FILL(col);
    }
    return wb;
  }

  /* Base64 ↔ ArrayBuffer (Outlook ekleri için) */
  function b64ToBuf(b64) {
    const bin = atob(String(b64).replace(/\s+/g, '')); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }
  async function blobToB64(blob) {
    const u = new Uint8Array(await blob.arrayBuffer()); let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  async function wbToBlob(wb) {
    const buf = await wb.xlsx.writeBuffer();
    return new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  Object.assign(LG, { readFile, readBuffer, readXlsx, readGSheet, gsheetCsvUrl, parseCsv, tableFromMatrix, buildSyncWorkbook, buildStopsWorkbook, wbToBlob, b64ToBuf, blobToB64, FIELD_TXT, CONF_TXT });
  if (typeof module !== 'undefined' && module.exports) module.exports = LG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
