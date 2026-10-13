/// <reference types="vitest/config" />
/**
 * Integration tests against the local Supabase stack (`npm run test:integration`).
 * Not part of `npm test`: they need `npm run db:start` (and a seeded database,
 * `npm run db:reset`). They sign in as the demo users with supabase-js and run
 * the real sync layer (src/data/remote) in "supabase" mode.
 */
import { resolve } from "node:path";
import { defineConfig, loadEnv } from "vite";

// The CLI's public local-development values (the same on every machine), used
// when .env.local doesn't set them.
const LOCAL_URL = "http://127.0.0.1:54321";
const LOCAL_ANON_KEY =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";

const env = loadEnv("development", process.cwd(), "VITE_");

export default defineConfig({
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    // One database, shared demo users: run files one after another.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      VITE_DATA_SOURCE: "supabase",
      VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || env.VITE_SUPABASE_URL || LOCAL_URL,
      VITE_SUPABASE_ANON_KEY:
        process.env.VITE_SUPABASE_ANON_KEY || env.VITE_SUPABASE_ANON_KEY || LOCAL_ANON_KEY,
    },
  },
});
