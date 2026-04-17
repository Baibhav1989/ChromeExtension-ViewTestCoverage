const EXTENSION_UI_PATH = "popup.html";

chrome.action.onClicked.addListener(async () => {
  const extensionPageUrl = chrome.runtime.getURL(EXTENSION_UI_PATH);

  try {
    await chrome.windows.create({
      url: extensionPageUrl,
      type: "normal",
      state: "maximized"
    });
  } catch (error) {
    // Some Chrome builds may reject "maximized" on window creation.
    console.error("Failed to open maximized extension window:", error);
    await chrome.windows.create({
      url: extensionPageUrl,
      type: "normal"
    });
  }
});
