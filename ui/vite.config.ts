import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "ui",
  plugins: [react()],
  build: {
    outDir: "../dist",
    emptyOutDir: true,
  },
});
