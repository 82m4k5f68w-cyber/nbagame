// Installable / offline game (PWA). The service worker (dist/sw.js, workbox via vite-plugin-pwa) and the manifest
// (public/manifest.webmanifest) only exist on a real web server (npm run server, any static host). Never registered
// for file://, inside an iframe, or on claude.ai (the published artifact): there the page stays a plain single file.
export function pwaAllowed(): boolean {
  try {
    if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return false;
    if (window.top !== window) return false;
    if (/(^|\.)claude(usercontent)?\.(ai|com)$|claudeusercontent/i.test(location.hostname)) return false;
    if ((window as any).__H2K_ARTIFACT || /[?&]nosw\b/.test(location.search)) return false;
    return location.protocol === "https:" || /^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname);
  } catch {
    return false;
  }
}
let deferred: any = null;
/** Register the worker + manifest and show `btn` while the browser offers installation (beforeinstallprompt). */
export function initPwa(btn?: HTMLElement | null) {
  if (!pwaAllowed()) return false;
  const l = document.createElement("link");
  l.rel = "manifest";
  l.href = "./manifest.webmanifest";
  document.head.appendChild(l);
  navigator.serviceWorker.register("./sw.js").catch(() => {});
  addEventListener("beforeinstallprompt", (e: any) => {
    e.preventDefault();
    deferred = e;
    if (btn) btn.hidden = false;
  });
  addEventListener("appinstalled", () => {
    deferred = null;
    if (btn) btn.hidden = true;
  });
  if (btn)
    btn.onclick = async () => {
      if (!deferred) return;
      deferred.prompt();
      await deferred.userChoice.catch(() => 0);
      deferred = null;
      btn.hidden = true;
    };
  return true;
}
