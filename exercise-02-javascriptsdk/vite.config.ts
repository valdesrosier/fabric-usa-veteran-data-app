import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import basicSsl from "@vitejs/plugin-basic-ssl";

export default defineConfig({
  plugins: [react(), basicSsl({ name: "veteran-atlas-localhost" })],
  server: {
    host: "localhost",
    port: 5173,
    strictPort: true,
    https: {},
  },
  preview: { host: "localhost", port: 5173, strictPort: true, https: {} },
  build: { chunkSizeWarningLimit: 2000 },
});
