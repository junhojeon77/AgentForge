import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  // The API's CORS allows only this dev-server origin, so the port must not drift.
  server: { port: 1420, strictPort: true },
});
