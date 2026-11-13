const CACHE_NAME = "cine-cr-shell-v1";
const APP_SHELL = "/";
self.addEventListener("install", event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      const response = await fetch(APP_SHELL, { cache: "reload" });
      if (response.ok) await cache.put(APP_SHELL, response);
    } catch (_) {}
    await self.skipWaiting();
  })());
});
self.addEventListener("activate", event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith("cine-cr-shell-") && key !== CACHE_NAME).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", event => {
  const request = event.request;
  if (request.method !== "GET" || request.mode !== "navigate") return;
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response && response.ok) {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(APP_SHELL, response.clone());
      }
      return response;
    } catch (_) {
      const cached = await caches.match(APP_SHELL);
      if (cached) return cached;
      return new Response("<!doctype html><html lang='pt-BR'><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>Cine-CR offline</title><body style='margin:0;background:#050505;color:white;font:16px system-ui;display:grid;min-height:100vh;place-items:center;text-align:center'><main><h1 style='color:#E50914'>CINE CR</h1><p>Você está sem conexão. Reconecte-se para acessar o catálogo.</p></main></body></html>", {headers:{"Content-Type":"text/html; charset=utf-8"}});
    }
  })());
});