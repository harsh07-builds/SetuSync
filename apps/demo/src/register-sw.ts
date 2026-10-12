/** Registers the service worker in production builds only. */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) {
    return;
  }

  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register("/sw.js")
      .then(() => navigator.serviceWorker.ready)
      .then((registration) => {
        const urls = performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((name) => /\.(js|css|svg|png|webmanifest)(\?|$)/u.test(name));

        registration.active?.postMessage({ type: "CACHE_URLS", urls });
      })
      .catch(() => undefined);
  });
}
