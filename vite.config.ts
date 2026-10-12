/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

// Plain browser-only SPA. File-based routes live in src/routes; the router
// plugin regenerates src/routeTree.gen.ts on dev/build (it must run before
// the React plugin).
export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
