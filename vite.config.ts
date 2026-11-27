import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// GitHub Pages 網址：https://<帳號>.github.io/kidzania-passport/
const BASE = '/kidzania-passport/';

export default defineConfig(({ mode }) => {
  // GitHub Actions 以環境變數帶入；本機開發讀 .env.local
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const syncConfigured = !!env.VITE_SUPABASE_URL?.trim() && !!env.VITE_SUPABASE_ANON_KEY?.trim();

  return {
    base: BASE,
    resolve: {
      // 未設定同步時，不把 supabase-js 打包進網站（也就不會被 Service Worker 預快取）
      alias: syncConfigured
        ? ({} as Record<string, string>)
        : { '@supabase/supabase-js': fileURLToPath(new URL('./src/sync/supabaseStub.ts', import.meta.url)) },
    },
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
            {
              src: 'icons/icon-512-maskable.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // 程式、jobs.json／facilities.json（已打包進 JS）與圖示全部預快取，園區離線可用
          globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
          navigateFallback: `${BASE}index.html`,
        },
      }),
    ],
  };
});
