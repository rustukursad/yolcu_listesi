/* Liste Güncelleme — yolcu listesi senkron motoru (saf mantık, DOM yok) */
(function (root) {
  'use strict';
  const LG = root.LG || (typeof require !== 'undefined' ? require('./core.js') : {});

  /* Alan tanımları ve otomatik algılama ipuçları (sıra önemli: önce özel olanlar) */
  const MAIN_FIELDS = [
    { f: 'id',        label: 'Sicil No',          hints: ['Sicil No', 'Sicil', 'SAP NO', 'SAP'] },
    { f: 'ad',        label: 'Adı',               hints: ['Adı', 'Ad'] },
    { f: 'soyad',     label: 'Soyadı',            hints: ['Soyadı', 'Soyad'] },
    { f: 'adsoyad',   label: 'Ad Soyad (tek sütun)', hints: ['Ad Soyad', 'Adı Soyadı', 'ADI-SOYADI', 'Yolcu Adı'] },
    { f: 'tel',       label: 'Telefon',           hints: ['Tel', 'Telefon', 'GSM', 'Cep Tel', 'Cep'] },
    { f: 'gkodu',     label: 'Güzergah kodu',     hints: ['G.Kodu', 'G Kodu', 'Güzergah Kodu', 'Servis Kodu'] },
    { f: 'guzergah',  label: 'Güzergah adı',      hints: ['Güzergah Adı', 'Güzergah', 'Servis Adı'] },
    { f: 'durak',     label: 'Durak',             hints: ['Kısa Adres', 'Durak', 'Durak Adı'] },
    { f: 'adres',     label: 'Adres',             hints: ['Adresi', 'Adres', 'Ev Adresi'] },
    { f: 'departman', label: 'Departman',         hints: ['Departman', 'Bölüm'] },
  ];
  const SRC_FIELDS = [
    { f: 'id',        label: 'SAP / Sicil No',    hints: ['SAP NO', 'SAP', 'Sicil No', 'Sicil', 'Personel No'] },
    { f: 'adsoyad',   label: 'Ad Soyad',          hints: ['ADI-SOYADI', 'ADI SOYADI', 'AD SOYAD', 'P - AD SOYAD', 'Personel Adı', 'Ad Soyad'] },
    { f: 'ad',        label: 'Adı (ayrıysa)',     hints: ['ADI', 'AD'] },
    { f: 'soyad',     label: 'Soyadı (ayrıysa)',  hints: ['SOYADI', 'SOYAD'] },
    { f: 'tel',       label: 'Telefon',           hints: ['TELEFON', 'TEL', 'GSM', 'P - TEL NO', 'CEP'] },
    { f: 'gkodu',     label: 'Güzergah kodu',     hints: ['SERVİS KODU', 'SERVIS KODU', 'G.KODU', 'GÜZERGAH KODU'] },
    { f: 'guzergah',  label: 'Güzergah adı',      hints: ['BÖLGE', 'GÜZERGAH ADI', 'GÜZERGAH', 'SERVİS ADI'] },
    { f: 'durak',     label: 'Durak',             hints: ['DURAK', 'P - DURAK', 'DURAK ADI', 'BİNİŞ NOKTASI'] },
    { f: 'adres',     label: 'Adres',             hints: ['ADRES', 'P- ADRES', 'P - ADRES', 'EV ADRESİ'] },
    { f: 'departman', label: 'Departman',         hints: ['DEPARTMAN', 'BÖLÜM', 'P - FİRMA'] },
  ];

  function autoMap(headers, fields) {
    const used = new Set(), map = {};
    for (const d of fields) {
      const c = LG.detectColumn(headers, d.hints, used);
      if (c) { map[d.f] = c; used.add(c); }
    }
    /* Ad+Soyad ayrı sütunsa tek-sütun alanını boş bırak, tersi de geçerli */
    if (map.ad && map.soyad && map.adsoyad) delete map.adsoyad;
    if (map.adsoyad && map.ad && !map.soyad) delete map.ad;
    return map;
  }

  /* Satırı ortak modele çevir */
  function model(raw, rn, map) {
    const g = f => map[f] ? raw[map[f]] : '';
    let full = map.adsoyad ? LG.str(g('adsoyad')) : (LG.str(g('ad')) + ' ' + LG.str(g('soyad')));
    full = full.trim();
    return {
      rn, raw,
      id: LG.normId(g('id')),
      name: LG.normName(full), nameDisp: LG.clean(full),
      tel: LG.normPhone(g('tel')),
      telRaw: LG.str(g('tel')),
      adres: LG.str(g('adres')),
      durak: LG.str(g('durak')),
      gkodu: LG.str(g('gkodu')),
      guzergah: LG.str(g('guzergah')),
      departman: LG.str(g('departman')),
    };
  }

  /* "HAKAN KADIR" ↔ "HAKAN KADIR TOPALOGLU": biri diğerinin kelime öneki mi */
  function namePrefix(a, b) {
    if (!a || !b || a === b) return false;
    const A = a.split(' '), B = b.split(' ');
    const [s, l] = A.length <= B.length ? [A, B] : [B, A];
    if (s.length < 2 && l.length > 2) return false;
    return s.every((w, i) => l[i] === w);
  }
  const nameClose = (a, b) => a === b || namePrefix(a, b) || LG.sim(a, b) >= 0.88;

  function addTo(idx, k, v) { if (!k) return; (idx[k] || (idx[k] = [])).push(v); }

  /* Mükerrer tespiti — üç kademe */
  function findDuplicates(rows, side) {
    const out = [], byNP = {}, byP = {}, byN = {};
    rows.forEach(r => {
      if (r.name && r.tel) addTo(byNP, r.name + '|' + r.tel, r);
      if (LG.validPhone(r.tel)) addTo(byP, r.tel, r);
      if (r.name) addTo(byN, r.name, r);
    });
    const seen = new Set();
    const emit = (idx, tier) => {
      for (const list of Object.values(idx)) {
        if (list.length < 2) continue;
        const sig = list.map(r => r.rn).sort((a, b) => a - b).join(',');
        if (seen.has(sig)) continue; seen.add(sig);
        out.push({ side, tier, rows: list.map(r => ({ rn: r.rn, name: r.nameDisp, tel: r.tel, id: r.id, guzergah: r.guzergah })) });
      }
    };
    emit(byNP, 'İsim + telefon aynı');
    emit(byP, 'Sadece telefon aynı');
    emit(byN, 'Sadece isim aynı');
    return out;
  }

  /* Alan karşılaştırma */
  const differs = (a, b) => LG.key(a) !== LG.key(b);

  function compareFields(m, s, conf, mmap, smap, opts) {
    const level = (conf === 'id' || conf === 'both') ? 'high' : 'mid';
    const ch = [], warn = [];
    const has = f => mmap[f] && smap[f];

    if (mmap.id && s.id && s.id !== m.id) ch.push({ field: 'id', col: mmap.id, old: m.raw[mmap.id], val: s.id, level, kind: 'kimlik' });

    if (has('tel') && LG.validPhone(s.tel) && s.tel !== m.tel) {
      const val = /^0/.test(LG.str(m.telRaw)) ? '0' + s.tel : s.tel;
      ch.push({ field: 'tel', col: mmap.tel, old: m.telRaw, val, level, kind: 'iletişim' });
    }
    for (const f of ['gkodu', 'guzergah', 'durak']) {
      if (has(f) && LG.str(s[f]) && differs(m[f], s[f])) {
        ch.push({ field: f, col: mmap[f], old: m[f], val: LG.clean(s[f]), level, kind: 'güzergah' });
      }
    }
    if (has('departman') && LG.str(s.departman) && differs(m.departman, s.departman)) {
      ch.push({ field: 'departman', col: mmap.departman, old: m.departman, val: LG.clean(s.departman), level, kind: 'diğer' });
    }
    if (has('adres') && LG.str(s.adres)) {
      const newA = LG.clean(LG.stripFloor(s.adres));
      const ratio = LG.sim(LG.addrKey(m.adres), LG.addrKey(s.adres));
      if (!LG.str(m.adres) || ratio < opts.addrThreshold) {
        ch.push({ field: 'adres', col: mmap.adres, old: m.adres, val: newA, level, kind: 'adres', ratio: Math.round(ratio * 100) / 100 });
        if (LG.str(m.adres)) {
          const pa = LG.addrParts(m.adres), pb = LG.addrParts(s.adres);
          if (pa.ilce && pb.ilce && pa.ilce !== pb.ilce) warn.push({ type: 'İLÇE DEĞİŞİMİ', text: `${pa.ilce} → ${pb.ilce}`, severity: 'high' });
          else if (pa.mah && pb.mah && LG.sim(pa.mah, pb.mah) < 0.7) warn.push({ type: 'MAHALLE DEĞİŞİMİ', text: `${pa.mah} → ${pb.mah}`, severity: 'mid' });
        }
      }
    }
    /* İsim: eksik/farklı yazılmışsa öneri (her zaman turuncu) */
    if (s.name && m.name !== s.name) {
      if (namePrefix(m.name, s.name) || LG.sim(m.name, s.name) >= 0.88) {
        ch.push({ field: 'isim', old: m.nameDisp, val: s.nameDisp, level: 'mid', kind: 'kimlik' });
      } else if (conf === 'phone') {
        warn.push({ type: 'AYNI TELEFON, FARKLI İSİM', text: `${m.nameDisp} ↔ ${s.nameDisp}`, severity: 'high' });
      }
    }
    if (conf === 'name' && mmap.tel && smap.tel && m.tel && s.tel && m.tel !== s.tel) {
      warn.push({ type: 'AYNI İSİM, FARKLI TELEFON', text: `${m.tel} ↔ ${s.tel}`, severity: 'mid' });
    }
    return { ch, warn };
  }

  /* ── Ana senkron ───────────────────────────────────────── */
  function runSync(mainRowsRaw, srcRowsRaw, mmap, smap, options) {
    const opts = Object.assign({ addrThreshold: 0.85, matchByName: true, matchByPhone: true }, options || {});
    const M = mainRowsRaw.map((r, i) => model(r, i, mmap)).filter(r => r.name || r.id || r.tel);
    const S = srcRowsRaw.map((r, i) => model(r, i, smap)).filter(r => r.name || r.id || r.tel);

    const usedS = new Set(), matchOf = new Map(); // main rn → {s, conf}
    const warnings = [];

    /* 1) Sicil/SAP */
    const sById = {};
    S.forEach(s => addTo(sById, s.id, s));
    for (const m of M) {
      if (!m.id || !sById[m.id]) continue;
      let cands = sById[m.id].filter(s => !usedS.has(s.rn));
      if (!cands.length) continue;
      cands.sort((a, b) => LG.sim(b.name, m.name) - LG.sim(a.name, m.name));
      const s = cands[0];
      usedS.add(s.rn); matchOf.set(m.rn, { s, conf: 'id' });
      if (s.name && m.name && !nameClose(s.name, m.name)) {
        warnings.push({ rn: m.rn, name: m.nameDisp, type: 'SİCİL AYNI, İSİM FARKLI', text: `${m.nameDisp} ↔ ${s.nameDisp} (sicil ${m.id})`, severity: 'high' });
      }
    }

    /* 2) Alternatif eşleştirme (her iki yönde, güven sırasına göre üç geçiş) */
    const remS = () => S.filter(s => !usedS.has(s.rn));
    const remM = () => M.filter(m => !matchOf.has(m.rn));
    const passes = [
      { conf: 'both', test: (m, s) => LG.validPhone(m.tel) && m.tel === s.tel && m.name && s.name && nameClose(m.name, s.name) },
      { conf: 'name', on: opts.matchByName, unique: true, test: (m, s) => m.name && m.name === s.name },
      { conf: 'name', on: opts.matchByName, unique: true, test: (m, s) => m.name && namePrefix(m.name, s.name) && m.name.split(' ').length >= 2 },
      { conf: 'phone', on: opts.matchByPhone, unique: true, test: (m, s) => LG.validPhone(m.tel) && m.tel === s.tel },
    ];
    for (const p of passes) {
      if (p.on === false) continue;
      const rs = remS();
      /* Aynı kaynak satırına birden çok aday varsa tekil değildir */
      const claims = new Map();
      for (const m of remM()) {
        const c = rs.filter(s => p.test(m, s));
        if (!c.length) continue;
        if (p.unique && c.length > 1) continue;
        /* Sicil çakışması: ikisinin de sicili var ve farklıysa, isim+tel geçişi dışında eşleştirme */
        const s = c[0];
        if (p.conf !== 'both' && m.id && s.id && m.id !== s.id) continue;
        (claims.get(s.rn) || claims.set(s.rn, []).get(s.rn)).push(m);
      }
      for (const [srn, ms] of claims) {
        if (ms.length !== 1 && p.unique) continue;
        const s = S.find(x => x.rn === srn), m = ms[0];
        if (usedS.has(s.rn) || matchOf.has(m.rn)) continue;
        usedS.add(s.rn); matchOf.set(m.rn, { s, conf: p.conf });
      }
    }

    /* 3) Sonuçlar */
    const rows = []; // ana listenin her satırı için durum
    const changes = [];
    for (const m of M) {
      const mt = matchOf.get(m.rn);
      if (!mt) { rows.push({ rn: m.rn, status: 'removed', m, ch: [], warn: [] }); continue; }
      const { ch, warn } = compareFields(m, mt.s, mt.conf, mmap, smap, opts);
      warn.forEach(w => warnings.push(Object.assign({ rn: m.rn, name: m.nameDisp }, w)));
      rows.push({ rn: m.rn, status: ch.length ? 'updated' : 'same', m, s: mt.s, conf: mt.conf, ch, warn });
      ch.forEach(c => changes.push(Object.assign({ rn: m.rn, name: m.nameDisp, id: m.id || mt.s.id, conf: mt.conf }, c)));
    }
    const added = S.filter(s => !usedS.has(s.rn));

    /* Mükerrerler */
    const dups = findDuplicates(S, 'Kaynak').concat(findDuplicates(M, 'Yolcu listesi'));

    /* Güzergah özeti */
    const rk = r => LG.clean(r.guzergah || r.gkodu) || '(GÜZERGAHSIZ)';
    const routes = {};
    const R = k => routes[k] || (routes[k] = { route: k, before: 0, removed: 0, movedOut: 0, movedIn: 0, added: 0, after: 0, code: '' });
    for (const r of rows) {
      const from = rk(r.m);
      R(from).before++;
      if (!routes[from].code && r.m.gkodu) routes[from].code = LG.clean(r.m.gkodu);
      if (r.status === 'removed') { R(from).removed++; continue; }
      const newG = r.ch.find(c => c.field === 'guzergah'), newK = r.ch.find(c => c.field === 'gkodu');
      const to = (mmap.guzergah && smap.guzergah) ? (newG ? LG.clean(newG.val) : from)
        : (mmap.gkodu && smap.gkodu && !mmap.guzergah) ? (newK ? LG.clean(newK.val) : from) : from;
      if (to !== from) { R(from).movedOut++; R(to).movedIn++; }
      R(to).after++;
    }
    for (const s of added) {
      const k = rk(s); R(k).added++; R(k).after++;
      if (!routes[k].code && s.gkodu) routes[k].code = LG.clean(s.gkodu);
    }
    const routeSummary = Object.values(routes).map(x => Object.assign(x, { diff: x.after - x.before }))
      .sort((a, b) => a.route.localeCompare(b.route, 'tr'));

    const stats = {
      main: M.length, src: S.length,
      removed: rows.filter(r => r.status === 'removed').length,
      updated: rows.filter(r => r.status === 'updated').length,
      same: rows.filter(r => r.status === 'same').length,
      added: added.length,
      byConf: rows.reduce((a, r) => (r.conf && (a[r.conf] = (a[r.conf] || 0) + 1), a), {}),
      routeChanges: rows.filter(r => r.ch.some(c => c.kind === 'güzergah')).length,
      idChanges: changes.filter(c => c.field === 'id').length,
      addrChanges: changes.filter(c => c.field === 'adres').length,
      telChanges: changes.filter(c => c.field === 'tel').length,
      midChanges: changes.filter(c => c.level === 'mid').length,
      ilceWarnings: warnings.filter(w => w.type === 'İLÇE DEĞİŞİMİ').length,
    };
    return { rows, added, changes, warnings, dups, routeSummary, stats, mmap, smap };
  }

  /* YENİ EKLENENLER formatı */
  const NEW_COLS = ['Cinsiyet', 'Sicil No', 'Adı', 'Soyadı', 'Tel', 'Email', 'Site', 'Semt', 'Adresi', 'Kısa Adres', 'Görev', 'Departman', 'Açıklama', 'G.Kodu', 'Güzergah Adı'];
  function newListRows(addedRows, smap) {
    return addedRows.map(s => {
      let ad, soyad, cins;
      if (smap.ad && smap.soyad && !smap.adsoyad) {
        ad = LG.clean(s.raw[smap.ad]); soyad = LG.clean(s.raw[smap.soyad]);
        cins = LG.splitName(ad + ' ' + soyad).cinsiyet;
      } else { const sp = LG.splitName(s.nameDisp); ad = sp.ad; soyad = sp.soyad; cins = sp.cinsiyet; }
      return {
        'Cinsiyet': cins, 'Sicil No': s.id || '', 'Adı': ad, 'Soyadı': soyad,
        'Tel': LG.validPhone(s.tel) ? s.tel : LG.str(s.telRaw), 'Email': '', 'Site': '', 'Semt': '',
        'Adresi': s.adres ? LG.clean(LG.stripFloor(s.adres)) : '', 'Kısa Adres': LG.clean(s.durak),
        'Görev': '', 'Departman': LG.clean(s.departman), 'Açıklama': '', 'G.Kodu': LG.clean(s.gkodu), 'Güzergah Adı': LG.clean(s.guzergah),
      };
    });
  }

  Object.assign(LG, { MAIN_FIELDS, SRC_FIELDS, autoMap, runSync, newListRows, NEW_COLS, namePrefix });
  if (typeof module !== 'undefined' && module.exports) module.exports = LG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
