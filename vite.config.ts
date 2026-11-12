/// <reference types="vitest/config" />
import { execSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsconfigPaths from "vite-tsconfig-paths";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import { brand } from "./src/brand/brand";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Inside a JS string literal in index.html's inline script.
const escapeJs = (s: string) => JSON.stringify(s).slice(1, -1);

/** Fills the %BRAND_*% placeholders in index.html from src/brand/brand.ts. */
function brandHtml(): Plugin {
  const values: Record<string, string> = {
    "%BRAND_NAME%": escapeHtml(brand.name),
    "%BRAND_DESCRIPTION%": escapeHtml(brand.description),
    "%BRAND_THEME_COLOR%": escapeHtml(brand.themeColor.initial),
    "%BRAND_STORAGE_PREFIX%": escapeJs(brand.storagePrefix),
  };
  return {
    name: "brand-html",
    transformIndexHtml: {
      order: "pre",
      handler: (html) =>
        html.replace(/%BRAND_[A-Z_]+%/g, (token) => {
          if (!(token in values)) throw new Error(`Unknown index.html placeholder ${token}`);
          return values[token];
        }),
    },
  };
}

/**
 * The build's version, saved with each feedback report: the short git commit
 * (CI's GITHUB_SHA, else the local checkout's HEAD), or "dev" when neither is known.
 */
function appVersion(): string {
  const sha = process.env.GITHUB_SHA?.trim();
  if (sha) return sha.slice(0, 7);
  try {
    const out = execSync("git rev-parse --short HEAD", { stdio: ["ignore", "pipe", "ignore"] });
    return out.toString().trim() || "dev";
  } catch {
    return "dev";
  }
}

// Plain browser-only SPA. File-based routes live in src/routes; the router
// plugin regenerates src/routeTree.gen.ts on dev/build (it must run before
// the React plugin).
export default defineConfig({
  // Served from the domain root locally; GitHub Pages builds set BASE_PATH to
  // "/<repo name>/" (see .github/workflows/pages.yml).
  base: process.env.BASE_PATH ?? "/",
  // Brand-owned static files (favicon.svg); see src/brand/README.md.
  publicDir: "src/brand/public",
  define: { __APP_VERSION__: JSON.stringify(appVersion()) },
  plugins: [
    brandHtml(),
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsconfigPaths(),
  ],
  optimizeDeps: {
    // Scan every source file up front so deps used only by lazily split routes
    // (recharts, xlsx, ...) are pre-bundled at startup instead of triggering a
    // mid-session re-optimize + reload (which shows up as "Invalid hook call").
    entries: ["index.html", "src/**/*.{ts,tsx}", "!src/**/*.test.ts"],
  },
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
  },
});
