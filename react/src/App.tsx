import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReportDesigner, ReportViewer, type ExportContext } from "@broadpaper/react";
import { createRegistry } from "@broadpaper/blocks";
import type { DataSource, ReportData, ReportTemplate, Theme } from "@broadpaper/core";
import { api, type ReportSummary } from "./report-api";
import { renderInBrowser } from "./browser-pdf";
import "./app.css";

type Tone = "info" | "success" | "error" | "working";

/**
 * The same application as `angular/`, in React.
 *
 * Deliberately so: the two exist to show that the integration is the same shape
 * either way, and that the interesting decisions — where the template is stored,
 * which side renders, when a save matters — belong to the host application
 * rather than to the framework it is written in. Where the two differ, the
 * difference is React's or Angular's and not BroadPaper's.
 */
export function App() {
  // The designer builds its own registry from the built-in blocks. This is a
  // second one with the same contents, for the browser-side export and the read
  // view — both of which render outside the designer and so need their own.
  // Register a custom block and it has to go into all of them, which is why
  // they are created the same way.
  const registry = useMemo(() => createRegistry(), []);

  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [dataSources, setDataSources] = useState<DataSource[] | undefined>();
  const [data, setData] = useState<ReportData | undefined>();
  const [template, setTemplate] = useState<ReportTemplate | undefined>();
  const [theme, setTheme] = useState<Theme | undefined>();
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  /**
   * Which of the three the page is showing.
   *
   * It opens on `home` rather than on the designer. A designer dropped straight
   * into a viewport explains nothing to somebody meeting this product for the
   * first time — it is dense, and every control on it is a guess. The overview
   * says what each of the four things does, and hands over the canvas only when
   * asked.
   */
  const [view, setView] = useState<"home" | "design" | "read">("home");
  const [status, setStatus] = useState<{ text: string; tone: Tone }>({ text: "Loading…", tone: "info" });

  const selected = reports.find((r) => r.id === selectedId);

  // The template as it currently stands, saved or not. Kept in a ref as well as
  // in state because the export handlers are given to the designer once and
  // would otherwise close over the template as it was when they were made.
  const live = useRef<ReportTemplate | null>(null);

  const fail = useCallback((message: string, e: unknown) => {
    const detail = e instanceof Error ? e.message : String(e);
    setStatus({ text: `${message} ${detail}`, tone: "error" });
    console.error("[sample]", message, e);
  }, []);

  /**
   * Loads one report's schema, data and saved template.
   *
   * All three arrive before the designer is shown rather than trickling in.
   * Swapping the data underneath a live designer is legitimate, but doing it on
   * load makes the page look like it is repainting because something broke.
   */
  const open = useCallback(
    async (id: string) => {
      setBusy(true);
      setLoaded(false);
      setStatus({ text: "Loading…", tone: "info" });
      try {
        const [sources, reportData, saved] = await Promise.all([api.schema(id), api.data(id) as Promise<ReportData>, api.template(id)]);
        setSelectedId(id);
        setView("home");
        setDataSources(sources);
        setData(reportData);
        setTemplate(saved ?? undefined);
        live.current = saved;
        setDirty(false);
        setLoaded(true);
        setStatus(
          saved
            ? { text: "Loaded the saved template.", tone: "info" }
            : { text: "Nothing saved for this report yet — starting blank.", tone: "info" }
        );
      } catch (e) {
        fail("Could not load the report.", e);
      } finally {
        setBusy(false);
      }
    },
    [fail]
  );

  useEffect(() => {
    void (async () => {
      try {
        const list = await api.reports();
        setReports(list);
        if (list.length) await open(list[0]!.id);
      } catch (e) {
        fail("Could not reach the API. Is it running on :5170?", e);
      }
    })();
  }, [open, fail]);

  /** Picking a report on the overview loads it and stays put. */
  function choose(id: string) {
    if (id === selectedId) return;
    if (dirty && !confirm("You have unsaved changes to this report. Switch anyway?")) return;
    void open(id);
  }

  // ── Save ────────────────────────────────────────────────────────────────

  async function save() {
    if (!live.current) return;
    setBusy(true);
    setStatus({ text: "Saving…", tone: "working" });
    try {
      await api.saveTemplate(selectedId, live.current);
      setDirty(false);
      setStatus({ text: "Saved. This is the version the server will render.", tone: "success" });
    } catch (e) {
      fail("Save failed.", e);
    } finally {
      setBusy(false);
    }
  }

  // ── Export in the browser ───────────────────────────────────────────────

  /**
   * Draws the PDF here, in this tab, with the WebAssembly engine.
   *
   * Also wired to the designer's own export button through `onExportPdf`, so
   * both routes end up in the same place.
   */
  const exportInBrowser = useCallback(
    async (ctx?: ExportContext) => {
      const doc = ctx?.template ?? live.current ?? undefined;
      const values = ctx?.data ?? data;
      if (!doc || !values) return;

      setBusy(true);
      setStatus({ text: "Rendering in the browser…", tone: "working" });
      try {
        const report = reports.find((r) => r.id === selectedId);
        const out = await renderInBrowser({
          template: doc,
          registry,
          data: values,
          theme: ctx?.theme ?? theme,
          dataSources: ctx?.dataSources ?? dataSources,
          locale: report?.locale,
          currency: report?.currency
        });
        openFile(out.blob, `${selectedId}-browser.pdf`);
        const plural = out.pages === 1 ? "" : "s";
        const warnings = out.warnings.length ? ` (${out.warnings.length} warning${out.warnings.length === 1 ? "" : "s"} — see the console)` : "";
        setStatus({ text: `Rendered ${out.pages} page${plural} in the browser${warnings}.`, tone: "success" });
        if (out.warnings.length) console.warn("[broadpaper] render warnings", out.warnings);
      } catch (e) {
        fail("Browser export failed.", e);
      } finally {
        setBusy(false);
      }
    },
    [data, dataSources, fail, registry, reports, selectedId, theme]
  );

  // ── Render on the server ────────────────────────────────────────────────

  /**
   * Asks the .NET API for the PDF.
   *
   * It renders the template that was *saved*, not what is on screen, which is
   * why an unsaved change is worth a warning: the file that came back would not
   * match the canvas, and that reads as a bug rather than a stale save.
   */
  async function renderOnServer() {
    if (dirty && !confirm("The server renders the template you last saved, and you have unsaved changes. Render the saved one anyway?")) return;
    setBusy(true);
    setStatus({ text: "Rendering on the server…", tone: "working" });
    try {
      const blob = await api.renderOnServer(selectedId);
      openFile(blob, `${selectedId}-server.pdf`);
      setStatus({ text: `Rendered on the server — ${(blob.size / 1024).toFixed(0)} KB, with no browser involved.`, tone: "success" });
    } catch (e) {
      fail("Server render failed.", e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header className="bar">
        <div className="bar__brand">
          <strong>BroadPaper</strong>
          <span>sample application</span>
        </div>

        {view === "home" ? (
          <p className="bar__description">React 19 · designer, viewer and PDF, against a .NET back end</p>
        ) : (
          <>
            <button type="button" className="bar__back" onClick={() => setView("home")}>
              ← Overview
            </button>
            <p className="bar__where">
              <strong>{selected?.name}</strong> — {view === "read" ? "read view" : "designer"}
            </p>
            <div className="bar__actions">
              {view === "design" ? (
                <button type="button" onClick={() => void save()} disabled={busy || !loaded}>
                  Save{dirty ? " •" : ""}
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => setView(view === "read" ? "design" : "read")}
                disabled={busy || !loaded || !template}
                title={template ? "The saved template as a reader would be given it" : "Save a template first"}
              >
                {view === "read" ? "Designer" : "Read view"}
              </button>
              <button type="button" onClick={() => void exportInBrowser()} disabled={busy || !loaded}>
                Export in the browser
              </button>
              <button type="button" className="primary" onClick={() => void renderOnServer()} disabled={busy || !loaded}>
                Render on the server
              </button>
            </div>
          </>
        )}
      </header>

      <p className={`status status--${status.tone}`} role="status">
        {status.text}
      </p>

      <main className="canvas">
        {view === "home" ? (
          <div className="home">
            <div className="home__inner">
              <p className="home__eyebrow">
                <span className="home__badge">React 19</span>
                <span>sample application</span>
              </p>

              <h1>A report designer inside your product, and the same report as a file.</h1>

              <p className="home__lede">
                BroadPaper is an embeddable report designer. Your users lay a report out; your application owns
                the data and the saved template; BroadPaper turns that template plus live data into a PDF — in
                the browser, on a server, or both. The template is the only thing that crosses between the two.
              </p>
              <p className="home__lede">
                This is a working application rather than a demo harness. It installs the packages the way you
                would, and every button below does the thing it says against a real .NET back end.
              </p>

              <div className="home__flow">
                <div className="home__node">
                  <b>React · :4300</b>
                  <span>This page. The designer, the read view, and PDF export in the tab.</span>
                </div>
                <span className="home__arrow" aria-hidden="true">
                  →
                </span>
                <div className="home__node">
                  <b>ASP.NET Core · :5170</b>
                  <span>Owns the schema, the data and the saved templates. Your application.</span>
                </div>
                <span className="home__arrow" aria-hidden="true">
                  →
                </span>
                <div className="home__node">
                  <b>Render service · :4780</b>
                  <span>A Node process holding the PDF engine. What .NET calls to render.</span>
                </div>
              </div>

              <p className="home__section">1 · Pick a report</p>
              <div className="home__reports">
                {reports.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    className="home__report"
                    aria-pressed={r.id === selectedId}
                    disabled={busy}
                    onClick={() => choose(r.id)}
                  >
                    <b>{r.name}</b>
                    <span>{r.description}</span>
                  </button>
                ))}
              </div>

              <p className="home__section">2 · Try each of the four things it does</p>
              <div className="cards">
                <div className="card">
                  <div className="card__head">
                    <h3>Design</h3>
                    <span className="card__where">in this page</span>
                  </div>
                  <p className="card__what">A fully embedded report designer.</p>
                  <p>
                    The designer your users would get, mounted as one component. Blocks on the left, the page in
                    the middle, properties on the right. It reads the schema this application declares and hands
                    back a template as JSON — it never sees your database and never calls your API. <b>Save</b>{" "}
                    is this sample <code>PUT</code>ting that JSON to .NET, which is all a save ever is.
                  </p>
                  <p className="card__action">
                    <button type="button" onClick={() => setView("design")} disabled={busy || !loaded}>
                      Open the designer
                    </button>
                  </p>
                </div>

                <div className="card">
                  <div className="card__head">
                    <h3>Read view</h3>
                    <span className="card__where">in this page</span>
                  </div>
                  <p className="card__what">The saved template as an interactive page.</p>
                  <p>
                    The same saved template, rendered with live data as a read-only document you can scroll,
                    select text in and point at charts in. Same paginator as the PDF, so the page breaks are the
                    ones in the file. This is what you show somebody who needs to <em>read</em> the report
                    rather than download it — the half of the product that is not a file.
                  </p>
                  <p className="card__action">
                    <button
                      type="button"
                      onClick={() => setView("read")}
                      disabled={busy || !loaded || !template}
                      title={template ? "" : "Open the designer and save one first"}
                    >
                      Open the read view
                    </button>
                  </p>
                </div>

                <div className="card">
                  <div className="card__head">
                    <h3>Export in the browser</h3>
                    <span className="card__where">no server</span>
                  </div>
                  <p className="card__what">A real PDF, drawn in this tab.</p>
                  <p>
                    The engine is Rust compiled to WebAssembly, so the file is produced here, on this machine,
                    with nothing uploaded and no server in the loop. Stop the API and the render service and
                    this still works. It is the same engine the server uses, which is why the two files agree.
                  </p>
                  <p className="card__action">
                    <button type="button" onClick={() => void exportInBrowser()} disabled={busy || !loaded}>
                      Export a PDF here
                    </button>
                  </p>
                </div>

                <div className="card">
                  <div className="card__head">
                    <h3>Render on the server</h3>
                    <span className="card__where">.NET</span>
                  </div>
                  <p className="card__what">The same document, produced by C#.</p>
                  <p>
                    The ASP.NET Core API loads the template it stored and asks the render service for the file.
                    No browser, no JavaScript runtime and no native PDF library on that box — the path a nightly
                    job or a webhook would take. It renders what was last <em>saved</em>, so it warns if you
                    have unsaved changes.
                  </p>
                  <p className="card__action">
                    <button
                      type="button"
                      className="primary"
                      onClick={() => void renderOnServer()}
                      disabled={busy || !loaded}
                    >
                      Render on the server
                    </button>
                  </p>
                </div>
              </div>

              <p className="home__note">
                The quickest proof the round trip is real: open the designer, rotate the page to landscape,{" "}
                <b>Save</b>, then <b>Render on the server</b> — the file that comes back from .NET is landscape.
                PDFs carry an evaluation watermark because no licence is configured; that is the only difference
                a licence makes. Set <code>BROADPAPER_LICENSE</code> on the render service and it goes away.
              </p>
            </div>
          </div>
        ) : loaded && view === "read" && template ? (
          <ReportViewer
            template={template}
            data={data}
            theme={theme}
            dataSources={dataSources}
            locale={selected?.locale}
            currency={selected?.currency}
          />
        ) : loaded ? (
          <ReportDesigner
            template={template}
            dataSources={dataSources}
            sampleData={data ? [{ id: "live", label: selected?.name ?? "Data", data }] : undefined}
            locale={selected?.locale}
            currency={selected?.currency}
            onExportPdf={exportInBrowser}
            onChange={(t) => {
              live.current = t;
              // Into state as well, so the read view shows the edit rather than
              // the last load. Handing it back to the designer is safe: the
              // wrapper ignores a template it just emitted, which is this one.
              setTemplate(t);
              setDirty(true);
            }}
            onThemeChange={setTheme}
          />
        ) : (
          <div className="placeholder">
            <p>{status.text}</p>
          </div>
        )}
      </main>
    </>
  );
}

/** Opens the file in a new tab, falling back to a download if that is blocked. */
function openFile(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const tab = window.open(url, "_blank");
  if (!tab) {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
  // Revoking straight away can cancel the load in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
