/* Al-Ghuse Tailor — offline-first service worker (v10).
   Same behavior as v9 — cache name bumped only so phones pick up
   the v10 index.html (silent write-path fixes + sync-status line).
   First visit caches only the small critical set (app shell + grid
   thumbnails + video posters, ~2 MB) so the app opens fast even on a
   slow connection. Full-size photos and videos then fill the cache in
   the background — VIDEOS FIRST, one file at a time, with retries —
   and the page shows the progress ("Preparing offline… X/41") until
   every file is cached ("Offline ready"). The fill is resumable: the
   page asks the worker to (re)start it on every load, so an
   interrupted fill (tab closed, worker stopped, network drop) always
   picks up where it left off instead of silently never finishing.
   Any file is also cached on demand when first fetched (200 only). */
const CACHE = 'alghuse-v10';
const CRITICAL = [
  "index.html",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "media/thumbs/01-grey-band-collar-kurta.jpg",
  "media/thumbs/02-black-contrast-kurta.jpg",
  "media/thumbs/03-brown-taupe-kurta.jpg",
  "media/thumbs/04-grey-mesh-stitch-kurta.jpg",
  "media/thumbs/05-navy-white-stitch-kurta.jpg",
  "media/thumbs/06-cream-embroidered-kurta.jpg",
  "media/thumbs/07-teal-cuff-kurta.jpg",
  "media/thumbs/08-brown-collar-kurta.jpg",
  "media/thumbs/09-black-red-stitch-kurta.jpg",
  "media/thumbs/10-beige-pattern-trim-kurta.jpg",
  "media/thumbs/11-white-chikankari-kurta.jpg",
  "media/thumbs/12-black-kurta.jpg",
  "media/thumbs/13-black-gold-piping-kurta.jpg",
  "media/thumbs/14-light-grey-blended-kurta.jpg",
  "media/thumbs/15-brown-cuff-kurta.jpg",
  "media/thumbs/16-brown-collar-closeup-kurta.jpg",
  "media/thumbs/17-navy-shirt-kurta.jpg",
  "media/thumbs/18-light-grey-black-trim-kurta.jpg",
  "media/thumbs/19-dark-purple-kurta.jpg",
  "media/thumbs/20-black-kurta.jpg",
  "media/thumbs/21-maroon-kurta.jpg",
  "media/thumbs/22-grey-shirt-collar-kurta.jpg",
  "media/thumbs/23-black-collar-kurta.jpg",
  "media/thumbs/24-black-kurta-model.jpg",
  "media/thumbs/25-grey-collar-closeup-kurta.jpg",
  "media/thumbs/26-olive-kurta.jpg",
  "media/thumbs/27-maroon-kurta-2.jpg",
  "media/thumbs/28-white-gold-button-kurta.jpg",
  "media/thumbs/32-navy-white-piping-kurta.jpg",
  "media/thumbs/33-dark-green-kurta.jpg",
  "media/thumbs/34-dark-grey-stitch-kurta.jpg",
  "media/thumbs/35-white-band-collar-kurta.jpg",
  "media/thumbs/36-white-brown-collar-kurta.jpg",
  "media/29-blue-shirt-collar-kurta-poster.jpg",
  "media/30-light-grey-mesh-collar-kurta-poster.jpg",
  "media/31-light-blue-shirt-poster.jpg",
  "media/video-black-kurta-poster.jpg",
  "media/video-folded-kurtas-poster.jpg",
  "media/video-grey-mesh-kurta-poster.jpg",
  "media/video-olive-purple-trim-kurta-poster.jpg",
  "media/video-white-kurta-poster.jpg"
];
/* Videos first: they are the biggest files and the ones users most
   often find missing offline, so they get cached before the photos. */
const VIDEOS = [
  "media/29-blue-shirt-collar-kurta.mp4",
  "media/30-light-grey-mesh-collar-kurta.mp4",
  "media/31-light-blue-shirt.mp4",
  "media/video-black-kurta.mp4",
  "media/video-folded-kurtas.mp4",
  "media/video-grey-mesh-kurta.mp4",
  "media/video-olive-purple-trim-kurta.mp4",
  "media/video-white-kurta.mp4"
];
const PHOTOS = [
  "media/01-grey-band-collar-kurta.jpg",
  "media/02-black-contrast-kurta.jpg",
  "media/03-brown-taupe-kurta.jpg",
  "media/04-grey-mesh-stitch-kurta.jpg",
  "media/05-navy-white-stitch-kurta.jpg",
  "media/06-cream-embroidered-kurta.jpg",
  "media/07-teal-cuff-kurta.jpg",
  "media/08-brown-collar-kurta.jpg",
  "media/09-black-red-stitch-kurta.jpg",
  "media/10-beige-pattern-trim-kurta.jpg",
  "media/11-white-chikankari-kurta.jpg",
  "media/12-black-kurta.jpg",
  "media/13-black-gold-piping-kurta.jpg",
  "media/14-light-grey-blended-kurta.jpg",
  "media/15-brown-cuff-kurta.jpg",
  "media/16-brown-collar-closeup-kurta.jpg",
  "media/17-navy-shirt-kurta.jpg",
  "media/18-light-grey-black-trim-kurta.jpg",
  "media/19-dark-purple-kurta.jpg",
  "media/20-black-kurta.jpg",
  "media/21-maroon-kurta.jpg",
  "media/22-grey-shirt-collar-kurta.jpg",
  "media/23-black-collar-kurta.jpg",
  "media/24-black-kurta-model.jpg",
  "media/25-grey-collar-closeup-kurta.jpg",
  "media/26-olive-kurta.jpg",
  "media/27-maroon-kurta-2.jpg",
  "media/28-white-gold-button-kurta.jpg",
  "media/32-navy-white-piping-kurta.jpg",
  "media/33-dark-green-kurta.jpg",
  "media/34-dark-grey-stitch-kurta.jpg",
  "media/35-white-band-collar-kurta.jpg",
  "media/36-white-brown-collar-kurta.jpg"
];
const FULL_MEDIA = [...VIDEOS, ...PHOTOS];

function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

async function broadcast(msg){
  try{
    const clients = await self.clients.matchAll({includeUncontrolled: true});
    clients.forEach(c => { try{ c.postMessage(msg); }catch(e){} });
  }catch(e){}
}

async function countCached(cache){
  let n = 0;
  for(const u of FULL_MEDIA){
    try{ if(await cache.match(u, {ignoreSearch: true})) n++; }catch(e){}
  }
  return n;
}

/* Background fill: cache every full-size file, videos first, one at a
   time with up to 3 tries per file. Sequential on purpose — 41
   concurrent fetches contend for one slow connection and the browser
   queues/drops them; one-at-a-time gives steady, reportable progress.
   Skips files already cached, so re-running the fill resumes exactly
   where a previous run stopped. Never throws. */
let filling = false;
async function fillFullMedia(){
  if(filling) return;
  filling = true;
  try{
    const cache = await caches.open(CACHE);
    let done = await countCached(cache);
    await broadcast({type: 'FILL_PROGRESS', done, total: FULL_MEDIA.length});
    if(done >= FULL_MEDIA.length){
      await broadcast({type: 'FILL_DONE', done, total: FULL_MEDIA.length});
      return;
    }
    for(const u of FULL_MEDIA){
      let hit = null;
      try{ hit = await cache.match(u, {ignoreSearch: true}); }catch(e){}
      if(hit) continue;
      let ok = false;
      for(let attempt = 0; attempt < 3 && !ok; attempt++){
        try{
          const res = await fetch(u);
          if(res && res.status === 200){ await cache.put(u, res); ok = true; }
          else if(attempt < 2) await sleep(1000);
        }catch(e){ if(attempt < 2) await sleep(1000); }
      }
      if(ok){
        done++;
        await broadcast({type: 'FILL_PROGRESS', done, total: FULL_MEDIA.length});
      }
    }
    done = await countCached(cache);
    await broadcast({type: done >= FULL_MEDIA.length ? 'FILL_DONE' : 'FILL_PROGRESS', done, total: FULL_MEDIA.length});
  }catch(e){
    /* Never fatal: the page re-triggers the fill on its next load. */
  }finally{
    filling = false;
  }
}

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(CRITICAL.map((u) => c.add(u).catch(() => {})))
    ).then(() => self.skipWaiting())
  );
  fillFullMedia();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
  fillFullMedia();
});

/* The page asks for a (re)fill on every load, so an interrupted fill
   always resumes. FILL_STATUS lets the page ask how far along it is. */
self.addEventListener('message', (e) => {
  const t = e.data && (e.data.type || e.data);
  if(t === 'FILL_MEDIA'){
    fillFullMedia();
  }else if(t === 'FILL_STATUS'){
    caches.open(CACHE).then(async (cache) => {
      const done = await countCached(cache);
      const msg = {type: done >= FULL_MEDIA.length ? 'FILL_DONE' : 'FILL_PROGRESS', done, total: FULL_MEDIA.length};
      if(e.source){ try{ e.source.postMessage(msg); }catch(err){} }
    }).catch(()=>{});
  }
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const range = e.request.headers.get('range');
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then((hit) => {
      if (hit) {
        if (!range) return hit;
        /* Media players ask for byte ranges. Answering a range request with
           the plain cached 200 response makes strict players (notably Android
           Chrome) refuse the video — no thumbnail, no playback. Slice the
           cached body and answer with a proper 206 Partial Content instead. */
        return hit.clone().arrayBuffer().then((buf) => {
          const total = buf.byteLength;
          const m = /bytes=(\d*)-(\d*)/.exec(range);
          let start = 0, end = total - 1;
          if (m && m[1] !== '') start = parseInt(m[1], 10);
          if (m && m[2] !== '') end = parseInt(m[2], 10);
          if (m && m[1] === '' && m[2] !== '') { start = Math.max(0, total - parseInt(m[2], 10)); end = total - 1; }
          if (isNaN(start) || isNaN(end) || start > end || start >= total) {
            return new Response(null, { status: 416, headers: { 'Content-Range': 'bytes */' + total } });
          }
          end = Math.min(end, total - 1);
          const headers = new Headers(hit.headers);
          headers.set('Content-Range', 'bytes ' + start + '-' + end + '/' + total);
          headers.set('Content-Length', String(end - start + 1));
          headers.set('Accept-Ranges', 'bytes');
          return new Response(buf.slice(start, end + 1), { status: 206, statusText: 'Partial Content', headers });
        }).catch(() => hit);
      }
      return fetch(e.request).then((res) => {
        /* Never store a 206 partial response in the cache — it would poison
           later full-file requests for the same video. */
        if (res.status === 200) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      }).catch(() => {
        /* Offline fallback is for navigations only. A media request that
           cannot be served must fail honestly instead of receiving HTML. */
        if (e.request.mode === 'navigate') return caches.match('index.html');
        return new Response(null, { status: 404 });
      });
    })
  );
});
