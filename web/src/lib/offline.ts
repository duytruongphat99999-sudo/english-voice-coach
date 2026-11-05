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
  const batch = new AbortController();
  const cancel=()=>batch.abort(signal.reason);
  signal.addEventListener('abort',cancel,{once:true});
  let cursor=0,done=0;
  const worker=async()=>{
    while(cursor<urls.length){
      signal.throwIfAborted();batch.signal.throwIfAborted();
      const url=urls[cursor++];
      if(!await cache.match(url)){
        const res=await fetch(url,{signal:batch.signal});
        if(!res.ok||!res.headers.get('Content-Type')?.startsWith('audio/'))throw new Error('Không tải được âm thanh. Kiểm tra mạng rồi thử lại.');
        await cache.put(url,res);
      }
      onProgress(++done,urls.length);
    }
  };
  // Static MP3s need no synthesis. Four workers limit mobile download overhead.
  const workers=Array.from({length:Math.min(4,urls.length)},worker);
  try{await Promise.all(workers);}
  catch(e){batch.abort();await Promise.allSettled(workers);throw e;}
  finally{signal.removeEventListener('abort',cancel);}
  try { await navigator.storage?.persist?.(); } catch { /* Optional */ }
}
