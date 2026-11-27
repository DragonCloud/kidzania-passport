import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages 網址：https://<帳號>.github.io/kidzania-passport/
const BASE = '/kidzania-passport/';

export default defineConfig({
  base: BASE,
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? 'dev'),
  },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // 不自動重新整理：避免蓋章填到一半被更新打斷；改由畫面上的提示讓使用者決定
      registerType: 'prompt',
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: BASE,
        name: 'KidZania 職業護照',
        short_name: '職業護照',
        description: '記錄孩子在 KidZania Taipei 的職業體驗（非官方家庭紀錄工具）',
        lang: 'zh-Hant-TW',
        start_url: BASE,
        scope: BASE,
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#fff8ec',
        theme_color: '#e8572a',
        categories: ['lifestyle', 'education'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // 程式、jobs.json／facilities.json（已打包進 JS）與圖示全部預快取，園區離線可用
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
        navigateFallback: `${BASE}index.html`,
      },
    }),
  ],
});
