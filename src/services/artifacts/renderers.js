import { Document, Packer, Paragraph, TextRun, HeadingLevel, Table, TableRow, TableCell, Header, Footer, PageNumber, AlignmentType, WidthType } from "docx";
import ExcelJS from "exceljs";
import PptxGenJS from "pptxgenjs";
import PDFDocument from "pdfkit";
import { PDFDocument as PDFReader, PDFDict, PDFArray, PDFName, PDFStream, PDFRef } from "pdf-lib";
import JSZip from "jszip";
import { XMLValidator, XMLParser } from "fast-xml-parser";
import { fileURLToPath } from "node:url";

const font = fileURLToPath(new URL("../../assets/fonts/NotoSans-Regular.ttf", import.meta.url));
const xml = value => String(value).replace(/[<>&"']/g, char => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[char]);
const paragraph = text => new Paragraph({ children: [new TextRun(text)], spacing: { after: 160 } });

function chartCellReference(spec, values, numeric = false, preferredSheet = null) {
  const colName = index => { let result = "", n = index + 1; while (n) { result = String.fromCharCode(65 + (n - 1) % 26) + result; n = Math.floor((n - 1) / 26); } return result; };
  for (const sheet of preferredSheet ? [preferredSheet, ...spec.units.filter(sheet => sheet !== preferredSheet)] : spec.units) {
    for (let row = 0; row <= sheet.rows.length - values.length; row++) {
      for (let column = 0; column < (sheet.rows[row]?.length || 0); column++) {
        const matches = values.every((value, offset) => {
          const cell = sheet.rows[row + offset]?.[column]; if (!cell) return false;
          const actual = cell.type === "formula" ? cell.result : cell.type === "number" ? Number(cell.value) : cell.value;
          return actual !== null && (numeric ? typeof actual === "number" && actual === value : String(actual) === String(value));
        });
        if (matches) return `'${sheet.name.replace(/'/g, "''")}'!$${colName(column)}$${row + 1}:$${colName(column)}$${row + values.length}`;
      }
    }
  }
  return null;
}

export async function renderWord(spec) {
  const children = [new Paragraph({ text: spec.title, heading: HeadingLevel.TITLE })];
  for (const section of spec.units) {
    if (section.heading) children.push(new Paragraph({ text: section.heading, heading: [HeadingLevel.HEADING_1, HeadingLevel.HEADING_2, HeadingLevel.HEADING_3][section.level - 1], pageBreakBefore: section.pageBreak }));
    else if (section.pageBreak) children.push(new Paragraph({ pageBreakBefore: true }));
    children.push(...section.paragraphs.map(paragraph));
    section.lists.forEach(list => list.items.forEach(item => children.push(new Paragraph({ text: item, ...(list.ordered ? { numbering: { reference: "ordered", level: 0 } } : { bullet: { level: 0 } }), spacing: { after: 100 } }))));
    for (const table of section.tables) children.push(new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [table.headers, ...table.rows].map((row, index) => new TableRow({ tableHeader: index === 0, children: row.map(value => new TableCell({ children: [index === 0 ? new Paragraph({ children: [new TextRun({ text: value, color: "FFFFFF", bold: true })] }) : paragraph(value)], ...(index === 0 ? { shading: { fill: spec.accent } } : {}) })) })),
    }));
  }
  if (spec.citations.length) children.push(new Paragraph({ text: "Sources / Mənbələr", heading: HeadingLevel.HEADING_1 }), ...spec.citations.map(cite => paragraph(`${cite.title} — ${cite.url}`)));
  const doc = new Document({
    title: spec.title, creator: "Helmer", styles: { default: { document: { run: { font: "Calibri", size: spec.fontSize * 2 }, paragraph: { spacing: { line: 280 } } } } },
    numbering: { config: [{ reference: "ordered", levels: [{ level: 0, format: "decimal", text: "%1.", alignment: AlignmentType.LEFT }] }] },
    sections: [{ properties: {}, headers: { default: new Header({ children: [paragraph(spec.header)] }) }, footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun(`${spec.footer}  `), new TextRun({ children: [PageNumber.CURRENT] })] })] }) }, children }],
  });
  return Packer.toBuffer(doc);
}

// Charts are ordinary OOXML chart/drawing parts, with internal references only.
async function addExcelCharts(buffer, spec) {
  const zip = await JSZip.loadAsync(buffer);
  let chartId = 0;
  let overrides = "";
  for (let sheetIndex = 0; sheetIndex < spec.units.length; sheetIndex++) {
    const sheet = spec.units[sheetIndex];
    if (!sheet.charts.length) continue;
    const drawingId = sheetIndex + 1;
    let anchors = "", relations = "";
    for (const [index, chart] of sheet.charts.entries()) {
      chartId++;
      const categoryRef = chartCellReference(spec, chart.labels, false, sheet);
      const labels = `<c:ptCount val="${chart.labels.length}"/>${chart.labels.map((label, li) => `<c:pt idx="${li}"><c:v>${xml(label)}</c:v></c:pt>`).join("")}`;
      const categories = categoryRef ? `<c:strRef><c:f>${xml(categoryRef)}</c:f><c:strCache>${labels}</c:strCache></c:strRef>` : `<c:strLit>${labels}</c:strLit>`;
      const series = chart.series.map((series, si) => {
        const valueRef = chartCellReference(spec, series.values, true, sheet);
        const values = `<c:formatCode>General</c:formatCode><c:ptCount val="${series.values.length}"/>${series.values.map((value, vi) => `<c:pt idx="${vi}"><c:v>${value}</c:v></c:pt>`).join("")}`;
        const numbers = valueRef ? `<c:numRef><c:f>${xml(valueRef)}</c:f><c:numCache>${values}</c:numCache></c:numRef>` : `<c:numLit>${values}</c:numLit>`;
        return `<c:ser><c:idx val="${si}"/><c:order val="${si}"/><c:tx><c:v>${xml(series.name)}</c:v></c:tx><c:cat>${categories}</c:cat><c:val>${numbers}</c:val></c:ser>`;
      }).join("");
      const tag = `${chart.type}Chart`;
      const axes = chart.type === "pie" ? "" : '<c:axId val="100"/><c:axId val="200"/>';
      const axisParts = chart.type === "pie" ? "" : '<c:catAx><c:axId val="100"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="b"/><c:crossAx val="200"/><c:crosses val="autoZero"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/></c:catAx><c:valAx><c:axId val="200"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:axPos val="l"/><c:numFmt formatCode="General" sourceLinked="1"/><c:crossAx val="100"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>';
      zip.file(`xl/charts/chart${chartId}.xml`, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><c:chartSpace xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><c:chart><c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:r><a:t>${xml(chart.title)}</a:t></a:r></a:p></c:rich></c:tx></c:title><c:plotArea><c:layout/><c:${tag}>${chart.type === "bar" ? '<c:barDir val="col"/><c:grouping val="clustered"/>' : chart.type === "line" ? '<c:grouping val="standard"/>' : ""}${series}${axes}</c:${tag}>${axisParts}</c:plotArea><c:legend><c:legendPos val="b"/><c:layout/></c:legend><c:plotVisOnly val="1"/></c:chart></c:chartSpace>`);
      const row = sheet.rows.length + 3 + index * 17;
      anchors += `<xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>9</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${row + 16}</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${chartId}" name="Chart ${chartId}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr><xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/chart"><c:chart xmlns:c="http://schemas.openxmlformats.org/drawingml/2006/chart" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" r:id="rId${index + 1}"/></a:graphicData></a:graphic></xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
      relations += `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart" Target="../charts/chart${chartId}.xml"/>`;
      overrides += `<Override PartName="/xl/charts/chart${chartId}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.chart+xml"/>`;
    }
    zip.file(`xl/drawings/drawing${drawingId}.xml`, `<?xml version="1.0" encoding="UTF-8"?><xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${anchors}</xdr:wsDr>`);
    zip.file(`xl/drawings/_rels/drawing${drawingId}.xml.rels`, `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations}</Relationships>`);
    const sheetPath = `xl/worksheets/sheet${drawingId}.xml`;
    zip.file(sheetPath, (await zip.file(sheetPath).async("string")).replace("</worksheet>", '<drawing r:id="rIdHelmerChart"/></worksheet>'));
    const relPath = `xl/worksheets/_rels/sheet${drawingId}.xml.rels`;
    const oldRels = zip.file(relPath) ? await zip.file(relPath).async("string") : '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    zip.file(relPath, oldRels.replace("</Relationships>", `<Relationship Id="rIdHelmerChart" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/drawing${drawingId}.xml"/></Relationships>`));
    overrides += `<Override PartName="/xl/drawings/drawing${drawingId}.xml" ContentType="application/vnd.openxmlformats-officedocument.drawingml.spreadsheetDrawing+xml"/>`;
  }
  zip.file("[Content_Types].xml", (await zip.file("[Content_Types].xml").async("string")).replace("</Types>", `${overrides}</Types>`));
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

export async function renderExcel(spec) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Helmer";
  workbook.calcProperties.fullCalcOnLoad = true;
  const names = new Set(), tableNames = new Set();
  for (const source of spec.units) {
    if (names.has(source.name.toLowerCase())) throw new Error("Duplicate sheet name");
    names.add(source.name.toLowerCase());
    const sheet = workbook.addWorksheet(source.name, { views: [{ state: "frozen", ySplit: 1 }], headerFooter: { oddHeader: spec.header, oddFooter: `${spec.footer} &P` } });
    for (const [ri, row] of source.rows.entries()) for (const [ci, data] of row.entries()) {
      const cell = sheet.getCell(ri + 1, ci + 1);
      cell.value = data.type === "formula" ? { formula: data.formula.replace(/^=/, ""), ...(data.result !== null ? { result: data.result } : {}) } : data.type === "number" ? Number(data.value) : data.type === "blank" ? null : data.value;
      if (data.format) cell.numFmt = data.format;
      cell.font = { name: "Calibri", size: spec.fontSize, bold: data.bold || ri === 0, ...(ri === 0 ? { color: { argb: "FFFFFFFF" } } : {}) };
      cell.alignment = { wrapText: true, vertical: "top" };
      if (ri === 0) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: `FF${spec.accent}` } };
    }
    source.widths.forEach((width, index) => { sheet.getColumn(index + 1).width = width; });
    for (const table of source.tables) {
      if (tableNames.has(table.name.toLowerCase()) || /^[A-Z]+\d+$/i.test(table.name)) throw new Error("Invalid table name");
      tableNames.add(table.name.toLowerCase());
      const [start, end = start] = table.range.split(":");
      const first = sheet.getCell(start), last = sheet.getCell(end);
      if (last.row > source.rows.length || last.col > 40 || last.row <= first.row || last.col < first.col) throw new Error("Table range outside data");
      const columns = [];
      for (let c = first.col; c <= last.col; c++) columns.push({ name: String(sheet.getCell(first.row, c).value || `Column${c}`) });
      if (new Set(columns.map(column => column.name)).size !== columns.length) throw new Error("Duplicate table headers");
      const rows = [];
      for (let r = first.row + 1; r <= last.row; r++) rows.push(columns.map((_, c) => sheet.getCell(r, first.col + c).value));
      sheet.addTable({ name: table.name, ref: start, headerRow: true, columns, rows, style: { theme: "TableStyleMedium2", showRowStripes: true } });
    }
    for (const condition of source.conditionalFormats) sheet.addConditionalFormatting({ ref: condition.range, rules: [condition.type === "colorScale" ? { type: "colorScale", cfvo: [{ type: "min" }, { type: "max" }], color: [{ argb: "FFF1F5F9" }, { argb: `FF${spec.accent}` }] } : { type: "dataBar", cfvo: [{ type: "min" }, { type: "max" }], color: { argb: `FF${spec.accent}` } }] });
    if (source.summary) sheet.getCell(source.rows.length + 2, 1).value = source.summary;
  }
  if (spec.citations.length) {
    let name = "Sources"; while (names.has(name.toLowerCase())) name = `_${name}`;
    const sheet = workbook.addWorksheet(name);
    sheet.addRow(["Source", "URL"]);
    spec.citations.forEach(cite => sheet.addRow([cite.title, cite.url]));
    sheet.columns.forEach(column => { column.width = 50; });
  }
  return addExcelCharts(Buffer.from(await workbook.xlsx.writeBuffer()), spec);
}

export async function renderPowerPoint(spec) {
  const deck = new PptxGenJS();
  deck.layout = "LAYOUT_WIDE"; deck.author = "Helmer"; deck.title = spec.title;
  deck.subject = spec.title; deck.lang = "az-AZ";
  deck.theme = { headFontFace: "Calibri", bodyFontFace: "Calibri", lang: "az-AZ" };
  for (const [index, unit] of spec.units.entries()) {
    const slide = deck.addSlide();
    const dark = unit.layout === "title" || unit.layout === "section";
    slide.background = { color: dark ? spec.accent : "FFFFFF" };
    const textColor = dark ? "FFFFFF" : "172033";
    slide.addText(unit.title, { x: 0.65, y: dark ? 1.8 : 0.45, w: 12, h: 1.15, fontSize: dark ? 36 : 28, bold: true, color: textColor, breakLine: false, fit: "shrink", margin: 0 });
    if (unit.subtitle) slide.addText(unit.subtitle, { x: 0.65, y: dark ? 3 : 1.6, w: 12, h: 0.65, fontSize: 17, color: textColor, fit: "shrink", margin: 0 });
    const y = unit.subtitle ? 2.4 : 1.9;
    if (unit.bullets.length) slide.addText(unit.bullets.map(value => ({ text: value, options: { bullet: { indent: 20 }, breakLine: true } })), { x: 0.8, y: dark ? 4 : y, w: 11.7, h: dark ? 2 : 4.6, fontSize: 22, color: textColor, paraSpaceAfterPt: 14, fit: "shrink", valign: "top" });
    if (unit.tables.length) slide.addTable([unit.tables[0].headers, ...unit.tables[0].rows], { x: 0.65, y, w: 12, h: 4.5, fontSize: 12, border: { pt: 0.5, color: "DDE3EB" }, color: textColor, autoPage: false, margin: 0.08 });
    if (unit.charts.length) {
      const chart = unit.charts[0];
      slide.addChart(deck.ChartType[chart.type], chart.series.map(series => ({ name: series.name, labels: chart.labels, values: series.values })), { x: 0.65, y, w: 12, h: 4.4, showLegend: true, showTitle: true, title: chart.title, chartColors: [spec.accent, "64748B", "CBD5E1"] });
    }
    unit.metrics.forEach((metric, mi) => {
      const w = 11.8 / unit.metrics.length;
      slide.addText(metric.value, { x: 0.7 + mi * w, y: 3, w: w - 0.2, h: 1, fontSize: 38, bold: true, color: dark ? "FFFFFF" : spec.accent, fit: "shrink" });
      slide.addText(metric.label, { x: 0.7 + mi * w, y: 4.1, w: w - 0.2, h: 0.7, fontSize: 16, color: textColor, fit: "shrink" });
    });
    slide.addText(`${spec.footer || "Helmer"}  ·  ${index + 1}`, { x: 0.65, y: 7.05, w: 12, h: 0.2, fontSize: 9, color: dark ? "FFFFFF" : "64748B", margin: 0 });
    slide.addNotes(`${unit.notes}\n${spec.citations.map(cite => `${cite.title}: ${cite.url}`).join("\n")}`);
  }
  return Buffer.from(await deck.write({ outputType: "nodebuffer" }));
}

export async function renderPDF(spec) {
  const doc = new PDFDocument({ size: "A4", margins: { top: 62, bottom: 62, left: 48, right: 48 }, bufferPages: true, info: { Title: spec.title, Author: "Helmer" } });
  const chunks = [];
  const result = new Promise((resolve, reject) => { doc.on("data", chunk => chunks.push(chunk)); doc.on("end", () => resolve(Buffer.concat(chunks))); doc.on("error", reject); });
  doc.font(font);
  const width = doc.page.width - 96;
  const ensure = height => { if (doc.y + height > doc.page.height - 62) doc.addPage(); };
  const body = value => { doc.fontSize(spec.fontSize).fillColor("#172033").text(value, { width, lineGap: 3 }); doc.moveDown(0.5); };
  const heading = (value, size) => { doc.fontSize(size); ensure(doc.heightOfString(value, { width }) + 45); doc.fillColor(`#${spec.accent}`).text(value, { width }); doc.moveDown(0.6); };
  heading(spec.title, 24);
  for (const section of spec.units) {
    if (section.pageBreak) doc.addPage();
    if (section.heading) heading(section.heading, 20 - section.level * 2);
    section.paragraphs.forEach(body);
    section.lists.forEach(list => list.items.forEach((value, index) => body(`${list.ordered ? `${index + 1}.` : "•"} ${value}`)));
    for (const table of section.tables) {
      const columnWidth = width / table.headers.length;
      const draw = (row, isHeader) => {
        doc.fontSize(Math.min(spec.fontSize, 10));
        const height = Math.max(...row.map(value => doc.heightOfString(value, { width: columnWidth - 12, lineGap: 2 }))) + 14;
        if (height > doc.page.height - 150) throw new Error("PDF table row is too tall; split the content");
        const headerHeight = Math.max(...table.headers.map(value => doc.heightOfString(value, { width: columnWidth - 12, lineGap: 2 }))) + 14;
        if (!isHeader && height + headerHeight > doc.page.height - 124) throw new Error("PDF table row cannot fit below the repeated header; split the content");
        if (doc.y + height > doc.page.height - 62) { doc.addPage(); if (!isHeader) draw(table.headers, true); }
        const y = doc.y;
        row.forEach((value, index) => {
          const x = 48 + index * columnWidth;
          doc.rect(x, y, columnWidth, height).fillAndStroke(isHeader ? `#${spec.accent}` : "#F6F8FA", "#DDE3EB");
          doc.fillColor(isHeader ? "#FFFFFF" : "#172033").text(value, x + 6, y + 7, { width: columnWidth - 12, lineGap: 2 });
        });
        doc.x = 48; doc.y = y + height;
      };
      draw(table.headers, true); table.rows.forEach(row => draw(row, false)); doc.moveDown();
    }
  }
  if (spec.citations.length) { heading("Sources / Mənbələr", 16); spec.citations.forEach(cite => body(`${cite.title}: ${cite.url}`)); }
  const pages = doc.bufferedPageRange();
  for (let page = pages.start; page < pages.start + pages.count; page++) {
    doc.switchToPage(page);
    // Disable automatic pagination for margin text.
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.fontSize(9).fillColor("#64748B");
    doc.text(spec.header, 48, 28, { width, lineBreak: false });
    doc.text(`${spec.footer}  ·  ${page + 1} / ${pages.count}`, 48, doc.page.height - 34, { width, lineBreak: false, align: "center" });
    doc.page.margins.bottom = bottomMargin;
  }
  doc.end();
  return result;
}

export async function validateRenderedFile(buffer, kind, { nested = false } = {}) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 100 || buffer.length > 25 * 1024 * 1024) throw new Error("Invalid artifact size");
  if (kind === "pdf") {
    if (buffer.subarray(0, 5).toString() !== "%PDF-") throw new Error("Invalid PDF signature");
    const pdf = await PDFReader.load(buffer);
    if (!pdf.getPageCount()) throw new Error("Empty PDF");
    const visited = new Set();
    const deref = (val) => {
      let cur = val;
      for (let hops = 0; cur instanceof PDFRef && hops < 16; hops++) {
        cur = pdf.context.lookup(cur);
      }
      return cur;
    };
    const inspect = object => {
      const resolved = deref(object);
      if (!resolved || visited.has(resolved)) return;
      visited.add(resolved);
      if (visited.size > 100000) throw new Error('PDF object limit exceeded');
      if (resolved instanceof PDFStream) {
        inspect(resolved.dict);
        return;
      }
      if (resolved instanceof PDFDict) for (const [key, rawValue] of resolved.entries()) {
        const name = key.decodeText();
        const value = deref(rawValue);
        if (['JS', 'JavaScript', 'AA', 'OpenAction', 'EmbeddedFiles', 'EF', 'XFA', 'RichMedia', 'Launch'].includes(name)) throw new Error('Unsafe PDF content');
        if (name === 'S' && value instanceof PDFName && ['JavaScript', 'Launch', 'SubmitForm', 'ImportData', 'GoToR', 'GoToE'].includes(value.decodeText())) throw new Error('Unsafe PDF action');
        if (name === 'URI' && (!value || typeof value.decodeText !== 'function' || !/^https:\/\//i.test(value.decodeText()))) throw new Error('Unsafe PDF relationship');
        inspect(value);
      }
      else if (resolved instanceof PDFArray) for (const value of resolved.asArray()) inspect(value);
    };
    for (const [, object] of pdf.context.enumerateIndirectObjects()) inspect(object);
    return;
  }
  const zip = await JSZip.loadAsync(buffer, { checkCRC32: true });
  const required = { docx: ["word/document.xml"], xlsx: ["xl/workbook.xml", "xl/worksheets/sheet1.xml"], pptx: ["ppt/presentation.xml", "ppt/slides/slide1.xml"] }[kind];
  if (!required || !zip.file("[Content_Types].xml") || required.some(name => !zip.file(name))) throw new Error("Invalid Office package");
  const MAX_OFFICE_ENTRIES = 1000;
  const MAX_OFFICE_INFLATED_BYTES = 50 * 1024 * 1024;
  let fileEntriesCount = 0;
  let inflatedBytes = 0;
  const readZipEntryBuffer = (entry) => new Promise((resolve, reject) => {
    const chunks = [];
    let settled = false;
    const stream = entry.nodeStream("nodebuffer");
    stream.on("data", (chunk) => {
      if (settled) return;
      inflatedBytes += chunk.length;
      if (inflatedBytes > MAX_OFFICE_INFLATED_BYTES) {
        settled = true;
        stream.destroy?.();
        reject(new Error("Office package decompression limit exceeded"));
        return;
      }
      chunks.push(chunk);
    });
    stream.once("error", (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
    stream.once("end", () => {
      if (settled) return;
      settled = true;
      resolve(Buffer.concat(chunks));
    });
  });
  for (const file of Object.values(zip.files)) {
    const normalizedName = String(file.name || "").replace(/\\/g, "/");
    if (file.name.includes("\\") || normalizedName.startsWith("/") || normalizedName.split("/").includes("..")) {
      throw new Error("Unsafe Office package");
    }
    const isAllowedPptxChartWorkbook =
      !nested &&
      kind === "pptx" &&
      !file.dir &&
      /^ppt\/embeddings\/Microsoft_Excel_Worksheet\d+\.xlsx$/i.test(normalizedName);
    if (!isAllowedPptxChartWorkbook && /(?:vbaProject|vbaData|externalLinks|activeX\/.+|embeddings\/.+|xl\/macrosheets\/.+|xl\/dialogsheets\/.+)/i.test(normalizedName)) {
      throw new Error("Unsafe Office package");
    }
    if (!file.dir) {
      fileEntriesCount += 1;
      if (fileEntriesCount > MAX_OFFICE_ENTRIES) throw new Error("Office package entry limit exceeded");
      const entryBuffer = await readZipEntryBuffer(file);
      if (isAllowedPptxChartWorkbook) {
        await validateRenderedFile(entryBuffer, "xlsx", { nested: true });
      }
      if (/\.(?:xml|rels)$/i.test(normalizedName)) {
        const content = entryBuffer.toString("utf8");
        if (/<!DOCTYPE|<!ENTITY/i.test(content) || XMLValidator.validate(content) !== true) throw new Error("Invalid Office XML");
        if (/\.rels$/i.test(normalizedName)) {
          const relationships = new XMLParser({ ignoreAttributes: false }).parse(content).Relationships?.Relationship || [];
          for (const relation of Array.isArray(relationships) ? relationships : [relationships]) {
            const targetMode = String(relation["@_TargetMode"] || "").trim().toLowerCase();
            const target = String(relation["@_Target"] || "").trim();
            if (targetMode === "external") {
              if (!/^https:\/\//i.test(target)) throw new Error("Unsafe external relationship");
            } else if (/^(?:\\\\|\/\/)/.test(target) || (/^[a-z][a-z0-9+.-]*:/i.test(target) && !/^https:\/\//i.test(target))) {
              throw new Error("Unsafe external relationship");
            }
          }
        }
      }
    }
  }
  if (kind === "xlsx") { const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(buffer); if (!workbook.worksheets.length) throw new Error("Empty workbook"); }
}

export const renderers = { docx: renderWord, xlsx: renderExcel, pptx: renderPowerPoint, pdf: renderPDF };
