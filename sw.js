/* GrindTime service worker: offline support + notifications. The AI still needs a connection. */
const CACHE = "grindtime-v4";
const NUDGE = "grindtime-nudge";
const SHELL = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./maskable-512.png", "./apple-touch-icon.png"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== NUDGE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.hostname === "api.anthropic.com" || url.pathname.endsWith("/__nudge")) return;
  // App files: network first (picks up updates), cache when offline.
  if (req.mode === "navigate" || url.origin === location.origin) {
    e.respondWith(fetch(req).then(r => { const copy = r.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return r; })
      .catch(() => caches.match(req).then(r => r || caches.match("./index.html"))));
    return;
  }
  // Fonts: cache first.
  if (/fonts\.(googleapis|gstatic)\.com$/.test(url.hostname)) {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })));
  }
});

/* ---- Daily nudge (Periodic Background Sync – Android picks the exact time) ---- */
const pad = n => String(n).padStart(2, "0");
const dayKey = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());

async function dailyNudge() {
  const c = await caches.open(NUDGE);
  const r = await c.match("./__nudge");
  if (!r) return;
  const s = await r.json();
  if (!s.on) return;
  const now = new Date(), h = now.getHours();
  if (h < 8 || h >= 22) return;                          // no late-night pings
  const lastSent = await c.match("./__nudge_sent");
  if (lastSent) { const t = +(await lastSent.text()); if (Date.now() - t < 10 * 3600 * 1000) return; } // max ~2 a day

  const lines = [];
  const due = (s.due || []).filter(t => t <= Date.now()).length;
  if (due) lines.push(`🔁 ${due} mistake${due > 1 ? "s" : ""} due for review`);
  const face = s.date === dayKey(now) ? s.face : 0;
  if (h >= 18 && face < 0.7) lines.push(`✨ Face routine ${Math.round(face * 100)}% done today`);
  const q = s.date === dayKey(now) ? s.q : 0;
  if (h >= 15 && q < 10) lines.push(`✎ ${q}/10 study questions today`);
  const t0 = new Date(dayKey(now) + "T00:00");
  (s.exams || []).forEach(e => {
    const n = Math.round((new Date(e.d + "T00:00") - t0) / 864e5);
    if (n >= 0 && n <= 7) lines.push(`📅 ${e.n}: ${n === 0 ? "today" : n === 1 ? "tomorrow" : "in " + n + " days"}`);
  });
  if (!lines.length) return;
  await self.registration.showNotification("GrindTime", {
    body: lines.slice(0, 4).join("\n"), tag: "daily", icon: "icon-192.png", badge: "icon-192.png",
    data: { url: due ? "./#study" : "./#home" }
  });
  await c.put("./__nudge_sent", new Response(String(Date.now())));
}
self.addEventListener("periodicsync", e => { if (e.tag === "grindtime-daily") e.waitUntil(dailyNudge()); });

/* ---- Tapping a notification opens the right section ---- */
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(list => {
    for (const w of list) { if ("focus" in w) { w.navigate(url).catch(() => {}); return w.focus(); } }
    return self.clients.openWindow(url);
  }));
});
