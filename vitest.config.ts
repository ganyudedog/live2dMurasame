import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

// 后端/DAO 集成测试必须使用 Node fs/path/url，不能继承浏览器的 nodePolyfills。
export default defineConfig({
  resolve: { alias: { '@app': fileURLToPath(new URL('./src/app', import.meta.url)) } },
  test: { environment: 'node' },
});
