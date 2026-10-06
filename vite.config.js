import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Capacitor apps are served from a local file:// / capacitor:// origin,
// so relative asset paths are required (base: "./").
export default defineConfig({
  plugins: [react()],
  base: "./",
  build: {
    outDir: "dist",
  },
});
