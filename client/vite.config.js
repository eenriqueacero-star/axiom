import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [react()],
    build: {
      // 'hidden': the .map file is generated and deployed, but the bundle
      // carries no //# sourceMappingURL comment, so browsers never auto-fetch
      // it — visitors' devtools still show minified code. We can still pull
      // it by its known filename to decode a real stack trace when debugging
      // a prod crash, instead of reverse-engineering minified names by hand.
      sourcemap: 'hidden',
    },
    server: {
      port: 5173,
      proxy: {
        '/api': {
          target: env.VITE_API_TARGET || 'http://localhost:3001',
          changeOrigin: true,
        },
      },
    },
  };
});
