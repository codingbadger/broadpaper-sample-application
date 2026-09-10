import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);

/**
 * Copies the engine's WebAssembly next to the built assets.
 *
 * `browser-pdf.ts` uses `@formepdf/core/worker`, which does not fetch its own
 * `.wasm` — the caller says where it is. Resolving the path here rather than
 * hard-coding it means a version bump moves the file without anyone noticing,
 * and the same copy serves the dev server and the build.
 *
 * The Angular app does exactly this through an `assets` entry in angular.json.
 * Two build systems, one arrangement.
 */
function formeWasm() {
  // Resolved through the package's own exports map rather than by walking into
  // its directory: `./package.json` is not an exported subpath, and the .wasm
  // is, so this is both shorter and the arrangement the package supports.
  const source = require.resolve("@formepdf/core/pkg-web/forme_bg.wasm");
  return {
    name: "forme-wasm",
    configureServer(server: { middlewares: { use(path: string, fn: (req: unknown, res: { setHeader(k: string, v: string): void; end(b: Buffer): void }) => void): void } }) {
      server.middlewares.use("/forme_bg.wasm", (_req, res) => {
        res.setHeader("content-type", "application/wasm");
        res.end(readFileSync(source));
      });
    },
    closeBundle() {
      mkdirSync("dist", { recursive: true });
      copyFileSync(source, join("dist", "forme_bg.wasm"));
    }
  };
}

export default defineConfig({
  plugins: [react(), formeWasm()],
  server: { port: 4300 },
  preview: { port: 4300 }
});
