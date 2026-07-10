import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      // GitHub Pages는 https://<계정>.github.io/<저장소이름>/ 하위 경로로 서빙되므로
      // Pages용 빌드(GITHUB_PAGES=true)일 때만 base 경로를 지정합니다.
      base: process.env.GITHUB_PAGES ? '/Daehan-Tax-Corp---Smart-Policy-Fund-Matching/' : '/',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
