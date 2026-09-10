import { Component, OnInit, signal, computed, ChangeDetectionStrategy, inject } from "@angular/core";
import { ReportDesignerComponent, ReportViewerComponent, type ExportContext } from "@broadpaper/angular";
import { createRegistry } from "@broadpaper/blocks";
import type { DataSource, ReportData, ReportTemplate, Theme } from "@broadpaper/core";
import { ReportApiService, type ReportSummary } from "./report-api.service";
import { renderInBrowser } from "./browser-pdf";

type Tone = "info" | "success" | "error" | "working";

@Component({
  selector: "app-root",
  standalone: true,
  imports: [ReportDesignerComponent, ReportViewerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: "./app.component.html",
  styleUrls: ["./app.component.css", "./landing.css"]
})
export class AppComponent implements OnInit {
  private readonly api = inject(ReportApiService);

  // The designer builds its own registry from the built-in blocks. This is a
  // second one with the same contents, for the browser-side export — which
  // renders outside the designer and so needs its own. Register a custom block
  // and it has to go into both, which is why they are created the same way.
  private readonly registry = createRegistry();

  readonly reports = signal<ReportSummary[]>([]);
  readonly selectedId = signal<string>("");
  readonly selected = computed(() => this.reports().find((r) => r.id === this.selectedId()));

  readonly dataSources = signal<DataSource[] | undefined>(undefined);
  readonly sampleData = signal<ReportData | undefined>(undefined);
  readonly template = signal<ReportTemplate | undefined>(undefined);
  readonly loaded = signal(false);

  readonly status = signal<{ text: string; tone: Tone }>({ text: "Loading…", tone: "info" });
  readonly dirty = signal(false);
  readonly busy = signal(false);

  /** The template as it currently stands in the designer, saved or not. */
  private live: ReportTemplate | null = null;
  /** A signal, not a field: the read view rebuilds when the brand changes. */
  readonly theme = signal<Theme | undefined>(undefined);

  /**
   * Which of the three the page is showing.
   *
   * It opens on `home` rather than on the designer. A designer dropped straight
   * into a viewport explains nothing to somebody meeting this product for the
   * first time — it is dense, and every control on it is a guess. The overview
   * says what each of the four things does, and hands over the canvas only when
   * asked.
   */
  readonly view = signal<"home" | "design" | "read">("home");


  async ngOnInit(): Promise<void> {
    try {
      const reports = await this.api.reports();
      this.reports.set(reports);
      if (reports.length) await this.open(reports[0].id);
    } catch (e) {
      this.fail("Could not reach the API. Is it running on :5170?", e);
    }
  }

  /**
   * Loads one report's schema, data and saved template.
   *
   * All three arrive before the designer is shown rather than trickling in.
   * Swapping the data underneath a live designer is legitimate, but doing it on
   * load makes the page look like it is repainting because something broke.
   */
  private async open(id: string): Promise<void> {
    this.busy.set(true);
    this.loaded.set(false);
    this.status.set({ text: "Loading…", tone: "info" });

    try {
      const [dataSources, data, template] = await Promise.all([
        this.api.schema(id),
        this.api.data(id) as Promise<ReportData>,
        this.api.template(id)
      ]);

      this.selectedId.set(id);
      this.view.set("home");
      this.dataSources.set(dataSources);
      this.sampleData.set(data);
      this.template.set(template ?? undefined);
      this.live = template;
      this.dirty.set(false);
      this.loaded.set(true);

      this.status.set(template
        ? { text: "Loaded the saved template.", tone: "info" }
        : { text: "Nothing saved for this report yet — starting blank.", tone: "info" });
    } catch (e) {
      this.fail("Could not load the report.", e);
    } finally {
      this.busy.set(false);
    }
  }

  onTemplateChange(template: ReportTemplate): void {
    this.live = template;
    // Also into the signal, so the read view shows the edit rather than the last
    // load. Feeding it back to the designer is safe: the wrapper ignores a
    // template it just emitted, which is exactly this object.
    this.template.set(template);
    this.dirty.set(true);
  }

  onThemeChange(theme: Theme): void {
    this.theme.set(theme);
  }

  /**
   * The designer and the read view show the template as it stands, saved or
   * not, because the question they answer is "what does this look like" and not
   * "what would the server send". `renderOnServer` is the one that cares about
   * that, and warns.
   */
  show(view: "home" | "design" | "read"): void {
    if (view === "read" && !this.template()) return;
    this.view.set(view);
  }

  /** Picking a report on the overview loads it and stays put. */
  async choose(id: string): Promise<void> {
    if (id === this.selectedId()) return;
    if (this.dirty() && !confirm("You have unsaved changes to this report. Switch anyway?")) return;
    await this.open(id);
  }

  // ── Save ────────────────────────────────────────────────────────────────

  async save(): Promise<void> {
    if (!this.live) return;
    this.busy.set(true);
    this.status.set({ text: "Saving…", tone: "working" });
    try {
      await this.api.saveTemplate(this.selectedId(), this.live);
      this.dirty.set(false);
      this.status.set({ text: "Saved. This is the version the server will render.", tone: "success" });
    } catch (e) {
      this.fail("Save failed.", e);
    } finally {
      this.busy.set(false);
    }
  }

  // ── Export in the browser ───────────────────────────────────────────────

  /**
   * Draws the PDF here, in this tab, with the WebAssembly engine.
   *
   * Also wired to the designer's own export button through `onExportPdf`, so
   * both routes end up in the same place.
   */
  async exportInBrowser(ctx?: ExportContext): Promise<void> {
    const template = ctx?.template ?? this.live ?? undefined;
    const data = ctx?.data ?? this.sampleData();
    if (!template || !data) return;

    this.busy.set(true);
    this.status.set({ text: "Rendering in the browser…", tone: "working" });
    try {
      const report = this.selected();
      const out = await renderInBrowser({
        template,
        registry: this.registry,
        data,
        theme: ctx?.theme ?? this.theme(),
        dataSources: ctx?.dataSources ?? this.dataSources(),
        locale: report?.locale,
        currency: report?.currency
      });

      this.openFile(out.blob, `${this.selectedId()}-browser.pdf`);
      const plural = out.pages === 1 ? "" : "s";
      const warnings = out.warnings.length ? ` (${out.warnings.length} warning${out.warnings.length === 1 ? "" : "s"} — see the console)` : "";
      this.status.set({ text: `Rendered ${out.pages} page${plural} in the browser${warnings}.`, tone: "success" });
      if (out.warnings.length) console.warn("[broadpaper] render warnings", out.warnings);
    } catch (e) {
      this.fail("Browser export failed.", e);
    } finally {
      this.busy.set(false);
    }
  }

  // ── Render on the server ────────────────────────────────────────────────

  /**
   * Asks the .NET API for the PDF.
   *
   * It renders the template that was *saved*, not what is on screen, which is
   * why an unsaved change is worth a warning: the file that came back would not
   * match the canvas, and that reads as a bug rather than a stale save.
   */
  async renderOnServer(): Promise<void> {
    if (this.dirty() && !confirm("The server renders the template you last saved, and you have unsaved changes. Render the saved one anyway?")) return;

    this.busy.set(true);
    this.status.set({ text: "Rendering on the server…", tone: "working" });
    try {
      const blob = await this.api.renderOnServer(this.selectedId());
      this.openFile(blob, `${this.selectedId()}-server.pdf`);
      this.status.set({ text: `Rendered on the server — ${(blob.size / 1024).toFixed(0)} KB, with no browser involved.`, tone: "success" });
    } catch (e) {
      this.fail("Server render failed.", e);
    } finally {
      this.busy.set(false);
    }
  }

  // ── Odds and ends ───────────────────────────────────────────────────────

  /** Opens the file in a new tab, falling back to a download if that is blocked. */
  private openFile(blob: Blob, filename: string): void {
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

  private fail(message: string, e: unknown): void {
    const detail = e instanceof Error ? e.message : String(e);
    this.status.set({ text: `${message} ${detail}`, tone: "error" });
    console.error("[sample]", message, e);
  }

  /** Given to the designer so its own export button renders here too. */
  readonly onExportPdf = (ctx: ExportContext) => this.exportInBrowser(ctx);
}
