# BroadPaper sample application

**An Angular front end, a React front end, and one .NET Core back end** using
the BroadPaper SDK. A user designs a report in the browser, reads it as a web
page, exports it to PDF there, saves the template to the server, and the server
renders that saved template into the same PDF with no browser anywhere near it.

Pick whichever front end matches your stack:

| | | |
| --- | --- | --- |
| **Angular** | `npm start` | http://localhost:4200 |
| **React** | `npm run start:react` | http://localhost:4300 |

They are the same application twice, deliberately. Same API, same four buttons,
same three render paths — so the difference between them is Angular's and
React's, and never BroadPaper's. The back end is shared rather than duplicated:
a fix to the API is a fix for both, and two copies of it would have drifted
inside a month.

It exists to test the packages as a customer receives them. Everything here is
installed from the packed npm tarballs and the packed `.nupkg` — not from a
source checkout wired in with path aliases — so if the packaging is wrong, this
breaks. Three times already, it has.

## What is in it

| | |
| --- | --- |
| `angular/` | Angular 19, zoneless. Designer, read-only viewer, browser export, and calls to the API. |
| `react/` | React 19 on Vite. The same, in React. |
| `api/` | ASP.NET Core on .NET 10. Owns the data contract, stores saved templates, and renders server-side through `BroadPaper.Client`. |
| `render-service/` | `@broadpaper/server`, the render service the API is a client of. |
| `tools/` | Builds the starter templates with `@broadpaper/core`, which is also the shortest proof it works outside a browser. |
| `scripts/vendor.mjs` | Packs the SDK out of its own repository into `vendor/` and installs it into every project. |
| `scripts/start.mjs` | Starts the render service, the API and one front end, and stops them together. |
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
Angular (:4200)                                                            
      or          ──►  ASP.NET Core API (:5170)  ──►  render service (:4780)
React (:4300)           templates, data,              the PDF engine
 designer, viewer,       BroadPaper.Client
 browser export
```

The browser export path skips the middle entirely: the same engine, compiled to
WebAssembly, runs in the tab.

## Running it

You need Node 20.19+ or 22.12+, the .NET 10 SDK, and a BroadPaper checkout
beside this one (`../broadpaper`) with pnpm available.

```bash
node scripts/vendor.mjs        # build the SDK, pack it, install it
npm --prefix tools run seed    # starter templates, so page one is not blank
npm start                      # Angular, on :4200
npm run start:react            # or React, on :4300
```

One front end at a time. They are alternatives against the same API, and running
both would only prove that two dev servers can hold two ports. Whichever you
start, the render service and the .NET API come up with it.

Then open the address it prints. Or run them separately, one per terminal:

```bash
cd render-service && BROADPAPER_TOKEN=dev npm start
BroadPaper__Token=dev dotnet run --project api/SampleApi.csproj --urls http://127.0.0.1:5170
cd angular && npm start        # or: cd react && npm start
```

`node scripts/vendor.mjs --sdk <path>` if the SDK is somewhere else, and
`--skip-build` if you have just built it.

Either one opens on an **overview**: what BroadPaper is, which front end is
running, the three processes and what each of them owns, and a card per
capability explaining what it does before you press it. The designer is dense
and unfamiliar the first time you meet it, and dropping somebody straight into
it explains nothing — so it is one click away rather than the front page.

### What to try

1. **Read view.** The saved template as the person it was written for would be
   given it: no palette, no panels, and charts that answer a pointer. Same
   paginator as the PDF, so the page breaks are the ones in the file — the half
   of the product that is not a download.
2. **Export in the browser.** Draws the PDF in the tab with WebAssembly. No
   server is involved; stop the other two processes and it still works.
3. **Render on the server.** Asks the API for the file. It renders the template
   that was last *saved*, which is why the button warns about unsaved changes.
4. **Change something, Save, then render on the server** — the point of the
   whole exercise. Rotating the page to landscape and rendering is the quickest
   proof the round trip is real.
5. **Switch reports.** The invoice has an entirely different schema, and the
   designer's field pickers change with it.

PDFs carry the evaluation watermark, because no licence is configured. That is
the only difference a licence makes: set `BROADPAPER_LICENSE` on the render
service and it goes away.

## Three things this sample found, all now fixed

Each of these made the packages unusable, or nearly so, from a real host
application. All three were fixed in the SDK on 10 September 2026, and the
workarounds this sample carried for them are gone — it now consumes the tarballs
exactly as a customer would.

**`@broadpaper/angular` was not built as an Angular library.** It was bundled
with tsup, so its `@Component` decorators were applied at runtime by a
`__decorateClass` helper and never became Angular's Ivy definitions. There was no
`ɵcmp` on the class, and Angular rejected the import outright:

```
TS-992012: Component imports must be standalone components, directives, pipes,
or must be NgModules.
```

This app worked around it by pointing the import at the package's own TypeScript
source so its Angular compiler compiled it. The package is now built with
ng-packagr and ships partial-compiled Ivy definitions and a FESM bundle, so the
alias and the extra file in `tsconfig.app.json` are both gone. It declares
`@angular/core >=19`, which is the version its partial declarations were emitted
against.

**Reaching the engine pulled in a `.wasm` ES module import.** `@broadpaper/forme`
loaded `@formepdf/core` through a dynamic `import()` on a fallback path this app
never takes, but a bundler still had to resolve it — and the default browser
entry is the bundler-target build, which does `import * as wasm from
"./forme_bg.wasm"`. Angular's builder refuses that in a Zone.js application:

```
WASM/ES module integration imports are not supported with Zone.js applications
```

So this app was zoneless and aliased `@formepdf/core` to the `worker` entry.
`@broadpaper/forme` now has a `browser` export condition whose build reaches the
engine through `worker` itself, and the other build is absent from the browser's
graph entirely — so the alias is gone. This app stays zoneless because that suits
a designer running outside Angular's zone, not because it has to: it builds with
`"polyfills": ["zone.js"]` too, which is the thing that used to be impossible.

**Installing the designer downloaded 14 MB of Chromium driver.**
`@broadpaper/editor` depended on `@broadpaper/pdf`, which depended on
`playwright-core`, so any browser application installing the designer got a
Chromium driver it can never run. The three browser helpers the editor actually
wanted — print, the render-service client, `downloadBlob` — have moved to
`@broadpaper/renderer`, and Playwright is now an optional peer of
`@broadpaper/pdf`. Nothing here changed; `node_modules/playwright-core` simply
stopped existing.

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
