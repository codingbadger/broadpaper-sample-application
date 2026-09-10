import { renderPdfPaginated } from "@broadpaper/forme";
import type { BlockRegistry, DataSource, ReportData, ReportTemplate, Theme } from "@broadpaper/core";
import { init, renderSerializedDocWithLayout } from "@formepdf/core/worker";

/**
 * Exports the report to a real PDF in the browser, with no server involved.
 *
 * This is the client-side half of the sample. The other half — the same
 * template rendered by the .NET API — goes through the render service, and the
 * two should produce the same document. That they are drawn by the same engine
 * is the reason they agree.
 *
 * Note the entry point. `@formepdf/core/browser` is the bundler-target build
 * and wires its WASM up implicitly via `import … from './forme_bg.wasm'`, which
 * asks the bundler to treat a .wasm file as a module. Rather than find out
 * whether this Angular version's esbuild does, this uses the `worker` entry —
 * the same engine, built for explicit initialisation — and hands it a URL. The
 * .wasm is copied into the build output by the `formeWasm` plugin in
 * vite.config.ts, and served at the same path by the dev server.
 */

let ready: Promise<void> | null = null;

/** Idempotent: `init` reuses its first promise, and so does this. */
function engine(): Promise<void> {
  ready ??= init(new URL("forme_bg.wasm", document.baseURI));
  return ready;
}

export interface ExportInput {
  template: ReportTemplate;
  registry: BlockRegistry;
  data: ReportData;
  theme?: Theme;
  dataSources?: DataSource[];
  locale?: string;
  currency?: string;
}

export interface ExportOutput {
  blob: Blob;
  pages: number;
  warnings: string[];
}

export async function renderInBrowser(input: ExportInput): Promise<ExportOutput> {
  const result = await renderPdfPaginated({
    template: input.template,
    registry: input.registry,
    data: input.data,
    theme: input.theme,
    dataSources: input.dataSources,
    locale: input.locale,
    currency: input.currency,
    metadata: { title: input.template.name, creator: "BroadPaper sample" },
    renderer: async (doc) => {
      await engine();
      return (await renderSerializedDocWithLayout(doc as never)) as never;
    }
  });

  // A Uint8Array view can sit inside a larger buffer, so slice before wrapping
  // it: hand the whole buffer to Blob and the file gains whatever else is in
  // there.
  const bytes = result.pdf.slice();

  return {
    blob: new Blob([bytes as unknown as BlobPart], { type: "application/pdf" }),
    pages: result.paged.totalPages,
    warnings: result.warnings ?? []
  };
}
