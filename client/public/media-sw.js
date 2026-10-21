/* The TV's media cache (registered by client/src/components/MediaPreloader.jsx).
 *
 * The «Завантаження» screen downloads every video, sound and picture under
 * /assets/ into the "media" cache once; this worker then answers /assets/
 * requests from that cache — including the Range requests <video> makes when it
 * plays and seeks — so nothing streams over the internet during the game.
 * Anything not in the cache goes to the network as usual. Requests with ?mv=
 * are the preloader's own downloads and always go to the network.
 */
const CACHE = "media";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.pathname.startsWith("/assets/") || url.searchParams.has("mv")) return;
  e.respondWith(fromCache(req, url.pathname));
});

async function fromCache(req, key) {
  let hit;
  try {
    hit = await (await caches.open(CACHE)).match(key);
  } catch {
    hit = null;
  }
  if (!hit) return fetch(req);
  const range = req.headers.get("range");
  if (!range) return hit;

  const blob = await hit.blob();
  const size = blob.size;
  const m = /bytes=(\d*)-(\d*)/.exec(range);
  let start = 0;
  let end = size - 1;
  if (m && m[1]) {
    start = +m[1];
    if (m[2]) end = Math.min(+m[2], size - 1);
  } else if (m && m[2]) {
    start = Math.max(0, size - +m[2]); // "bytes=-N": the last N bytes
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
  }
  return new Response(blob.slice(start, end + 1), {
    status: 206,
    headers: {
      "Content-Type": hit.headers.get("Content-Type") || "application/octet-stream",
      "Content-Range": `bytes ${start}-${end}/${size}`,
      "Content-Length": String(end - start + 1),
      "Accept-Ranges": "bytes",
    },
  });
}
