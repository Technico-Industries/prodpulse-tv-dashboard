import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    // Lets a TV / browser on the factory LAN open the dev server.
    host: true,
  },
});
