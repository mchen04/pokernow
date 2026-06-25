import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@common": path.resolve(__dirname, "common"),
    },
  },
  server: {
    port: 5173,
    strictPort: true,
    host: true, // expose on the LAN so a phone on the same WiFi can test it
  },
});
