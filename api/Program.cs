using System.Text.Json;
using System.Text.Json.Nodes;
using BroadPaper;

// A minimal host for the BroadPaper SDK. It owns the data contract, stores the
// templates users design, and renders one server-side by calling the render
// service. It never renders a PDF itself: BroadPaper.Client is an HTTP client
// for that service, not a PDF engine, which is the whole reason a .NET
// application can produce these files with no browser and no JavaScript
// runtime of its own.
//
// Two reports are defined, in api/data. They share no code and no fields — the
// point being that the schema belongs to the host, and adding a third is a
// folder with a schema.json and a data.json in it, not a change to this file.

var builder = WebApplication.CreateBuilder(args);

builder.Services.AddBroadPaper(o =>
{
    o.BaseUrl = builder.Configuration["BroadPaper:BaseUrl"] ?? "http://127.0.0.1:4780";
    o.Token = builder.Configuration["BroadPaper:Token"];
});

// Either dev server is a different origin, so the browser needs telling. Both
// are listed because the two front ends are alternatives against this one API —
// whichever you started, it is the same server answering. Serve a front end
// together with the API in production and none of this is needed.
const string DevCors = "dev";
builder.Services.AddCors(o => o.AddPolicy(DevCors, p => p
    .WithOrigins(
        "http://localhost:4200", "http://127.0.0.1:4200",   // angular/
        "http://localhost:4300", "http://127.0.0.1:4300")   // react/
    .AllowAnyHeader()
    .AllowAnyMethod()));

var app = builder.Build();
app.UseCors(DevCors);

var catalogue = new ReportCatalogue(
    Path.Combine(AppContext.BaseDirectory, "data"),
    Path.Combine(app.Environment.ContentRootPath, "App_Data"));

// ── What reports exist ────────────────────────────────────────────────────

app.MapGet("/api/reports", () => Results.Text(catalogue.CatalogueJson(), "application/json"));

// ── The data contract ─────────────────────────────────────────────────────
//
// Both of these belong to the host, not to BroadPaper. The schema is the set of
// bindable fields the designer offers the user; the data is what it draws on
// the canvas. Serving them from here rather than hard-coding them in the
// Angular app is deliberate — the server-side render below reads exactly the
// same two files, so what the user designed against is what gets rendered.

app.MapGet("/api/reports/{id}/schema", (string id) =>
    catalogue.Has(id) ? Results.Text(catalogue.Schema(id), "application/json") : Results.NotFound());

app.MapGet("/api/reports/{id}/data", (string id) =>
    catalogue.Has(id) ? Results.Text(catalogue.Data(id), "application/json") : Results.NotFound());

// ── The template the user designed ────────────────────────────────────────

app.MapGet("/api/reports/{id}/template", (string id) =>
{
    if (!catalogue.Has(id)) return Results.NotFound();
    var saved = catalogue.ReadTemplate(id);
    return saved is null ? Results.NoContent() : Results.Text(saved, "application/json");
});

app.MapPut("/api/reports/{id}/template", async (string id, HttpRequest request) =>
{
    if (!catalogue.Has(id)) return Results.NotFound();

    using var reader = new StreamReader(request.Body);
    var json = await reader.ReadToEndAsync();

    // Parsed before it is stored, so a corrupt body fails here rather than at
    // render time — where the same problem would surface as "the service
    // rejected your template" and point at the wrong half of the system.
    try
    {
        JsonNode.Parse(json);
    }
    catch (JsonException e)
    {
        return Results.BadRequest(new { error = $"Not valid JSON: {e.Message}" });
    }

    catalogue.WriteTemplate(id, json);
    return Results.Ok(new { saved = true, bytes = json.Length });
});

// ── The server-side render ────────────────────────────────────────────────
//
// This is what the "Render on the server" button calls. Nothing here needs a
// browser: it is the saved template, the current data, and one HTTP call.

app.MapGet("/api/reports/{id}/report.pdf", async (string id, BroadPaperClient broadpaper, CancellationToken ct, bool download = false) =>
{
    if (!catalogue.Has(id)) return Results.NotFound();

    var template = catalogue.ReadTemplate(id);
    if (template is null) return Results.BadRequest(new { error = "No template saved for this report yet. Design one and press Save." });

    var report = catalogue.Definition(id);

    var result = await broadpaper.RenderWithWarningsAsync(new RenderRequest
    {
        Template = JsonNode.Parse(template),
        Data = JsonNode.Parse(catalogue.Data(id)),
        DataSources = JsonNode.Parse(catalogue.Schema(id)),
        Locale = report.Locale,
        Currency = report.Currency,

        // Fixes the clock, so the same template and data give byte-identical
        // output every time — which is what makes a rendered report safe to
        // hash, cache or assert on. Leave it unset and a report carrying a
        // "generated at" stamp differs on every call, correctly.
        Now = new DateTimeOffset(2026, 7, 1, 9, 0, 0, TimeSpan.Zero),

        Metadata = new RenderMetadata
        {
            Title = report.Name,
            Author = "Northwind Supply Co.",
            Lang = report.Locale
        }
    }, ct);

    // Warnings are things like a font that could not be embedded, or a style
    // with no equivalent. They are not failures and the PDF still arrives, but
    // they are worth logging.
    foreach (var w in result.Warnings) app.Logger.LogWarning("BroadPaper render warning ({Report}): {Warning}", id, w);

    return Results.File(
        result.Pdf,
        "application/pdf",
        download ? $"{id}.pdf" : null,
        enableRangeProcessing: false);
});

// ── Health ────────────────────────────────────────────────────────────────
//
// Reports the render service's health as well as its own, because "the API is
// up" is not the question anyone is asking when a PDF fails to arrive.

app.MapGet("/api/health", async (BroadPaperClient broadpaper, CancellationToken ct) =>
{
    object service;
    try
    {
        var health = await broadpaper.GetHealthAsync(ct);
        service = new { ok = health.Ok, backends = health.Backends, health.Active, health.Queued };
    }
    catch (Exception e)
    {
        service = new { ok = false, error = e.Message };
    }

    return Results.Ok(new
    {
        api = "ok",
        renderService = service,
        templates = catalogue.Ids().ToDictionary(i => i, i => catalogue.ReadTemplate(i) is not null)
    });
});

app.Run();

/// <summary>One report the host offers: its data contract and its saved template.</summary>
internal sealed record ReportDefinition(string Id, string Name, string Description, string Locale, string Currency);

/// <summary>
/// The reports on disk, and the templates users have saved for them.
/// </summary>
/// <remarks>
/// Files rather than a database, because this is a sample and a database would
/// be the largest thing in it. In a real application a saved template is a
/// column: it is the host's data, BroadPaper never stores it, and it is JSON
/// exactly so that it can live wherever the rest of your data already lives.
/// </remarks>
internal sealed class ReportCatalogue
{
    private readonly string dataDirectory;
    private readonly string templateDirectory;
    private readonly Dictionary<string, ReportDefinition> reports;
    private readonly string catalogueJson;

    public ReportCatalogue(string dataDirectory, string templateDirectory)
    {
        this.dataDirectory = dataDirectory;
        this.templateDirectory = templateDirectory;

        catalogueJson = File.ReadAllText(Path.Combine(dataDirectory, "reports.json"));
        reports = (JsonSerializer.Deserialize<List<ReportDefinition>>(catalogueJson,
                      new JsonSerializerOptions(JsonSerializerDefaults.Web)) ?? [])
                  .ToDictionary(r => r.Id);
    }

    public string CatalogueJson() => catalogueJson;
    public bool Has(string id) => reports.ContainsKey(id);
    public IEnumerable<string> Ids() => reports.Keys;
    public ReportDefinition Definition(string id) => reports[id];

    public string Schema(string id) => File.ReadAllText(Path.Combine(dataDirectory, id, "schema.json"));
    public string Data(string id) => File.ReadAllText(Path.Combine(dataDirectory, id, "data.json"));

    public string? ReadTemplate(string id)
    {
        var path = TemplatePath(id);
        return File.Exists(path) ? File.ReadAllText(path) : null;
    }

    public void WriteTemplate(string id, string json)
    {
        Directory.CreateDirectory(templateDirectory);
        File.WriteAllText(TemplatePath(id), json);
    }

    // `id` is only ever a key that exists in the catalogue — every caller checks
    // Has() first — so it cannot escape the directory.
    private string TemplatePath(string id) => Path.Combine(templateDirectory, $"{id}.template.json");
}
