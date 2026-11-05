export const AUDIO_CACHE = 'evc-study-audio-v1';
export async function isDownloaded(urls: string[]): Promise<boolean> {
  if (!('caches' in window)) return false;
  const cache = await caches.open(AUDIO_CACHE);
  return (await Promise.all(urls.map(url => cache.match(url)))).every(Boolean);
}
export async function downloadAudio(urls: string[], onProgress: (done:number,total:number)=>void, signal:AbortSignal) {
  if (!('caches' in window) || !('serviceWorker' in navigator)) throw new Error('Cần HTTPS và trình duyệt hỗ trợ lưu offline.');
  await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject)=>setTimeout(()=>reject(new Error('Chưa sẵn sàng offline. Tải lại trang rồi thử lại.')),15000))]);
  const cache = await caches.open(AUDIO_CACHE);
  for (let i=0;i<urls.length;i++) {
    signal.throwIfAborted();
    if (!await cache.match(urls[i])) {
      const res = await fetch(urls[i],{signal});
      if (!res.ok || !res.headers.get('Content-Type')?.startsWith('audio/')) throw new Error('Không tải được âm thanh. Kiểm tra mạng rồi thử lại.');
      await cache.put(urls[i],res);
    }
    onProgress(i+1,urls.length);
  }
  try { await navigator.storage?.persist?.(); } catch { /* Optional */ }
}
