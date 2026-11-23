/* Liste Güncelleme — durak listesi karşılaştırma motoru */
(function (root) {
  'use strict';
  const LG = root.LG || (typeof require !== 'undefined' ? require('./core.js') : {});

  const STOP_FIELDS = [
    { f: 'guzergah', label: 'Güzergah',        hints: ['Güzergah Adı', 'Güzergah', 'Servis Adı', 'Hat', 'Rota'] },
    { f: 'gkodu',    label: 'Güzergah kodu',   hints: ['G.Kodu', 'Güzergah Kodu', 'Servis Kodu'] },
    { f: 'durak',    label: 'Durak adı',       hints: ['Durak Adı', 'Durak', 'Kısa Adres', 'Biniş Noktası'] },
    { f: 'sira',     label: 'Durak sırası',    hints: ['Durak No', 'Sıra', 'Sira', 'No'] },
    { f: 'saat',     label: 'Saat',            hints: ['Biniş Saati', 'Durak Saati', 'Saat', 'Zaman'] },
    { f: 'lat',      label: 'Enlem',           hints: ['Enlem', 'Lat', 'Latitude'] },
    { f: 'lon',      label: 'Boylam',          hints: ['Boylam', 'Lon', 'Lng', 'Longitude'] },
    { f: 'koord',    label: 'Koordinat (tek sütun)', hints: ['Koordinat', 'Konum', 'Coordinates'] },
    { f: 'yolcu',    label: 'Yolcu (sayı ya da isimler)', hints: ['Yolcu Sayısı', 'Kişi Sayısı', 'Yolcular', 'Personel', 'Yolcu'] },
  ];

  /* Saat → dakika. Excel kesirli gün, Date, "6:38", "06.38", "0638" kabul edilir */
  function toMin(v) {
    if (v === null || v === undefined || v === '') return null;
    if (v instanceof Date) return v.getUTCHours() * 60 + v.getUTCMinutes();
    if (typeof v === 'number') { if (v >= 0 && v < 1) return Math.round(v * 1440); if (v >= 1 && v < 2) return Math.round((v - 1) * 1440); return null; }
    const s = LG.str(v);
    let m = s.match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
    if (m) return (+m[1]) * 60 + (+m[2]);
    m = s.match(/^(\d{2})(\d{2})$/);
    if (m) return (+m[1]) * 60 + (+m[2]);
    return null;
  }
  const fmtMin = n => n === null ? '' : String(Math.floor(n / 60) % 24).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0');

  function num(v) { if (typeof v === 'number') return v; const s = LG.str(v).replace(',', '.'); const n = parseFloat(s); return isFinite(n) ? n : null; }
  function coords(raw, map) {
    let lat = map.lat ? num(raw[map.lat]) : null, lon = map.lon ? num(raw[map.lon]) : null;
    if ((lat === null || lon === null) && map.koord) {
      const p = LG.str(raw[map.koord]).match(/(-?\d+[.,]\d+)\s*[,; ]\s*(-?\d+[.,]\d+)/);
      if (p) { lat = num(p[1]); lon = num(p[2]); }
    }
    if (lat !== null && lon !== null && Math.abs(lat) < 30 && Math.abs(lon) > 30) [lat, lon] = [lon, lat]; // ters girilmiş (Türkiye için)
    return (lat !== null && lon !== null) ? { lat, lon } : null;
  }
  function distM(a, b) {
    if (!a || !b) return null;
    const R = 6371000, r = x => x * Math.PI / 180;
    const dLat = r(b.lat - a.lat), dLon = r(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLon / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(h)));
  }
  function yolcuCount(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return v;
    const s = LG.str(v);
    if (/^\d+$/.test(s)) return +s;
    return s.split(/[,;\n\/]+/).map(x => x.trim()).filter(Boolean).length;
  }

  function stopModel(raw, i, map) {
    const route = LG.clean(map.guzergah ? raw[map.guzergah] : '') || LG.clean(map.gkodu ? raw[map.gkodu] : '');
    return {
      i, raw, route, routeKey: LG.key(route),
      code: LG.clean(map.gkodu ? raw[map.gkodu] : ''),
      durak: LG.clean(map.durak ? raw[map.durak] : ''),
      durakKey: LG.key(map.durak ? raw[map.durak] : ''),
      sira: map.sira ? num(raw[map.sira]) : null,
      saat: map.saat ? toMin(raw[map.saat]) : null,
      pos: coords(raw, map),
      yolcu: map.yolcu ? yolcuCount(raw[map.yolcu]) : null,
      yolcuText: map.yolcu ? LG.str(raw[map.yolcu]) : '',
    };
  }

  function runStops(oldRaw, newRaw, omap, nmap, options) {
    const opts = Object.assign({ minMoveM: 50, renameRadiusM: 120, minTimeDiff: 1 }, options || {});
    const O = oldRaw.map((r, i) => stopModel(r, i, omap)).filter(s => s.durak || s.pos);
    const N = newRaw.map((r, i) => stopModel(r, i, nmap)).filter(s => s.durak || s.pos);
    const usedN = new Set(), pairs = [];

    /* 1) Aynı güzergah + aynı durak adı (aynı ad iki kez geçiyorsa sırayla eşle) */
    const nIdx = {};
    N.forEach(n => (nIdx[n.routeKey + '|' + n.durakKey] || (nIdx[n.routeKey + '|' + n.durakKey] = [])).push(n));
    for (const o of O) {
      const c = (nIdx[o.routeKey + '|' + o.durakKey] || []).filter(n => !usedN.has(n.i));
      if (!o.durakKey || !c.length) continue;
      c.sort((a, b) => (distM(o.pos, a.pos) ?? 1e9) - (distM(o.pos, b.pos) ?? 1e9));
      usedN.add(c[0].i); pairs.push({ o, n: c[0], how: 'ad' });
    }
    /* 2) Aynı güzergah, koordinatı çok yakın → adı değişmiş durak */
    const pairedO = new Set(pairs.map(p => p.o.i));
    for (const o of O) {
      if (pairedO.has(o.i) || !o.pos) continue;
      let best = null, bd = Infinity;
      for (const n of N) {
        if (usedN.has(n.i) || n.routeKey !== o.routeKey || !n.pos) continue;
        const d = distM(o.pos, n.pos);
        if (d < bd) { bd = d; best = n; }
      }
      if (best && bd <= opts.renameRadiusM) { usedN.add(best.i); pairedO.add(o.i); pairs.push({ o, n: best, how: 'konum' }); }
    }

    const items = [];
    for (const { o, n, how } of pairs) {
      const notes = [];
      if (how === 'konum' || (o.durakKey !== n.durakKey)) notes.push({ t: 'AD DEĞİŞTİ', d: `${o.durak} → ${n.durak}` });
      if (o.saat !== null && n.saat !== null && Math.abs(n.saat - o.saat) >= opts.minTimeDiff) {
        const df = n.saat - o.saat; notes.push({ t: 'SAAT', d: `${fmtMin(o.saat)} → ${fmtMin(n.saat)} (${df > 0 ? '+' : ''}${df} dk)`, delta: df });
      } else if (o.saat === null && n.saat !== null) notes.push({ t: 'SAAT', d: `(yok) → ${fmtMin(n.saat)}` });
      if (o.sira !== null && n.sira !== null && o.sira !== n.sira) notes.push({ t: 'SIRA', d: `${o.sira} → ${n.sira}` });
      const dm = distM(o.pos, n.pos);
      if (dm !== null && dm >= opts.minMoveM) notes.push({ t: 'KONUM', d: `${dm} m taşındı`, dist: dm });
      if (o.yolcu !== null && n.yolcu !== null && o.yolcu !== n.yolcu) notes.push({ t: 'YOLCU', d: `${o.yolcu} → ${n.yolcu}` });
      items.push({ status: notes.length ? 'changed' : 'same', route: n.route || o.route, o, n, notes });
    }
    for (const o of O) if (!pairedO.has(o.i)) items.push({ status: 'removed', route: o.route, o, n: null, notes: [] });
    for (const n of N) if (!usedN.has(n.i)) {
      const routeExisted = O.some(o => o.routeKey === n.routeKey);
      items.push({ status: 'added', route: n.route, o: null, n, notes: routeExisted ? [] : [{ t: 'YENİ GÜZERGAH', d: '' }] });
    }
    const sortKey = it => (it.n || it.o);
    items.sort((a, b) => a.route.localeCompare(b.route, 'tr') ||
      ((sortKey(a).sira ?? 999) - (sortKey(b).sira ?? 999)) || ((sortKey(a).saat ?? 9999) - (sortKey(b).saat ?? 9999)));

    /* Güzergah özeti */
    const routes = {};
    const R = (k, name) => routes[k] || (routes[k] = { route: name, before: 0, after: 0, added: 0, removed: 0, changed: 0, firstOld: null, firstNew: null, lastOld: null, lastNew: null, yolcuOld: 0, yolcuNew: 0 });
    for (const o of O) {
      const r = R(o.routeKey, o.route); r.before++;
      if (o.saat !== null) { r.firstOld = r.firstOld === null ? o.saat : Math.min(r.firstOld, o.saat); r.lastOld = r.lastOld === null ? o.saat : Math.max(r.lastOld, o.saat); }
      if (o.yolcu) r.yolcuOld += o.yolcu;
    }
    for (const n of N) {
      const r = R(n.routeKey, n.route); r.after++;
      if (n.saat !== null) { r.firstNew = r.firstNew === null ? n.saat : Math.min(r.firstNew, n.saat); r.lastNew = r.lastNew === null ? n.saat : Math.max(r.lastNew, n.saat); }
      if (n.yolcu) r.yolcuNew += n.yolcu;
    }
    for (const it of items) {
      const k = (it.n || it.o).routeKey, r = routes[k];
      if (it.status === 'added') r.added++; else if (it.status === 'removed') r.removed++; else if (it.status === 'changed') r.changed++;
    }
    const routeSummary = Object.values(routes).map(r => Object.assign(r, {
      firstOldT: fmtMin(r.firstOld), firstNewT: fmtMin(r.firstNew), lastOldT: fmtMin(r.lastOld), lastNewT: fmtMin(r.lastNew),
      firstDelta: (r.firstOld !== null && r.firstNew !== null) ? r.firstNew - r.firstOld : null,
      status: r.before === 0 ? 'YENİ' : r.after === 0 ? 'KALKTI' : (r.added || r.removed || r.changed) ? 'DEĞİŞTİ' : 'AYNI',
    })).sort((a, b) => a.route.localeCompare(b.route, 'tr'));

    const stats = {
      old: O.length, new: N.length,
      added: items.filter(i => i.status === 'added').length,
      removed: items.filter(i => i.status === 'removed').length,
      changed: items.filter(i => i.status === 'changed').length,
      same: items.filter(i => i.status === 'same').length,
      timeChanged: items.filter(i => i.notes.some(n => n.t === 'SAAT')).length,
      moved: items.filter(i => i.notes.some(n => n.t === 'KONUM')).length,
      renamed: items.filter(i => i.notes.some(n => n.t === 'AD DEĞİŞTİ')).length,
    };
    return { items, routeSummary, stats };
  }

  Object.assign(LG, { STOP_FIELDS, runStops, toMin, fmtMin, distM });
  if (typeof module !== 'undefined' && module.exports) module.exports = LG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
