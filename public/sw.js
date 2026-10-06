/* Rexa service worker — اجرای آفلاین نسخه‌ی وب (GitHub Pages).
   صفحه‌ها: اول اینترنت (نسخه‌ی تازه)، اگر نبود از حافظه؛ فایل‌های هش‌دار: اول حافظه. */
const VERSION = "rexa-__BUILD__";
const CORE = ["./", "./index.html", "./manifest.webmanifest", "./icons/icon-192.png", "./icons/icon-512.png"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const fonts = url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";
  if (url.origin !== self.location.origin && !fonts) return; // API ها (گیت‌هاب، نرخ ارز) همیشه مستقیم از اینترنت
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => { const copy = res.clone(); caches.open(VERSION).then((c) => c.put("./index.html", copy)); return res; }).catch(() => caches.match("./index.html")));
    return;
  }
  if (fonts) {
    e.respondWith(caches.match(req).then((hit) => { const net = fetch(req).then((res) => { caches.open(VERSION).then((c) => c.put(req, res.clone())); return res; }).catch(() => hit); return hit || net; }));
    return;
  }
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req).then((res) => { if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; })));
});
