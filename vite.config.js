import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    cors: true,
    strictPort: true,
    allowedHosts: [
      ".webcontainer.io",
      ".local-corp.webcontainer.io",
      ".github.dev",
      "localhost",
      "127.0.0.1"
    ],
    headers: {
      "Cross-Origin-Embedder-Policy": "unsafe-none",
      "Cross-Origin-Opener-Policy": "unsafe-none"
    }
  }
});
