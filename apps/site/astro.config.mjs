import path from "node:path";
import { fileURLToPath } from "node:url";

import { defineConfig } from "astro/config";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const siteRootDir = __dirname;
const normalizeBase = (value) => {
  const trimmed = String(value || "/").trim();
  if (!trimmed || trimmed === "/") {
    return "/";
  }
  const withLeadingSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  return withLeadingSlash.endsWith("/")
    ? withLeadingSlash
    : `${withLeadingSlash}/`;
};
const siteBase = normalizeBase(process.env.ICM_SITE_BASE || "/");

export default defineConfig({
  site: "https://classical-guide.local",
  base: siteBase,
  output: "static",
  outDir: process.env.ICM_SITE_OUT_DIR || "../../output/site",
  vite: {
    resolve: {
      alias: {
        "@": path.resolve(siteRootDir, "src"),
      },
    },
  },
});
