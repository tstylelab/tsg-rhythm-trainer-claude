// ============================================================
// TSG Rhythm Trainer — Service Worker（オフライン対応）
// ============================================================
// 方針（更新事故を起こさないための設計）
//   ・ページ本体(index.html)は「ネット優先」：オンラインなら必ず最新版を取りに行く。
//     電波が無い／4秒応答が無い時だけ、保存しておいたコピーで起動する。
//   ・画像・音源・外部ライブラリは「保存版優先＋裏で更新」（同一オリジン）／
//     「保存版優先」（外部CDN・版固定）。
//
// CACHE の版名を上げるべき時：音源・アイコンなど「index.html以外のファイル」を
//   追加・削除した時。index.htmlの修正だけなら不要。
// 新しい音源やCDNライブラリを足したら CORE / OPTIONAL にも追加すること。
// ============================================================
const CACHE = 'tsg-rhythm-v1';

// 初回オンライン時に必ず保存する「オフライン起動に必要な最小セット」
const CORE = [
  './',
  './index.html',
  './manifest.json',
  './images/favicon-64.png',
  './images/apple-touch-icon-180.png',
  './images/icon-192.png',
  './images/icon-512.png',
  './images/icon-192-maskable.png',
  './images/icon-512-maskable.png',
  // メトロノーム音（ボイスカウント）
  './sounds/voice/v1.mp3', './sounds/voice/v2.mp3', './sounds/voice/v3.mp3', './sounds/voice/v4.mp3',
  './sounds/voice/v5.mp3', './sounds/voice/v6.mp3', './sounds/voice/v7.mp3',
  './sounds/voice/va.mp3', './sounds/voice/vu.mp3', './sounds/voice/vi.mp3', './sounds/voice/vo.mp3',
  // リズム読み上げ（タ・ア・ン・ツ）
  './sounds/readout/ta.wav', './sounds/readout/taa.wav', './sounds/readout/a.wav',
  './sounds/readout/n.wav', './sounds/readout/tsu.wav',
  // 効果音
  './sounds/effects/clear.mp3', './sounds/effects/stageclear.mp3',
];

// 外部CDNのライブラリ（失敗しても導入を止めない）。
// ※ <script integrity=...> 付きで読み込むため、CORSモードで取得して保存する
//    （不透明応答を保存すると整合性チェックに失敗してスクリプトが動かなくなる）
const OPTIONAL = [
  'https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdn.jsdelivr.net/npm/abcjs@6.4.4/dist/abcjs-basic-min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.addAll(CORE);
    await Promise.allSettled(OPTIONAL.map(async (url) => {
      const res = await fetch(new Request(url, { mode: 'cors' }));
      if (res && res.ok) await cache.put(url, res);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith('tsg-rhythm-') && k !== CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  const isPage = req.mode === 'navigate' ||
    (sameOrigin && (url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')));
  if (isPage) { event.respondWith(networkFirstPage(req)); return; }

  if (sameOrigin) { event.respondWith(staleWhileRevalidate(req)); return; }

  event.respondWith(cacheFirst(req));
});

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('timeout')), ms);
    promise.then((v) => { clearTimeout(t); resolve(v); }, (e) => { clearTimeout(t); reject(e); });
  });
}

async function networkFirstPage(req) {
  const cache = await caches.open(CACHE);
  try {
    const res = await withTimeout(fetch(req), 4000);
    if (res && res.ok) cache.put('./index.html', res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match('./index.html');
    if (cached) return cached;
    throw e;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  const refresh = fetch(req).then((res) => {
    if (res && res.ok) cache.put(req, res.clone());
    return res;
  }).catch(() => null);
  if (cached) { refresh.catch(() => {}); return cached; }
  const res = await refresh;
  if (res) return res;
  throw new Error('offline and not cached: ' + req.url);
}

async function cacheFirst(req) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(req);
  if (cached) return cached;
  const res = await fetch(req);
  if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
  return res;
}
