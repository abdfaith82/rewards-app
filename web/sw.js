// خدمة عمل بسيطة: تخزّن هيكل الواجهة فقط. لا تخزّن أي طلبات API أو بيانات حسابات.
const CACHE = "rewards-shell-v1";
const SHELL = ["/", "/style.css", "/app.js", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (!SHELL.includes(url.pathname)) return; // كل ما عدا الهيكل يذهب للشبكة مباشرة
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
