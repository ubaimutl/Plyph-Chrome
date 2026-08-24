const schemeQuery = matchMedia("(prefers-color-scheme: dark)");
function report() {
  try {
    chrome.runtime
      .sendMessage({ type: "REPORT_COLOR_SCHEME", dark: schemeQuery.matches })
      .catch(() => {});
  } catch {
    /* Background may be starting up. */
  }
}
report();
schemeQuery.addEventListener("change", report);
