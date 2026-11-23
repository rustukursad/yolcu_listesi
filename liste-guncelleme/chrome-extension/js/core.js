/* Liste Güncelleme — ortak yardımcılar (normalizasyon, isim, adres)
   Tarayıcıda globalThis.LG altında, Node'da module.exports olarak çalışır. */
(function (root) {
  'use strict';
  const LG = root.LG || (root.LG = {});

  /* ── Metin ─────────────────────────────────────────────── */
  const str = v => (v === null || v === undefined) ? '' : String(v).trim();
  const upTR = s => str(s).toLocaleUpperCase('tr-TR');
  const ASCII = { 'İ': 'I', 'I': 'I', 'Ğ': 'G', 'Ü': 'U', 'Ş': 'S', 'Ö': 'O', 'Ç': 'C', 'Â': 'A', 'Î': 'I', 'Û': 'U' };
  const fold = s => upTR(s).replace(/[İIĞÜŞÖÇÂÎÛ]/g, c => ASCII[c] || c);
  const collapse = s => s.replace(/\s+/g, ' ').trim();

  /* Karşılaştırma anahtarı: büyük harf, Türkçe karakter katlanmış, noktalama yok */
  const key = s => collapse(fold(s).replace(/[^A-Z0-9 ]+/g, ' '));
  const normName = s => key(s);

  /* Görünen değer: Türkçe büyük harf, tek boşluk, satır sonu yok */
  const clean = s => collapse(upTR(s).replace(/[\r\n\t]+/g, ' ').replace(/\s*([,;])\s*/g, '$1 ').replace(/\s+\./g, '.'));

  /* ── Telefon ───────────────────────────────────────────── */
  function normPhone(v) {
    let s = str(v);
    if (/^\d+\.0$/.test(s)) s = s.slice(0, -2);
    s = s.replace(/\D/g, '');
    if (s.startsWith('90') && s.length > 10) s = s.slice(2);
    if (s.startsWith('0')) s = s.slice(1);
    return s;
  }
  const validPhone = p => p.length === 10;

  /* ── Sicil / SAP ───────────────────────────────────────── */
  function normId(v) {
    let s = str(v);
    if (!s) return '';
    if (/^\d+\.0+$/.test(s)) s = s.replace(/\.0+$/, '');
    s = s.replace(/\s+/g, '');
    if (/^0+\d+$/.test(s)) s = s.replace(/^0+/, '');
    if (/^[-–—0]*$/.test(s) || /^(YOK|NULL|NAN|BOŞ|BOS|-)$/i.test(s)) return '';
    return upTR(s);
  }

  /* ── Benzerlik (Levenshtein oranı, SequenceMatcher'a yakın) ── */
  function lev(a, b) {
    if (a === b) return 0;
    if (!a.length) return b.length;
    if (!b.length) return a.length;
    let prev = new Array(b.length + 1), cur = new Array(b.length + 1);
    for (let j = 0; j <= b.length; j++) prev[j] = j;
    for (let i = 1; i <= a.length; i++) {
      cur[0] = i;
      for (let j = 1; j <= b.length; j++) {
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      }
      [prev, cur] = [cur, prev];
    }
    return prev[b.length];
  }
  const sim = (a, b) => {
    a = key(a); b = key(b);
    if (!a && !b) return 1;
    if (!a || !b) return 0;
    return 1 - lev(a, b) / Math.max(a.length, b.length);
  };

  /* ── Adres ─────────────────────────────────────────────── */
  /* Kat / daire / blok-içi detayları sil (harita aramasına yardım için) */
  function stripFloor(s) {
    let t = ' ' + upTR(s) + ' ';
    t = t.replace(/\b(KAT|KT)\s*[:.]?\s*\d+\b\.?/g, ' ')
         .replace(/\b(DAİRE|DAIRE|DA|D)\s*[:.]\s*\d+[A-Z]?\b/g, ' ')
         .replace(/\b(DAİRE|DAIRE)\s*\d+[A-Z]?\b/g, ' ')
         .replace(/\b(İÇ\s*KAPI|IC\s*KAPI|İÇ\s*KAPI\s*NO)\s*[:.]?\s*\d+[A-Z]?\b/g, ' ')
         .replace(/(\bNO\s*[:.]?\s*\d+[A-Z]?)\s*\/\s*\d+[A-Z]?\b/g, '$1')
         .replace(/(\bNO\s*[:.]?\s*\d+[A-Z]?)\s*-\s*\d+[A-Z]?\b/g, '$1');
    return collapse(t.replace(/\s+([,.])/g, '$1').replace(/^[,.\s]+|[,\s]+$/g, ''));
  }

  /* Adres karşılaştırma anahtarı: ASCII'ye katlanmış, kısaltmalar tekleştirilmiş */
  const ABBR = [
    [/\b(MAHALLESI|MAHALLE|MAH|MH)\b/g, 'MAH'],
    [/\b(CADDESI|CADDE|CAD|CD)\b/g, 'CAD'],
    [/\b(SOKAGI|SOKAK|SOK|SK)\b/g, 'SK'],
    [/\b(BULVARI|BULVAR|BULV|BLV)\b/g, 'BLV'],
    [/\b(APARTMANI|APARTMAN|APT|AP)\b/g, 'APT'],
    [/\b(NUMARA|NO)\b/g, 'NO'],
  ];
  function addrKey(s) {
    let t = key(stripFloor(s));
    for (const [re, rep] of ABBR) t = t.replace(re, rep);
    return collapse(t);
  }
  const normAddrText = addrKey;

  /* İlçe listesi (İstanbul, Kocaeli, Sakarya, Bursa, Tekirdağ yaygın) — key() biçiminde */
  const ILCE = ['ADALAR','ARNAVUTKOY','ATASEHIR','AVCILAR','BAGCILAR','BAHCELIEVLER','BAKIRKOY','BASAKSEHIR','BAYRAMPASA','BESIKTAS','BEYKOZ','BEYLIKDUZU','BEYOGLU','BUYUKCEKMECE','CATALCA','CEKMEKOY','ESENLER','ESENYURT','EYUPSULTAN','EYUP','FATIH','GAZIOSMANPASA','GUNGOREN','KADIKOY','KAGITHANE','KARTAL','KUCUKCEKMECE','MALTEPE','PENDIK','SANCAKTEPE','SARIYER','SILIVRI','SULTANBEYLI','SULTANGAZI','SILE','SISLI','TUZLA','UMRANIYE','USKUDAR','ZEYTINBURNU',
    'BASISKELE','CAYIROVA','DARICA','DERINCE','DILOVASI','GEBZE','GOLCUK','IZMIT','KANDIRA','KARAMURSEL','KARTEPE','KORFEZ',
    'ADAPAZARI','AKYAZI','ARIFIYE','ERENLER','FERIZLI','GEYVE','HENDEK','KARAPURCEK','KARASU','KAYNARCA','KOCAALI','PAMUKOVA','SAPANCA','SERDIVAN','SOGUTLU','TARAKLI',
    'NILUFER','OSMANGAZI','YILDIRIM','GEMLIK','MUDANYA','INEGOL','CORLU','CERKEZKOY','KAPAKLI','ERGENE','SULEYMANPASA','YALOVA','CIFTLIKKOY','ALTINOVA'];
  const ILCE_SET = new Set(ILCE);

  function addrParts(s) {
    const w = addrKey(s);
    const toks = w.split(' ');
    const part = { MAH: '', CAD: '', SK: '', BLV: '' };
    let buf = [];
    for (const t of toks) {
      if (t in part) { if (!part[t] && buf.length) part[t] = buf.slice(-3).join(' '); buf = []; }
      else if (t === 'NO') buf = [];
      else buf.push(t);
    }
    /* İlçe: sondan başa ilk tanınan ilçe (adreslerde ilçe/il genelde sonda) */
    let ilce = '';
    for (let i = toks.length - 1; i >= 0; i--) { if (ILCE_SET.has(toks[i])) { ilce = toks[i]; break; } }
    return { mah: part.MAH, cad: part.CAD || part.BLV, sok: part.SK, ilce };
  }

  /* ── İsimler: cinsiyet sözlüğü ve ad/soyad ayırma ─────── */
  const K = 'K', E = 'E';
  const FEMALE = 'AYSE FATMA EMINE HATICE ZEYNEP ELIF MERVE ESRA ZEHRA SULTAN HULYA OZLEM DERYA SEVGI MELEK HANDAN GULSUM HAVVA MERYEM KUBRA BUSRA TUBA TUGBA SEDA SIBEL SERAP SEVIM YASEMIN YELIZ YESIM NURAN NURCAN NURTEN NUR NURAY NURSEL NESRIN NAZLI NALAN NERMIN NESLIHAN NILAY NIL NILGUN EBRU EDA ECE ELA ESIN ESMA EYLUL FILIZ GAMZE GIZEM GONUL GUL GULAY GULER GULSEN GULTEN GULCAN GULHAN GUNAY HACER HALIME HAMIYET HANIFE HATUN HAZAL HILAL IREM IPEK ILKNUR ILKAY KADRIYE KEZBAN LALE LEYLA MELIKE MELTEM MINE MUGE MUNEVVER MUAZZEZ NAZAN NAZIRE NEBAHAT NECLA NEJLA NESE NEVIN NIHAL NURHAN OYA OZGE OZNUR PERIHAN PINAR RABIA RAZIYE REYHAN RUKIYE RUMEYSA SABRIYE SAADET SAFIYE SAKINE SALIHA SANIYE SEHER SELMA SEMA SEMRA SENA SENAY SERPIL SEVDA SEVILAY SEVINC SIDIKA SONGUL SUNA SUZAN SUMEYYE SERIFE SUKRAN SULE TULAY TURKAN UMMUHAN UMRAN ULKU YADIGAR YETER YILDIZ YURDAGUL ZERRIN ZUBEYDE ZULEYHA ZUHAL AYLA AYNUR AYSEL AYSUN AYTEN AYCAN AYGUL ARZU ASLI ASIYE AYSEGUL BAHAR BANU BELGIN BERNA BETUL BIRSEN BUKET BURCU CANAN CEREN CEYDA CIGDEM DAMLA DEMET DENIZ DIDEM DILEK DILARA DUYGU DUDU EMEL EMINE ESER FADIME FERIDE FERDA FIGEN FUNDA GULSAH HAVA HUMEYRA HURIYE IKBAL ISIL KAMILE KEVSER KUMRU MELIS MELISA MUKADDES MUBECCEL NAGIHAN NAIME NAILE NIMET NURGUL OZDEN OZLEM PAKIZE RAHIME REMZIYE SABAHAT SEDEF SELDA SELIN SELVI SEVGUL SEYMA SIDIKA TANSU TUGCE TUBA ULVIYE VILDAN YAGMUR YONCA ZELIHA ZEKIYE BEYZA BUSE CANSU DERIN DILAN EBRAR ECENUR ELCIN ELMAS EKIN ESLEM FATMANUR FIDAN GOZDE GURBET GULIN HABIBE HAFIZE HALENUR HIRANUR IZEL KUBRANUR MERVENUR NEHIR NISA NISANUR OZGUL SUDE SILA SIMGE TUGBA YAREN ZUMRUT AZRA ELANUR ESRANUR GUNES HUMA BERFIN ROJDA SAKINE SERAP SEVAL TUBA AYFER AYNUR GULDEN GULNUR GULSER GULIZAR HAYRIYE HAYAT HANIM SEMIHA SEBAHAT SAMIYE SUHEYLA SUREYYA UMMU NAZMIYE NEZAHAT NEZAKET NESIBE MUKERREM'.split(' ');
  const MALE = 'MEHMET AHMET MUSTAFA ALI HUSEYIN HASAN IBRAHIM ISMAIL OSMAN YUSUF MURAT OMER RAMAZAN HALIL SULEYMAN ABDULLAH MAHMUT RECEP SALIH FATIH KADIR EMRE HAKAN ADEM KEMAL YASAR BEKIR MUSA METIN SERKAN ORHAN BURAK ERKAN SINAN TUNCAY UGUR VOLKAN YAKUP YUNUS ZEKI ABDULKADIR ABDURRAHMAN ADNAN AHMET AKIN ALPER ALTAN ARIF ATAKAN AYDIN AYHAN BARIS BATUHAN BAYRAM BERKAY BILAL BIROL BULENT BURHAN CAFER CAN CANER CELAL CEM CEMAL CENGIZ CETIN CIHAN COSKUN DAVUT DOGAN DURSUN ECEVIT EMIN EMIR ENES ENGIN ENVER ERCAN ERDAL ERDEM ERDOGAN EREN ERHAN ERKAN ERSIN ERTAN ERTUGRUL ESAT EYUP FAHRI FARUK FERHAT FERIT FIKRET FURKAN GOKHAN GOKAY GURKAN HALIT HAMDI HAMZA HARUN HAYDAR HIKMET HILMI HUSNU IHSAN ILHAN ILKER ISA ISMET IZZET KAAN KAMIL KENAN KERIM KORAY KUBILAY LEVENT LUTFI MAHIR MEHDI MELIH MERT MESUT MEVLUT MITHAT MUAMMER MUHAMMED MUHAMMET MUHARREM MUHITTIN MUHSIN MUKREMIN MURAT MUSA MUZAFFER NAIM NAMIK NECATI NECDET NECIP NEDIM NEJAT NESET NEVZAT NIHAT NURETTIN NURI OGUZ OKAN OKTAY ONUR ORHAN OZAN OZER OZGUR OZKAN RAMAZAN RASIM RAUF REMZI RESAT RIFAT RIZA SADIK SAFFET SAMET SAMI SEDAT SEFA SELAHATTIN SELCUK SELIM SEMIH SERDAR SERHAT SEYFULLAH SEYIT SINAN SONER SUAT SUKRU SAHIN SENOL SERIF TAHA TAHIR TALHA TAMER TANER TARIK TAYFUN TEOMAN TOLGA TUFAN TUNAHAN TURAN TURGAY TURGUT UMIT UMUT VEDAT VEHBI VELI YAVUZ YASIN YILMAZ YUCEL YUKSEL ZAFER ZIYA ALPASLAN ARDA ATILLA AYKUT BAHADIR BATU BERK BERKAN BORA CAGATAY CAGRI CAHIT DENIZHAN DOGUKAN EFE EGEMEN EKREM ERAY ERCUMENT ERGUN EROL ESREF ETHEM EVREN FEVZI GALIP GAZI GOKSEL GUVEN HAKKI HALUK HASIM HUSAMETTIN IDRIS ILYAS KADIR KAZIM KEMALETTIN KORKMAZ KURSAD KUTLU MAHSUN MAZLUM MEMET MERDAN MESUT METE MIKAIL MUCAHIT MUCAHIT MUHAMMED NASIR NAZIM NEVZAT OGUZHAN OKTAY OLCAY ONDER ORCUN OSMAN OZCAN POLAT RAMAZAN RECAI RESUL RUSTU SABRI SADETTIN SAIT SALIM SEFER SELAMI SERVET SEYHMUS SIRRI SUAT SUPHI SEVKET SEMSETTIN SUKRU TACETTIN TALAT TANER TEVFIK TUNCER TURAN UFUK UGUR UNAL VAHIT VEYSEL YAHYA YALCIN YASAR YIGIT YUNUS ZEKERIYA ZUBEYIR ABDULLAH ABDULSAMET AGIT AZIZ BARIS BEDIRHAN BERAT BUGRA CEMIL DILAVER DOGAN EGE ELVIN EMIRHAN EMIRCAN ENSAR ERCEHAN FERDI FERIDUN FUAT GOKBERK GOKDENIZ GOKMEN GORKEM GULTEKIN GUNGOR HALIS HAYRETTIN HIDIR HOZAN HUZEYFE IKRAM IMDAT KUBILAY LEZGIN MAHFUZ MALIK BATIKAN BATIN BERDAN BERKANT BESIR BIRKAN BURHANETTIN BUNYAMIN CEYHAN CAGDAS DOGANCAN DURAN ERASLAN ERSEL FIKRI NUH HAMIT HAMI HICABI ALAADDIN ALAIDDIN AZAM YIGITCAN RIDVAN RIDVAN SERCAN SERHAN ONURCAN KAGAN KEREM CEYHUN TANER SEYFI ZAHIT VAHAP CUMA CUMALI TEMEL SAMIL SAMIL ERSAN ERSOY YUNUSEMRE SAMET UMUTCAN TAYLAN GOKTUG SENER'.split(' ');
  const UNISEX = new Set('DENIZ CAN NUR EVRIM DERYA GUNAY SEVGI ONUR'.split(' ').filter(x => x !== 'ONUR'));
  const GENDER = Object.create(null);
  FEMALE.forEach(n => GENDER[n] = K);
  MALE.forEach(n => { if (!GENDER[n]) GENDER[n] = E; });
  GENDER['DENIZ'] = '?'; GENDER['NUR'] = K;

  let customNames = Object.create(null); // kullanıcı eklemeleri (key → K/E)
  LG.setCustomNames = obj => { customNames = Object.assign(Object.create(null), obj || {}); };
  LG.getCustomNames = () => Object.assign({}, customNames);
  const genderOf = w => { const k = key(w); return customNames[k] || GENDER[k] || ''; };

  /* Ad/soyad ayırma — konuşmada oturan kural:
     2 kelime → AD / SOYAD
     3+ kelime erkek → son kelime soyad
     3+ kelime kadın + 2. kelime kadın ismi → ilk iki kelime ad
     3+ kelime kadın + 2. kelime erkek ismi / sözlükte yok → ilk kelime ad, kalan soyad (evlilik öncesi soyad) */
  function splitName(full) {
    const parts = clean(full).split(' ').filter(Boolean);
    if (!parts.length) return { ad: '', soyad: '', cinsiyet: '' };
    if (parts.length === 1) return { ad: parts[0], soyad: '', cinsiyet: toCins(genderOf(parts[0])) };
    const g = genderOf(parts[0]);
    if (parts.length === 2) return { ad: parts[0], soyad: parts[1], cinsiyet: toCins(g) };
    if (g === K) {
      const g2 = genderOf(parts[1]);
      if (g2 === K) return { ad: parts.slice(0, 2).join(' '), soyad: parts.slice(2).join(' '), cinsiyet: 'K' };
      return { ad: parts[0], soyad: parts.slice(1).join(' '), cinsiyet: 'K' };
    }
    return { ad: parts.slice(0, -1).join(' '), soyad: parts[parts.length - 1], cinsiyet: toCins(g) };
  }
  const toCins = g => g === K ? 'K' : g === E ? 'E' : '';

  /* ── Sütun otomatik algılama ────────────────────────────── */
  function detectColumn(headers, hints, exclude) {
    const hk = headers.map(h => key(h).replace(/ /g, ''));
    for (const hint of hints) {
      const hh = key(hint).replace(/ /g, '');
      const exact = hk.findIndex((h, i) => h === hh && !(exclude && exclude.has(headers[i])));
      if (exact >= 0) return headers[exact];
    }
    for (const hint of hints) {
      const hh = key(hint).replace(/ /g, '');
      if (hh.length < 4) continue; /* 'AD' gibi kısa ipuçları 'ADRES'e takılmasın */
      const part = hk.findIndex((h, i) => h.includes(hh) && !(exclude && exclude.has(headers[i])));
      if (part >= 0) return headers[part];
    }
    return '';
  }

  Object.assign(LG, { str, upTR, fold, key, clean, normName, normPhone, validPhone, normId, sim, lev,
    stripFloor, normAddrText, addrKey, addrParts, splitName, genderOf, detectColumn, ILCE_SET });

  if (typeof module !== 'undefined' && module.exports) module.exports = LG;
})(typeof globalThis !== 'undefined' ? globalThis : this);
