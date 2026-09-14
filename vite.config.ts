import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      // 多页应用：对比度核验台 + 独立的行长预检工作台
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        precheck: fileURLToPath(new URL('./precheck.html', import.meta.url)),
      },
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
