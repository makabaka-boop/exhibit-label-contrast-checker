import { defineConfig } from '@playwright/test';

// 本地运行时由 webServer 自动构建并启动预览服务；
// 在 Docker Compose 的 verify 服务中通过 BASE_URL 指向 web 容器。
const baseURL = process.env.BASE_URL ?? 'http://127.0.0.1:4173';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL,
    permissions: ['clipboard-read', 'clipboard-write'],
  },
  webServer: process.env.BASE_URL
    ? undefined
    : {
        command: 'npm run build && npm run preview -- --host 127.0.0.1 --port 4173 --strictPort',
        url: 'http://127.0.0.1:4173',
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
      },
});
