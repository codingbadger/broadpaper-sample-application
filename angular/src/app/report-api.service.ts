import { Injectable } from "@angular/core";
import type { DataSource, ReportTemplate } from "@broadpaper/core";

/** One report the API offers, as listed by GET /api/reports. */
export interface ReportSummary {
  id: string;
  name: string;
  description: string;
  locale: string;
  currency: string;
}

/**
 * The .NET API, which owns the data contract and the saved templates.
 *
 * Nothing here talks to BroadPaper. The designer is given a schema and some
 * data, and hands back a template; all three are the host application's, and
 * this service is just how they get to and from the server.
 */
@Injectable({ providedIn: "root" })
export class ReportApiService {
  /** Overridden at build time in environments; the dev default is `dotnet run`. */
  readonly baseUrl = "http://127.0.0.1:5170";

  async reports(): Promise<ReportSummary[]> {
    return this.json<ReportSummary[]>("/api/reports");
  }

  async schema(id: string): Promise<DataSource[]> {
    return this.json<DataSource[]>(`/api/reports/${id}/schema`);
  }

  async data(id: string): Promise<Record<string, unknown>> {
    return this.json<Record<string, unknown>>(`/api/reports/${id}/data`);
  }

  /**
   * The saved template, or null when the user has not saved one yet.
   *
   * The API answers 204 rather than 404 in that case: "this report exists and
   * has no template" is a different thing from "no such report", and the
   * designer opens on a blank page for the first but should show an error for
   * the second.
   */
  async template(id: string): Promise<ReportTemplate | null> {
    const res = await fetch(`${this.baseUrl}/api/reports/${id}/template`);
    if (res.status === 204) return null;
    if (!res.ok) throw new Error(`GET template: ${res.status} ${res.statusText}`);
    return (await res.json()) as ReportTemplate;
  }

  async saveTemplate(id: string, template: ReportTemplate): Promise<void> {
    const res = await fetch(`${this.baseUrl}/api/reports/${id}/template`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(template)
    });
    if (!res.ok) throw new Error(await this.errorText(res));
  }

  /**
   * Renders the *saved* template on the server and returns the file.
   *
   * Deliberately takes no template argument. The whole point of the button this
   * sits behind is that the server renders what was stored, with no help from
   * the browser — the same call a nightly job or a webhook would make.
   */
  async renderOnServer(id: string): Promise<Blob> {
    const res = await fetch(`${this.baseUrl}/api/reports/${id}/report.pdf`);
    if (!res.ok) throw new Error(await this.errorText(res));
    return res.blob();
  }

  private async json<T>(path: string): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`);
    if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${res.statusText}`);
    return (await res.json()) as T;
  }

  /** The API reports problems as `{ error }`; fall back to the status line. */
  private async errorText(res: Response): Promise<string> {
    try {
      const body = await res.json();
      if (body && typeof body.error === "string") return body.error;
    } catch {
      // Not JSON. The status line is all there is.
    }
    return `${res.status} ${res.statusText}`;
  }
}
