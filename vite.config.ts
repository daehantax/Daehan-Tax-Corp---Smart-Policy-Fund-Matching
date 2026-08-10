import path from 'path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(() => {
    return {
      // 커스텀 도메인(https://fund.daehantax.com)을 쓰므로 사이트가 루트로 서빙됩니다.
      // 예전에는 https://<계정>.github.io/<저장소이름>/ 하위 경로였어서 Pages 빌드에만
      // base 를 저장소 이름으로 붙였는데, 커스텀 도메인에서는 그 경로가 없어
      // 자산이 전부 404 가 되므로 '/' 로 둡니다.
      // (github.io/<저장소이름>/ 주소는 GitHub 이 커스텀 도메인으로 리다이렉트합니다)
      base: '/',
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
