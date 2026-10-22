// ─── Service Worker: Cache-First / Offline-First (Kháng lỗi Server) ────────
const CACHE_NAME = 'html-viewer-v2';

// Danh sách tài nguyên cốt lõi cần nạp sẵn vào bộ nhớ thiết bị
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icons/icon-192.png',
  '/icons/icon-512.png'
];

// 1. Khi cài đặt: Tải trước toàn bộ tài nguyên vào Cache
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async cache => {
      await Promise.allSettled(
        PRECACHE_ASSETS.map(async url => {
          try {
            const res = await fetch(url, { cache: 'no-cache' });
            if (res && res.status === 200) {
              await cache.put(url, res);
            }
          } catch (e) {
            // Bỏ qua lỗi nạp riêng lẻ nếu có
          }
        })
      );
    }).then(() => self.skipWaiting())
  );
});

// 2. Khi kích hoạt: Dọn dẹp cache phiên bản cũ và tiếp quản ngay lập tức
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => {
      return Promise.all(
        keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key))
      );
    }).then(() => self.clients.claim())
  );
});

// 3. Xử lý Request: ƯU TIÊN BỘ NHỚ MÁY TUYỆT ĐỐI (Cache-First + Background Revalidate)
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // Bỏ qua blob URLs hoặc các giao thức không phải http/https
  if (!event.request.url.startsWith('http')) return;

  const url = new URL(event.request.url);

  // Chỉ can thiệp vào tài nguyên thuộc cùng domain website
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE_NAME);

      // [BƯỚC 1]: Kiểm tra ngay trong Cache của máy
      let cachedResponse = await cache.match(event.request);

      // Nếu là request điều hướng (navigate) mở app mà không thấy URL chính xác -> fallback về /index.html
      if (!cachedResponse && event.request.mode === 'navigate') {
        cachedResponse = await cache.match('/index.html') || await cache.match('/');
      }

      // [BƯỚC 2]: Chạy tác vụ kiểm tra ngầm server (Background Revalidation)
      // Tác vụ này chạy âm thầm trong nền, không làm chậm việc hiển thị giao diện
      const revalidatePromise = (async () => {
        try {
          const networkResponse = await fetch(event.request);

          // ⚠️ QUY TẮC AN TOÀN TUYỆT ĐỐI:
          // CHỈ cập nhật cache khi Server còn sống và phản hồi thành công (200 OK).
          // Nếu server bị Tạm Dừng, lỗi 404, 500, hết băng thông -> Hoàn toàn lờ đi, giữ nguyên cache cũ!
          if (networkResponse && networkResponse.status === 200) {
            await cache.put(event.request, networkResponse.clone());

            // Đồng bộ giữa '/' và '/index.html'
            if (url.pathname === '/' || url.pathname === '/index.html') {
              await cache.put('/', networkResponse.clone());
              await cache.put('/index.html', networkResponse.clone());
            }
          }
        } catch (err) {
          // Thiết bị mất mạng hoặc Server không liên lạc được -> Lờ đi trong im lặng
        }
      })();

      // Giữ cho service worker không bị ngắt khi đang cập nhật ngầm
      event.waitUntil(revalidatePromise);

      // [BƯỚC 3]: Nếu ĐÃ CÓ trong máy -> Trả về TỨC THÌ (0 giây, mở tức thì dù có mạng hay không)
      if (cachedResponse) {
        return cachedResponse;
      }

      // [BƯỚC 4]: Nếu CHƯA CÓ trong cache (trường hợp lần đầu tiên mở website)
      try {
        const freshResponse = await fetch(event.request);
        if (freshResponse && freshResponse.status === 200) {
          cache.put(event.request, freshResponse.clone());
        }
        return freshResponse;
      } catch (err) {
        // Trường hợp khẩn cấp: lấy index.html dự phòng
        const fallback = await cache.match('/index.html') || await cache.match('/');
        if (fallback) return fallback;
        throw err;
      }
    })()
  );
});
