import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // Relative base so the same dist works when served from a CDN, capacitor://, or http://lan-ip:port.
  base: '',
  server: { port: 5173, host: true },
});
