import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "apps/site/src"),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    pool: "forks",
    fileParallelism: process.platform !== "win32",
    maxWorkers: process.platform === "win32" ? 1 : undefined,
    // Site build/export tests spawn Astro (and the RRS portable build in some
    // cases). Windows CI runners can take far longer than the 5s default; a
    // premature timeout kills an in-flight build and can leave the Astro build
    // lock behind for the next test. Keep a generous ceiling: heavy tests still
    // fail on real errors, but are not killed purely by slow CI hardware.
    testTimeout: 180_000,
    hookTimeout: 180_000,
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
