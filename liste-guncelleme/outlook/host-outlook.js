/* Outlook ortamı: mail eklerini okur, sonucu cevaba ekler, ayarları Outlook hesabında saklar.
   ui.js'ten ÖNCE yüklenir. Office.js yoksa (sayfa tarayıcıda doğrudan açılırsa) sade web aracı gibi çalışır. */
(function () {
  'use strict';
  const H = { name: 'outlook', subtitle: 'Outlook eklentisi · veriler bu bilgisayarda işlenir' };
  let done; H.ready = new Promise(r => (done = r));
  const hasOffice = typeof Office !== 'undefined' && Office.onReady;
  const mbox = () => (hasOffice && Office.context && Office.context.mailbox) || null;
  const item = () => { const m = mbox(); return m && m.item; };
  const cb = fn => new Promise((res, rej) => fn(r => (r.status === 'succeeded' || r.status === Office.AsyncResultStatus?.Succeeded) ? res(r.value) : rej(new Error((r.error && r.error.message) || 'Outlook işlemi başarısız'))));

  if (hasOffice) Office.onReady(() => done()); else done();
  setTimeout(done, 4000); // Office.js yüklenemezse arayüz yine açılsın

  /* Ayarlar: Outlook hesabında (roamingSettings, ~32 KB, cihazlar arası) + yerel yedek */
  const local = {
    get(k, d) { try { const v = localStorage.getItem('lg_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('lg_' + k, JSON.stringify(v)); } catch (e) { /* */ } },
  };
  H.store = {
    async get(k, d) {
      const rs = mbox() && Office.context.roamingSettings;
      if (rs) { const v = rs.get(k); if (v !== undefined && v !== null) return v; }
      return local.get(k, d);
    },
    async set(k, v) {
      local.set(k, v);
      const rs = mbox() && Office.context.roamingSettings;
      if (!rs) return;
      rs.set(k, v);
      try { await cb(f => rs.saveAsync(f)); }
      catch (e) { rs.remove(k); console.warn('roamingSettings kaydedilemedi, yalnız bu cihazda saklandı', e); }
    },
  };

  /* Açık maildeki dosya ekleri */
  H.listAttachments = async () => {
    const it = item();
    if (!it || !it.attachments) return [];
    return it.attachments
      .filter(a => (a.attachmentType === 'file' || a.attachmentType === (Office.MailboxEnums && Office.MailboxEnums.AttachmentType.File)) && !a.isInline)
      .map(a => ({ id: a.id, name: a.name, size: a.size }));
  };
  H.readAttachment = async id => {
    const it = item();
    if (!it || !it.getAttachmentContentAsync) throw new Error('Bu Outlook sürümü ek içeriğini okumayı desteklemiyor. Eki kaydedip dosyadan yükleyin.');
    const v = await cb(f => it.getAttachmentContentAsync(id, f));
    if (v.format !== 'base64' && v.format !== (Office.MailboxEnums && Office.MailboxEnums.AttachmentContentFormat.Base64)) {
      throw new Error('Ek bir dosya değil (' + v.format + '). Excel/CSV ekini seçin.');
    }
    return LG.b64ToBuf(v.content);
  };

  /* Sonucu cevaba ekle (Mailbox 1.15: base64 ek) */
  H.attachToReply = async (blob, name, html) => {
    const it = item();
    if (!it || !it.displayReplyFormAsync) throw new Error('Açık bir mail yok.');
    if (!Office.context.requirements.isSetSupported('Mailbox', '1.15')) {
      throw new Error('Bu Outlook sürümü cevaba ek koymayı desteklemiyor. "Excel indir"i kullanın.');
    }
    const base64file = await LG.blobToB64(blob);
    await cb(f => it.displayReplyFormAsync({ htmlBody: html, attachments: [{ type: 'base64', name, base64file, isInline: false }] }, f));
  };

  /* İndirme: görev bölmesinden indirme engellenirse kullanıcıyı cevaba ekleme yoluna yönlendir */
  H.download = (blob, name) => {
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    const t = document.getElementById('toast');
    if (t) { t.textContent = 'İndirme başladı: ' + name + ' — inmediyse "Cevaba ekle"yi kullanın'; t.className = 'show'; setTimeout(() => (t.className = ''), 5000); }
  };

  /* Sabitlenmiş bölmede başka maile geçince ekleri yenile */
  H.onItemChanged = handler => {
    H.ready.then(() => {
      const m = mbox();
      if (m && m.addHandlerAsync && Office.EventType) m.addHandlerAsync(Office.EventType.ItemChanged, () => handler());
    });
  };

  window.LGHost = H;
})();
