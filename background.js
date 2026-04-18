const EXTENSION_UI_PATH = "popup.html";

chrome.action.onClicked.addListener(async (tab) => {
  const extensionPageUrl = new URL(chrome.runtime.getURL(EXTENSION_UI_PATH));
  if (tab && Number.isInteger(tab.id)) {
    extensionPageUrl.searchParams.set("sourceTabId", String(tab.id));
  }

  try {
    await chrome.windows.create({
      url: extensionPageUrl.toString(),
      type: "popup",
      state: "maximized"
    });
  } catch (error) {
    // Some Chrome builds may reject "maximized" for popup windows.
    console.error("Failed to open maximized extension window:", error);
    await chrome.windows.create({
      url: extensionPageUrl.toString(),
      type: "popup"
    });
  }
});
