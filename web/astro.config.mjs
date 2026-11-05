import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';
import tailwindcss from '@tailwindcss/vite';

// Build static. nginx serve dist va proxy /api sang evc-api => mot origin,
// khong CORS, khong can SSR adapter.
export default defineConfig({
  integrations: [preact()],
  vite: { plugins: [tailwindcss()] },
  build: {
    assets: '_assets',
    // 'file' => /review.html thay vi /review/index.html.
    //
    // Voi 'directory', nginx phai 301 tu /review sang /review/ — va no dung
    // server_name de dung Location, nen tra ve http://127.0.0.1/review/,
    // MAT ca cong. Qua Cloudflare tunnel thi con te hon: redirect ra sai
    // host luon. Xuat file phang thi try_files $uri.html khop ngay, 200,
    // khong redirect, bot mot vong round-trip tren 4G.
    format: 'file',
  },
});
