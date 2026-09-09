/**
 * Builds a starter template for each report and writes it where the API keeps
 * saved templates, so a fresh clone renders something on the first run instead
 * of a blank page and an error.
 *
 * These are ordinary templates with no special status. Redesign either one in
 * the browser, press Save, and the file this wrote is replaced — which is the
 * point of the exercise. Run `npm run seed` again to put the starters back.
 *
 * It is also the shortest proof that @broadpaper/core works outside a browser:
 * a template is a plain data structure, built here by a Node script with no DOM
 * anywhere in sight.
 *
 * Two things worth knowing if you edit these, both of which cost time to learn
 * the first way round:
 *
 *   * Sections go in `template.body`. Assigning `template.sections` looks
 *     plausible, serialises without complaint, and renders an empty document
 *     whose only warning is "The document has no content".
 *
 *   * Rich text is a structured model, not HTML. A line break is "\n", which
 *     richTextFromTemplate splits into paragraphs; "<br>" is drawn as the four
 *     characters it is.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRegistry } from "@broadpaper/blocks";
import { createTemplate, createSection, createRow, createNode, richTextFromTemplate, setDeterministicIds } from "@broadpaper/core";

const here = dirname(fileURLToPath(import.meta.url));
const outputDirectory = join(here, "..", "api", "App_Data");

const registry = createRegistry();

/** `createNode` with the registry already bound, because every call needs it. */
const node = (type, props, extra = {}) => createNode(registry, type, { ...extra, props });
const text = (template, extra = {}) => node("text", { content: richTextFromTemplate(template) }, extra);
const heading = (value, level, extra = {}) => node("heading", { text: value, level }, extra);

// ── Account activity ──────────────────────────────────────────────────────

function salesTemplate() {
  // Ids are derived from a seed rather than random, so re-running this produces
  // the same file and a diff shows what actually changed.
  setDeterministicIds("sample-sales");

  const template = createTemplate({
    name: "Account activity",
    withEmptySection: false,
    currency: "GBP",
    locale: "en-GB",
    page: {
      margins: { top: 16, right: 16, bottom: 16, left: 16 },
      header: { height: 16, differentFirstPage: false },
      footer: { height: 14, differentFirstPage: false }
    }
  });

  template.header.default = [
    createSection({
      name: "Header",
      children: [
        createRow([7, 5], [
          [text("{{ company.name }}", { style: { fontWeight: 600 } })],
          [text("{{ report.title }} · {{ report.period }}", { style: { textAlign: "right", color: "$colors.mutedText" } })]
        ], { props: { verticalAlign: "middle" } })
      ]
    })
  ];

  template.footer.default = [
    createSection({
      name: "Footer",
      children: [
        createRow([8, 4], [
          [text("{{ company.name }} · VAT {{ company.vatNumber }}", { style: { textStyle: "small" } })],
          [node("pageNumber", { format: "Page {{page.number}} of {{page.total}}", align: "right" })]
        ], { props: { verticalAlign: "bottom" } })
      ]
    })
  ];

  const summary = createSection({
    name: "Summary",
    children: [
      heading("Account activity", "h1"),
      text("{{ customer.name }} · {{ customer.reference }} · {{ report.period }}", { style: { textStyle: "lead" } }),
      node("spacer", { height: 6 }),
      createRow([4, 4, 4], [
        [node("kpi", { label: "Total sales", value: 'sales.total | currency:"GBP":0', trend: "sales.growthPct", trendFormat: "percent", caption: "against the last period" })],
        [node("kpi", { label: "Orders", value: "sales.orderCount" })],
        [node("kpi", { label: "Average order", value: 'sales.averageOrder | currency:"GBP":0' })]
      ]),
      node("spacer", { height: 4 }),
      text("{{ report.summary }}")
    ]
  });

  const breakdown = createSection({
    name: "Breakdown",
    children: [
      heading("Where the money came from", "h2"),
      createRow([7, 5], [
        [
          node("chart", {
            chartType: "bar",
            source: "sales.byMonth",
            alias: "m",
            label: "m.month",
            series: [
              { id: "s1", label: "Sales", value: "m.total" },
              { id: "s2", label: "Target", value: "m.target" }
            ],
            height: 200,
            title: "By month",
            showLegend: true,
            valueFormat: "currency"
          })
        ],
        [
          node("chart", {
            chartType: "donut",
            source: "sales.byCategory",
            alias: "c",
            label: "c.category",
            series: [{ id: "s1", label: "Sales", value: "c.total" }],
            height: 200,
            title: "By category",
            showLegend: true
          })
        ]
      ])
    ]
  });

  const orders = createSection({
    name: "Orders",
    children: [
      heading("Every order in the period", "h2"),
      node("table", {
        source: "sales.orders",
        alias: "o",
        // Widths total 99 rather than 100. A set adding up to exactly 100 trips
        // the engine's own overflow check, which clamps the last column and
        // reports a warning; floating point decides which side of the boundary
        // any given set lands on, so leave a point of slack.
        columns: [
          { id: "c1", header: "Date", value: 'o.date | date:"d MMM"', width: 11 },
          { id: "c2", header: "Reference", value: "o.reference", width: 14 },
          { id: "c3", header: "Description", value: "o.description", width: 34 },
          { id: "c4", header: "Category", value: "o.category", width: 14 },
          { id: "c5", header: "Qty", value: "o.quantity | number", align: "right", width: 8 },
          { id: "c6", header: "Total", value: 'o.total | currency:"GBP"', align: "right", width: 18, total: "sum" }
        ],
        zebra: true,
        repeatHeader: true,
        totalsLabel: "Total"
      })
    ]
  });

  template.body = [summary, breakdown, orders];
  return template;
}

// ── Invoice ───────────────────────────────────────────────────────────────

function invoiceTemplate() {
  setDeterministicIds("sample-invoice");

  const template = createTemplate({
    name: "Invoice",
    withEmptySection: false,
    currency: "GBP",
    locale: "en-GB",
    page: {
      margins: { top: 18, right: 18, bottom: 16, left: 18 },
      header: { height: 0, differentFirstPage: false },
      footer: { height: 14, differentFirstPage: false }
    }
  });

  template.footer.default = [
    createSection({
      name: "Footer",
      children: [
        createRow([8, 4], [
          [text("{{ issuer.legalName }} · Registered in England and Wales, company {{ issuer.companyNumber }} · VAT {{ issuer.vatNumber }}", { style: { textStyle: "small" } })],
          [node("pageNumber", { format: "Page {{page.number}} of {{page.total}}", align: "right" })]
        ], { props: { verticalAlign: "bottom" } })
      ]
    })
  ];

  const headSection = createSection({
    name: "Invoice head",
    children: [
      createRow([6, 6], [
        [
          heading("INVOICE", "h1", { style: { fontSize: 30, margin: { top: 0, bottom: 2 } } }),
          text("{{ invoice.number }}", { style: { textStyle: "lead", color: "$colors.mutedText" } })
        ],
        [
          text("{{ issuer.name }}", { style: { textAlign: "right", fontWeight: 600 } }),
          text("{{ issuer.address.line1 }}\n{{ issuer.address.city }} {{ issuer.address.postcode }}\n{{ issuer.address.country }}", { style: { textAlign: "right", textStyle: "small" } }),
          text("{{ issuer.email }} · {{ issuer.phone }}", { style: { textAlign: "right", textStyle: "small" } })
        ]
      ], { props: { verticalAlign: "top" } }),

      node("divider", {}),

      createRow([6, 6], [
        [
          text("Bill to", { style: { textStyle: "small", color: "$colors.mutedText" } }),
          text("{{ billTo.name }}", { style: { fontWeight: 600 } }),
          text("FAO {{ billTo.contact }}\n{{ billTo.address.line1 }}\n{{ billTo.address.line2 }}\n{{ billTo.address.city }} {{ billTo.address.postcode }}", { style: { textStyle: "small" } })
        ],
        [
          node("keyValueList", {
            layout: "inline",
            labelWidth: 45,
            items: [
              { id: "k1", label: "Issued", value: '{{ invoice.issueDate | date:"d MMMM yyyy" }}' },
              { id: "k2", label: "Due", value: '{{ invoice.dueDate | date:"d MMMM yyyy" }}' },
              { id: "k3", label: "Terms", value: "{{ invoice.terms }}" },
              { id: "k4", label: "Your order", value: "{{ invoice.purchaseOrder }}" },
              { id: "k5", label: "Project", value: "{{ invoice.project }}" },
              { id: "k6", label: "Account", value: "{{ billTo.reference }}" }
            ]
          })
        ]
      ], { props: { verticalAlign: "top" } })
    ]
  });

  const lines = createSection({
    name: "Lines",
    children: [
      node("table", {
        source: "invoice.lines",
        alias: "l",
        columns: [
          { id: "c1", header: "Description", value: "l.description", width: 32 },
          { id: "c2", header: "Detail", value: "l.detail", width: 27 },
          { id: "c3", header: "Qty", value: "l.quantity | number", align: "right", width: 8 },
          { id: "c4", header: "Unit", value: "l.unit", width: 9 },
          { id: "c5", header: "Unit price", value: 'l.unitPrice | currency:"GBP"', align: "right", width: 11 },
          { id: "c6", header: "Net", value: 'l.net | currency:"GBP"', align: "right", width: 12, total: "sum" }
        ],
        zebra: false,
        borders: "horizontal",
        repeatHeader: true,
        totalsLabel: "Net total"
      })
    ]
  });

  const totals = createSection({
    name: "Totals",
    children: [
      createRow([6, 6], [
        [
          node("callout", {
            title: "How to pay",
            content: richTextFromTemplate("{{ issuer.bank.name }} · {{ issuer.bank.accountName }}\nSort code {{ issuer.bank.sortCode }} · Account {{ issuer.bank.accountNumber }}\n{{ issuer.bank.iban }}\n\nPlease quote {{ invoice.number }} with payment."),
            tone: "info"
          })
        ],
        [
          node("keyValueList", {
            layout: "inline",
            labelWidth: 55,
            dividers: true,
            items: [
              { id: "t1", label: "Net", value: '{{ totals.net | currency:"GBP" }}' },
              { id: "t2", label: "Discount", value: '{{ totals.discount | currency:"GBP" }}' },
              { id: "t3", label: "VAT", value: '{{ totals.vat | currency:"GBP" }}' },
              { id: "t4", label: "Total", value: '{{ totals.gross | currency:"GBP" }}' },
              { id: "t5", label: "Already paid", value: '{{ totals.paid | currency:"GBP" }}' }
            ]
          }),
          node("spacer", { height: 4 }),
          node("kpi", {
            label: "Balance due",
            value: 'totals.balanceDue | currency:"GBP"',
            caption: 'by {{ invoice.dueDate | date:"d MMMM yyyy" }}',
            size: "lg"
          })
        ]
      ], { props: { verticalAlign: "top" } }),

      node("spacer", { height: 6 }),
      text("{{ invoice.notes }}", { style: { textStyle: "small", color: "$colors.mutedText" } })
    ]
  });

  template.body = [headSection, lines, totals];
  return template;
}

// ── Write them out ────────────────────────────────────────────────────────

mkdirSync(outputDirectory, { recursive: true });

for (const [id, build] of [["sales", salesTemplate], ["invoice", invoiceTemplate]]) {
  const path = join(outputDirectory, `${id}.template.json`);
  const json = JSON.stringify(build(), null, 2);
  writeFileSync(path, json);
  console.log(`${id}: ${(json.length / 1024).toFixed(1)} KB → ${path}`);
}
