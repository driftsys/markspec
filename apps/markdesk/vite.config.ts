import react from "@vitejs/plugin-react";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

/**
 * `theme/markspec.css` starts with an `@import` of the IBM Plex fonts from a
 * remote font service. The app's content security policy allows bundled
 * fonts only (`src/styles/app.css` declares them), so drop that import.
 */
function bundledFontsOnly(): Plugin {
  return {
    name: "markdesk-bundled-fonts-only",
    enforce: "pre",
    transform(code, id) {
      if (!id.split("?")[0].endsWith("/theme/markspec.css")) return null;
      return code.replace(/^@import url\("https:[^"]*"\);\s*$/m, "");
    },
  };
}

export default defineConfig({
  plugins: [bundledFontsOnly(), react()],
  // `src/main.tsx` imports the repository's design tokens from
  // `../../theme/markspec.css`; Vite resolves these paths against the app
  // root and serves only the app and that folder.
  server: { fs: { allow: [".", "../../theme"] } },
  test: { environment: "jsdom" },
});
