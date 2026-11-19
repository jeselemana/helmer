import { z } from "zod";

const text = z.string().max(6000);
const short = z.string().max(180);
const color = z.string().regex(/^[0-9A-Fa-f]{6}$/);
export const uuid = z.string().uuid();
export const tableSchema = z.object({
  headers: z.array(short).min(1).max(12),
  rows: z.array(z.array(text).max(12)).max(150),
}).strict().superRefine((table, ctx) => {
  if (table.rows.some(row => row.length !== table.headers.length)) ctx.addIssue({ code: "custom", message: "Table column count mismatch" });
});
export const sectionSchema = z.object({
  heading: short, level: z.number().int().min(1).max(3),
  paragraphs: z.array(text).max(40),
  lists: z.array(z.object({ ordered: z.boolean(), items: z.array(text).max(50) }).strict()).max(10),
  tables: z.array(tableSchema).max(10), pageBreak: z.boolean(),
}).strict();
export const chartSchema = z.object({
  title: short, type: z.enum(["bar", "line", "pie"]),
  labels: z.array(short).min(1).max(100),
  series: z.array(z.object({ name: short, values: z.array(z.number().finite()).max(100) }).strict()).min(1).max(8),
}).strict().superRefine((chart, ctx) => {
  if (chart.series.some(series => series.values.length !== chart.labels.length)) ctx.addIssue({ code: "custom", message: "Chart series length mismatch" });
  if (chart.type === "pie" && chart.series.length !== 1) ctx.addIssue({ code: "custom", message: "Pie charts require exactly one series" });
});
const formula = z.string().max(1000).refine(value => {
  if (!value) return true;
  // Only internal arithmetic, references and allowlisted spreadsheet functions.
  if (/[\[\]{}|;\\\r\n]/.test(value) || /(?:https?:|file:|DDE|WEBSERVICE|HYPERLINK|IMPORT|RTD|EXEC|CALL|REGISTER|INDIRECT)/i.test(value)) return false;
  const withoutStrings = value.replace(/"[^"]*"|'[^']*'/g, "");
  const allowed = new Set(["SUM", "AVERAGE", "MIN", "MAX", "IF", "IFERROR", "ROUND", "ROUNDUP", "ROUNDDOWN", "COUNT", "COUNTA", "COUNTIF", "SUMIF", "SUMIFS", "NPV", "IRR", "PMT", "PV", "FV", "POWER", "ABS", "AND", "OR", "SQRT", "FORECAST", "FORECAST.LINEAR", "TREND", "SLOPE", "INTERCEPT", "XLOOKUP", "VLOOKUP", "INDEX", "MATCH"]);
  return [...withoutStrings.matchAll(/([A-Z_][A-Z0-9._]*)\s*\(/gi)].every(match => allowed.has(match[1].toUpperCase()));
}, "Unsafe spreadsheet formula");
export const cellSchema = z.object({
  type: z.enum(["text", "number", "formula", "blank"]), value: text,
  formula, result: z.number().finite().nullable(),
  format: z.string().max(100), bold: z.boolean(),
}).strict().superRefine((cell, ctx) => {
  if ((cell.type === "number" && (!cell.value.trim() || !Number.isFinite(Number(cell.value)))) || (cell.type === "formula" && !cell.formula.trim())) ctx.addIssue({ code: "custom", message: "Invalid spreadsheet cell" });
});
const range = z.string().regex(/^[A-Z]{1,3}[1-9]\d{0,4}(?::[A-Z]{1,3}[1-9]\d{0,4})?$/);
export const sheetSchema = z.object({
  name: z.string().min(1).max(31).regex(/^[^\\/*?:\[\]\x00-\x1f]+$/),
  summary: text, rows: z.array(z.array(cellSchema).max(40)).min(1).max(1000),
  widths: z.array(z.number().min(8).max(80)).max(40),
  tables: z.array(z.object({ name: z.string().regex(/^[A-Za-z_][A-Za-z_0-9]{0,40}$/), range }).strict()).max(10),
  conditionalFormats: z.array(z.object({ range, type: z.enum(["colorScale", "dataBar"]) }).strict()).max(10),
  charts: z.array(chartSchema).max(6),
}).strict();
export const slideSchema = z.object({
  layout: z.enum(["title", "section", "text", "table", "chart", "metrics", "summary"]),
  title: short, subtitle: z.string().max(500),
  bullets: z.array(z.string().max(500)).max(8),
  tables: z.array(tableSchema).max(1), charts: z.array(chartSchema).max(1),
  metrics: z.array(z.object({ label: short, value: short }).strict()).max(4), notes: text,
}).strict().superRefine((slide, ctx) => {
  if (slide.tables.some(table => table.rows.length > 14 || table.headers.length > 6)) ctx.addIssue({ code: "custom", message: "Presentation table too large; split into slides" });
  if ([slide.bullets.length, slide.tables.length, slide.charts.length, slide.metrics.length].filter(Boolean).length > 1) ctx.addIssue({ code: "custom", message: "Use one primary content layout per slide" });
});
export const citationSchema = z.object({ title: short, url: z.string().max(2000).refine(url => { try { return ["http:", "https:"].includes(new URL(url).protocol); } catch { return false; } }) }).strict();

export function schemasFor(unitSchema, maxUnits) {
  const spec = z.object({
    title: z.string().min(1).max(180), header: short, footer: short,
    accent: color, fontSize: z.number().int().min(10).max(14),
    citations: z.array(citationSchema).max(30),
    units: z.array(unitSchema).min(1).max(maxUnits),
  }).strict();
  const edit = z.object({
    title: short.nullable(), header: short.nullable(), footer: short.nullable(),
    citations: z.array(citationSchema).max(30).nullable(),
    operations: z.array(z.object({
      action: z.enum(["replace", "add", "remove"]), index: z.number().int().min(0), unit: unitSchema.nullable(),
    }).strict()).min(1).max(30),
  }).strict();
  return { spec, edit };
}

export function applyArtifactEdits(previous, edits, specSchema) {
  const next = structuredClone(previous);
  for (const field of ["title", "header", "footer", "citations"]) if (edits[field] !== null) next[field] = edits[field];
  for (const op of edits.operations) {
    const limit = op.action === "add" ? next.units.length : next.units.length - 1;
    if (op.index > limit || (op.action !== "remove" && !op.unit)) throw new Error("Invalid artifact edit target");
    if (op.action === "remove") next.units.splice(op.index, 1);
    else if (op.action === "add") next.units.splice(op.index, 0, op.unit);
    else next.units[op.index] = op.unit;
  }
  return specSchema.parse(next);
}
