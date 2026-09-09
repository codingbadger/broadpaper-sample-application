/**
 * Packs the BroadPaper SDK out of its own repository and installs it here.
 *
 * The packages are not published yet, so this sample consumes them the way a
 * customer will once they are: as the real npm tarballs and the real .nupkg,
 * not as a source checkout wired in with path aliases. What CI produces as a
 * workflow artefact, this produces locally.
 *
 *   node scripts/vendor.mjs [--sdk ../broadpaper] [--skip-build]
 *
 * Three things it does that are easy to forget by hand, each of which cost an
 * hour the first time:
 *
 *   1. It builds the SDK first. LICENSE and THIRD-PARTY-NOTICES.md are
 *      generated into each package and git-ignored, and `dist` is whatever the
 *      last build left behind — pack without building and you get tarballs
 *      missing their notices and carrying code from whenever you last ran
 *      `pnpm build`. The symptom is subtle: everything works, and you are
 *      testing last week's SDK.
 *
 *   2. It uses `pnpm pack`, not `npm pack`. The packages depend on each other
 *      as `workspace:*`, and only pnpm resolves that to a real version on the
 *      way into the tarball. An npm-packed tarball installs nowhere.
 *
 *   3. It deletes each project's package-lock.json and its node_modules copy of
 *      @broadpaper before reinstalling. A lockfile pins the integrity hash of
 *      the tarball it first saw, and every rebuild at the same 0.1.0 produces a
 *      different hash for the same filename — so npm serves the old contents
 *      out of its cache and reports success.
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : fallback;
};

const sdk = resolve(root, flag("sdk", "../broadpaper"));
const skipBuild = args.includes("--skip-build");

if (!existsSync(join(sdk, "packages"))) {
  console.error(`No BroadPaper checkout at ${sdk}. Pass --sdk <path>.`);
  process.exit(1);
}

const run = (command, commandArgs, cwd) =>
  execFileSync(command, commandArgs, { cwd, stdio: "inherit", shell: process.platform === "win32" });

const npmDir = join(root, "vendor", "npm");
const nugetDir = join(root, "vendor", "nuget");

// ── Build ─────────────────────────────────────────────────────────────────

if (skipBuild) {
  console.log("Skipping the SDK build — hope you just ran it.\n");
} else {
  console.log(`Building the SDK in ${sdk}…\n`);
  run("pnpm", ["build"], sdk);
  run("dotnet", ["build", "dotnet/BroadPaper.Client/BroadPaper.Client.csproj", "-c", "Release"], sdk);
}

// ── Pack ──────────────────────────────────────────────────────────────────

rmSync(npmDir, { recursive: true, force: true });
rmSync(nugetDir, { recursive: true, force: true });
mkdirSync(npmDir, { recursive: true });
mkdirSync(nugetDir, { recursive: true });

console.log("\nPacking the npm packages…");
for (const name of readdirSync(join(sdk, "packages"))) {
  run("pnpm", ["pack", "--pack-destination", npmDir], join(sdk, "packages", name));
}

console.log("\nPacking the NuGet client…");
run("dotnet", ["pack", "dotnet/BroadPaper.Client/BroadPaper.Client.csproj", "-c", "Release", "--no-build", "--output", nugetDir], sdk);

// ── Install ───────────────────────────────────────────────────────────────

console.log("\nReinstalling…");
for (const project of ["render-service", "tools", "web"]) {
  const dir = join(root, project);
  // See note 3 above: without both of these, npm reports success and installs
  // the previous tarball's contents.
  rmSync(join(dir, "package-lock.json"), { force: true });
  rmSync(join(dir, "node_modules", "@broadpaper"), { recursive: true, force: true });
  run("npm", ["install"], dir);
}

// The dev server caches its dependency pre-bundle, and will happily keep
// serving the packages it saw last, which looks exactly like the install
// having failed.
rmSync(join(root, "web", ".angular", "cache"), { recursive: true, force: true });

console.log(`\nDone. ${readdirSync(npmDir).length} tarballs and ${readdirSync(nugetDir).length} nupkg in vendor/.`);
