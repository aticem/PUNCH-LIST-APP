import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// --- FIX: Node ortamına webcrypto enjekte ---
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;
// --------------------------------------------

export default defineConfig({
  plugins: [react()],
  server: { host: true, port: 5173 },
});
