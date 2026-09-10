/**
 * Overrides the installed BroadPaper packages with a local build of the SDK.
 *
 * You do not need this to run the sample. The packages are on npm and
 * nuget.org, and `npm install` gets them like any other dependency — which is
 * the point of this repository, and what the README tells you to do.
 *
 * This is for the other case: changing the SDK and wanting to see the change
 * here before publishing it. It packs the SDK out of its own checkout and
 * installs those tarballs over the top.
 *
 *   node scripts/vendor.mjs [--sdk ../broadpaper] [--skip-build]
 *
 * Installed with `--no-save`, so the manifests go on naming the published
 * versions and nothing you commit says otherwise. A plain `npm install` puts
 * the registry copies back.
 *
 * Two things it does that are easy to forget by hand, each of which cost an
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
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, readdirSync, readFileSync } from "node:fs";
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

/** Taken from the SDK itself, so a version bump there needs no edit here. */
const version = JSON.parse(readFileSync(join(sdk, "packages", "core", "package.json"), "utf8")).version;

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

console.log(`\nPacking the npm packages at ${version}…`);
for (const name of readdirSync(join(sdk, "packages"))) {
  // @broadpaper/angular is an ng-packagr build, and an Angular library is
  // packed from its dist: ng-packagr writes the published manifest itself —
  // entry points, the exports map, the FESM path — and puts it there beside the
  // compiled code. Packing the source directory produces a tarball with none of
  // that in it. Keyed on the file, so the next library built this way needs no
  // edit here, and matching what packages.yml does in the SDK's own CI.
  const dir = join(sdk, "packages", name);
  const built = join(dir, "dist");
  run("pnpm", ["pack", "--pack-destination", npmDir], existsSync(join(built, "package.json")) ? built : dir);
}

console.log("\nPacking the NuGet client…");
run("dotnet", ["pack", "dotnet/BroadPaper.Client/BroadPaper.Client.csproj", "-c", "Release", "--no-build", "--output", nugetDir], sdk);

// ── Install over the top ──────────────────────────────────────────────────

console.log("\nInstalling the local build over the published one…");
for (const project of ["render-service", "tools", "angular", "react"]) {
  const dir = join(root, project);
  if (!existsSync(join(dir, "package.json"))) {
    console.error(`No package.json in ${project}/ — the layout has moved.`);
    process.exit(1);
  }

  // Only the packages this project actually declares. Installing all ten
  // everywhere would put the designer into the render service and the server
  // into a browser app.
  const declared = Object.keys(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).dependencies ?? {})
    .filter((d) => d.startsWith("@broadpaper/"))
    .map((d) => join(npmDir, `broadpaper-${d.slice("@broadpaper/".length)}-${version}.tgz`));

  const missing = declared.filter((f) => !existsSync(f));
  if (missing.length) {
    console.error(`\nNot packed: ${missing.map((f) => f.split(/[\\/]/).pop()).join(", ")}`);
    console.error(`The SDK is at ${version}; this project wants packages that were not produced.`);
    process.exit(1);
  }
  if (!declared.length) continue;

  run("npm", ["install", "--no-save", ...declared], dir);
}

// The dev server caches its dependency pre-bundle, and will happily keep
// serving the packages it saw last, which looks exactly like the install
// having failed.
rmSync(join(root, "angular", ".angular", "cache"), { recursive: true, force: true });

console.log(`\nDone. ${readdirSync(npmDir).length} tarballs and ${readdirSync(nugetDir).length} nupkg in vendor/.`);
console.log("`npm install` in any project puts the published versions back.\n");
