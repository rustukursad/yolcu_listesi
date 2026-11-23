# Liste Güncelleme

Yolcu listesini kaynak listeyle senkronlayan, durak dökümlerini karşılaştıran araç. Tek motor, iki kabuk:

| Klasör | Ne |
|---|---|
| `shared/` | **Tek kaynak.** Motor (`js/core.js`, `sync.js`, `stops.js`, `io.js`), arayüz (`js/ui.js`, `ui.css`, `ui.template.html`), ExcelJS |
| `outlook/` | Outlook eklentisi: `host-outlook.js` (mail eki okuma, cevaba ekleme, roamingSettings), `manifest.template.xml` |
| `chrome-extension/` | Chrome/Edge uzantısı (MV3). `js/`, `lib/`, `tool.html`, `tool.css` **üretilir**, elle düzenlemeyin |
| `dist/` | İndirilebilir paketler (üretilir) |
| `tools/build.py` | Derleme |

## Değişiklik akışı

1. Yalnız `shared/` (ve gerekirse `outlook/host-outlook.js`) düzenlenir.
2. `python3 tools/build.py` → Chrome uzantısı, `outlook/taskpane.html`, `outlook/manifest.xml` ve `dist/` yenilenir.
3. Commit + push → GitHub Pages yayınlar. Outlook eklentisi bir sonraki açılışta yeni sürümü alır; Chrome kullanıcıları zip'i yeniden yükler.

Yayın adresi değişirse: `python3 tools/build.py --base https://YENI-ADRES` ve kullanıcılar manifesti yeniden ekler.

## Ortam kancaları (`window.LGHost`)

`ui.js` ortamdan bağımsızdır; ortam şu isteğe bağlı alanları verir: `store {get,set}`, `download(blob,name)`,
`listAttachments()`, `readAttachment(id) → ArrayBuffer`, `attachToReply(blob,name,html)`, `onItemChanged(cb)`, `ready`.
Chrome uzantısı hiçbirini vermez (varsayılanlar: chrome.storage + indirme).

## Gereksinimler (Outlook)

- Mailbox 1.8: ek içeriği okuma (`getAttachmentContentAsync`)
- Mailbox 1.15: cevaba base64 ek (`displayReplyFormAsync`) — yoksa “Excel indir”e düşer
- İzin: `ReadWriteItem` (cevap formuna ek koymak için gerekir)
