/* Simgeye tıklanınca aracı tam sayfa sekmede aç (açıksa ona geç) */
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL('tool.html');
  try {
    const tabs = await chrome.tabs.query({ url });
    if (tabs.length) {
      await chrome.tabs.update(tabs[0].id, { active: true });
      await chrome.windows.update(tabs[0].windowId, { focused: true });
      return;
    }
  } catch (e) { /* sorgu izni yoksa yeni sekme aç */ }
  await chrome.tabs.create({ url });
});
