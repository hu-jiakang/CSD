import zlib from "node:zlib";

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function cell(value, row, column, styleId = 0) {
  const ref = `${column}${row}`;
  const text = String(value ?? "");
  const style = styleId ? ` s="${styleId}"` : "";
  if (text === "") return `<c r="${ref}"${style} t="inlineStr"><is><t></t></is></c>`;
  return `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEscape(text)}</t></is></c>`;
}

function columnName(index) {
  let n = index;
  let result = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    result = String.fromCharCode(65 + rem) + result;
    n = Math.floor((n - 1) / 26);
  }
  return result;
}

function columnWidth(headers, rows, index) {
  const header = String(headers[index] ?? "");
  const maxData = rows.reduce((max, row) => Math.max(max, String(row[index] ?? "").length), 0);
  return Math.min(80, Math.max(12, Math.max(header.length + 2, maxData + 2)));
}

function makeSheetXml(headers, rows, statusKey = "") {
  const allRows = [headers, ...rows];
  const lastColumn = columnName(headers.length);
  const lastRow = allRows.length;
  const cols = headers.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="${columnWidth(headers, rows, i).toFixed(2)}" customWidth="1"/>`).join("");
  const statusColumnIndex = statusKey ? headers.findIndex((h) => h === statusKey) : -1;
  const sheetRows = allRows.map((values, rowIndex) => {
    const r = rowIndex + 1;
    const rowIsInactive = rowIndex > 0 && statusColumnIndex >= 0 && String(values[statusColumnIndex] ?? "").toUpperCase() === "TRUE";
    const styleId = rowIndex === 0 ? 1 : (rowIsInactive ? 3 : 0);
    const cells = values.map((value, columnIndex) => cell(value, r, columnName(columnIndex + 1), styleId)).join("");
    const height = rowIndex === 0 ? ` ht="21" customHeight="1"` : "";
    return `<row r="${r}"${height}>${cells}</row>`;
  }).join("");

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<dimension ref="A1:${lastColumn}${lastRow}"/>` +
    `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews>` +
    `<sheetFormatPr defaultRowHeight="15"/>` +
    `<cols>${cols}</cols>` +
    `<sheetData>${sheetRows}</sheetData>` +
     `</worksheet>`;
}

function stylesXml() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    `<numFmts count="0"/>` +
    `<fonts count="3">` +
    `<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>` +
    `<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>` +
    `<font><color rgb="FFFF0000"/><sz val="11"/><name val="Calibri"/><family val="2"/></font>` +
    `</fonts>` +
    `<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="D9EAF7"/><bgColor indexed="64"/></patternFill></fill></fills>` +
    `<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>` +
    `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
    `<cellXfs count="4">` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0">` +
      `<alignment horizontal="center" vertical="center"/>` +
    `</xf>` +
    `<xf numFmtId="0" fontId="1" fillId="1" borderId="0" xfId="0" applyFont="1" applyFill="1">` +
      `<alignment horizontal="center" vertical="center"/>` +
    `</xf>` +
    `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0">` +
      `<alignment horizontal="center" vertical="center"/>` +
    `</xf>` +
    `<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1">` +
      `<alignment horizontal="center" vertical="center"/>` +
    `</xf>` +
    `</cellXfs>` +
    `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>` +
    `</styleSheet>`;
}

function contentTypes(sheetCount) {
  let overrides = `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>`;
  overrides += `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>`;
  for (let i = 1; i <= sheetCount; i += 1) overrides += `<Override PartName="/xl/worksheets/sheet${i}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${overrides}</Types>`;
}

function rootRels() {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
}

function workbookXml(sheets) {
  const list = sheets.map((s, i) => `<sheet name="${xmlEscape(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${list}</sheets></workbook>`;
}

function workbookRels(sheetCount) {
  const rels = Array.from({ length: sheetCount }, (_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("");
  const styleRel = `<Relationship Id="rId${sheetCount + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rels}${styleRel}</Relationships>`;
}

function dosTimeDate() {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  return { time, date };
}

function zip(entries) {
  const parts = [];
  const central = [];
  let offset = 0;
  const { time, date } = dosTimeDate();
  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8");
    const source = Buffer.from(entry.data, "utf8");
    const compressed = zlib.deflateRawSync(source);
    const crc = crc32(source);
    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0, 6); local.writeUInt16LE(8, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(compressed.length, 18); local.writeUInt32LE(source.length, 22); local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28); name.copy(local, 30);
    parts.push(local, compressed);
    const c = Buffer.alloc(46 + name.length);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0, 8); c.writeUInt16LE(8, 10);
    c.writeUInt16LE(time, 12); c.writeUInt16LE(date, 14); c.writeUInt32LE(crc, 16); c.writeUInt32LE(compressed.length, 20); c.writeUInt32LE(source.length, 24); c.writeUInt16LE(name.length, 28); c.writeUInt16LE(0, 30); c.writeUInt16LE(0, 32); c.writeUInt16LE(0, 34); c.writeUInt16LE(0, 36); c.writeUInt32LE(0, 38); c.writeUInt32LE(offset, 42); name.copy(c, 46);
    central.push(c); offset += local.length + compressed.length;
  }
  const centralOffset = offset;
  const centralData = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(0, 4); end.writeUInt16LE(0, 6); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(centralData.length, 12); end.writeUInt32LE(centralOffset, 16); end.writeUInt16LE(0, 20);
  return Buffer.concat([...parts, centralData, end]);
}

export function createXlsxWorkbook(sheets) {
  const entries = [
    { name: "[Content_Types].xml", data: contentTypes(sheets.length) },
    { name: "_rels/.rels", data: rootRels() },
    { name: "xl/workbook.xml", data: workbookXml(sheets) },
    { name: "xl/_rels/workbook.xml.rels", data: workbookRels(sheets.length) },
    { name: "xl/styles.xml", data: stylesXml() },
  ];
  sheets.forEach((sheet, i) => entries.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: makeSheetXml(sheet.headers, sheet.rows, sheet.statusHeader || "") }));
  return zip(entries);
}
