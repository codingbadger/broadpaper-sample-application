# BroadPaper sample application

An Angular front end and a .NET Core back end using the BroadPaper SDK. A user
designs a report in the browser, exports it to PDF there, saves the template to
the server, and the server renders that saved template into the same PDF with no
browser anywhere near it.

It exists to test the packages as a customer receives them. Everything here is
installed from the packed npm tarballs and the packed `.nupkg` — not from a
source checkout wired in with path aliases — so if the packaging is wrong, this
breaks. Twice already, it has.

## What is in it

| | |
| --- | --- |
| `web/` | Angular 19. Hosts the designer, exports PDFs in the browser with the WebAssembly engine, and calls the API. |
| `api/` | ASP.NET Core on .NET 10. Owns the data contract, stores saved templates, and renders server-side through `BroadPaper.Client`. |
| `render-service/` | `@broadpaper/server`, the render service the API is a client of. |
| `tools/` | Builds the starter templates with `@broadpaper/core`, which is also the shortest proof it works outside a browser. |
| `scripts/vendor.mjs` | Packs the SDK out of its own repository into `vendor/` and installs it. |
| `vendor/` | The packed artefacts. Generated — not in git. |

Two reports are defined, in `api/data`. They share no fields and no code:

- **Account activity** — a half-year sales summary. KPIs, a bar chart against
  target, a donut by category, and a table of every order that runs onto a
  second page and repeats its header.
- **Invoice** — issuer and bill-to blocks, priced lines, VAT, and a balance due.

Adding a third is a folder with a `schema.json` and a `data.json` in it, plus a
line in `reports.json`. No C# changes.

## Three processes, and why

The .NET client does not render PDFs. It is an HTTP client for the render
service, which is a Node process that owns the engine — that separation is the
whole reason a .NET application can produce these files without a browser, a
JavaScript runtime, or a native PDF library on the server.

```
Angular (:4200)  ──►  ASP.NET Core API (:5170)  ──►  render service (:4780)
   designer,              templates, data,              the PDF engine
   browser export         BroadPaper.Client
```

The browser export path skips the middle entirely: the same engine, compiled to
WebAssembly, runs in the tab.

## Running it

You need Node 20.19+ or 22.12+, the .NET 10 SDK, and a BroadPaper checkout
beside this one (`../broadpaper`) with pnpm available.

```bash
node scripts/vendor.mjs        # build the SDK, pack it, install it
npm --prefix tools run seed    # starter templates, so page one is not blank
npm start                      # all three processes
```

Then open <http://localhost:4200>. Or run them separately, one per terminal:

```bash
cd render-service && BROADPAPER_TOKEN=dev npm start
BroadPaper__Token=dev dotnet run --project api/SampleApi.csproj --urls http://127.0.0.1:5170
cd web && npm start
```

`node scripts/vendor.mjs --sdk <path>` if the SDK is somewhere else, and
`--skip-build` if you have just built it.

### What to try

1. **Export in the browser.** Draws the PDF in the tab with WebAssembly. No
   server is involved; stop the other two processes and it still works.
2. **Render on the server.** Asks the API for the file. It renders the template
   that was last *saved*, which is why the button warns about unsaved changes.
3. **Change something, Save, then render on the server** — the point of the
   whole exercise. Rotating the page to landscape and rendering is the quickest
   proof the round trip is real.
4. **Switch reports.** The invoice has an entirely different schema, and the
   designer's field pickers change with it.

PDFs carry the evaluation watermark, because no licence is configured. That is
the only difference a licence makes: set `BROADPAPER_LICENSE` on the render
service and it goes away.

## Two things the packages need

Both were found by writing this, and both are worked around here in ways that
should be deleted when the packages are fixed.

**`@broadpaper/angular` is not built as an Angular library.** It is bundled with
tsup, so its `@Component` decorators are applied at runtime by a `__decorateClass`
helper and never become Angular's Ivy definitions. There is no `ɵcmp` on the
class, and Angular rejects the import outright:

```
TS-992012: Component imports must be standalone components, directives, pipes,
or must be NgModules.
```

As published, the package cannot be used by an Angular application at all. It
does ship its TypeScript source, so `web/tsconfig.json` points the import at
`node_modules/@broadpaper/angular/src/index.ts` and `tsconfig.app.json` adds that
file to the program, which makes this app's own Angular compiler compile it. That
is a workaround, not an integration: the fix is to build the package with
ng-packagr, like every other Angular library.

**Reaching the engine pulls in a `.wasm` ES module import.** `@broadpaper/forme`
loads `@formepdf/core` through a dynamic `import()` on a fallback path this app
never takes, but a bundler still has to resolve it — and the default browser
entry is the bundler-target build, which does `import * as wasm from
"./forme_bg.wasm"`. Angular's builder refuses that in a Zone.js application:

```
WASM/ES module integration imports are not supported with Zone.js applications
```

So this app is zoneless, and aliases `@formepdf/core` to the `worker` entry —
the same engine built for explicit initialisation, which `browser-pdf.ts` does
anyway against a `.wasm` copied in as a build asset. Zoneless suits a designer
that runs outside Angular's zone, but the SDK should not be the reason a host has
to choose it.

Worth noting separately, though it only costs disk: `@broadpaper/editor` depends
on `@broadpaper/pdf`, which depends on `playwright-core`. Any browser
application installing the designer pulls 14 MB of Chromium driver it can never
use. It wants to be an optional peer dependency.

## Things that will waste your time

**Pack after building, always.** `dist` is whatever the last build left, and
`LICENSE`/`THIRD-PARTY-NOTICES.md` are generated into each package and
git-ignored. Packing a stale tree gives you tarballs missing their notices and
carrying old code, and nothing announces it — the first version of this sample
tested a two-day-old SDK and showed PRO badges on blocks that had stopped
carrying a tier. `scripts/vendor.mjs` builds first for that reason.

**Re-packing at the same version does not update an install.** A lockfile pins
the integrity hash of the tarball it first saw, and every rebuild of 0.1.0
produces a different hash under the same filename. npm serves the old contents
from its cache and reports success. `scripts/vendor.mjs` deletes each
`package-lock.json` and each `node_modules/@broadpaper` before installing, and
clears Angular's dev-server cache, which caches its own copy on top.

**Sections go in `template.body`.** Assigning `template.sections` is plausible,
serialises without complaint, and renders an empty document whose only clue is
one warning: `The document has no content`.

**Rich text is a structured model, not HTML.** A line break is `\n`, which
`richTextFromTemplate` splits into paragraphs. `<br>` renders as four
characters.

**Table column widths should not total exactly 100.** That trips the engine's
own overflow check, which clamps the last column and reports a warning. Leave a
point of slack.

**The package is `BroadPaper.Client`; the namespace is `BroadPaper`.** `using
BroadPaper.Client;` does not compile, and the documentation's examples do not
show a `using` at all.
