import type { ResultSet } from "./types";

export function resultsToJson(sets: ResultSet[]): string {
  const tables = sets.filter((set) => set.columns.length > 0).map(tableObjects);
  const body = tables.length === 1 ? tables[0] : tables;
  return `${JSON.stringify(body, null, 2)}\n`;
}

export function resultsToXlsx(sets: ResultSet[]): Uint8Array {
  const grids = sets.filter((set) => set.columns.length > 0);
  const used = new Set<string>();
  const sheets = (grids.length > 0 ? grids : []).map((set, index) => ({
    name: sheetName(grids.length === 1 ? "Results" : `Results ${index + 1}`, used),
    xml: worksheetXml(set),
  }));
  const files = [
    { name: "[Content_Types].xml", data: text(contentTypes(sheets.length)) },
    { name: "_rels/.rels", data: text(ROOT_RELS) },
    { name: "xl/workbook.xml", data: text(workbookXml(sheets.map((sheet) => sheet.name))) },
    { name: "xl/_rels/workbook.xml.rels", data: text(workbookRels(sheets.length)) },
    { name: "xl/styles.xml", data: text(STYLES) },
    ...sheets.map((sheet, index) => ({
      name: `xl/worksheets/sheet${index + 1}.xml`,
      data: text(sheet.xml),
    })),
  ];
  return storeZip(files);
}

function tableObjects(set: ResultSet): Array<Record<string, string | number | null>> {
  const keys = uniqueKeys(set.columns);
  return set.rows.map((row) => {
    const record: Record<string, string | number | null> = {};
    keys.forEach((key, index) => {
      record[key] = jsonValue(row[index] ?? null);
    });
    return record;
  });
}

function uniqueKeys(columns: string[]): string[] {
  const seen = new Map<string, number>();
  return columns.map((column, index) => {
    const base = column.trim() || `column_${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

function jsonValue(value: string | null): string | number | null {
  if (value === null) return null;
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return value;
}

function worksheetXml(set: ResultSet): string {
  const rows = [
    `<row r="1">${set.columns
      .map((column, index) => cellXml(column, index, 1, true))
      .join("")}</row>`,
    ...set.rows.map((row, rowIndex) => {
      const excelRow = rowIndex + 2;
      const cells = set.columns
        .map((_, index) => cellXml(row[index] ?? null, index, excelRow, false))
        .join("");
      return `<row r="${excelRow}">${cells}</row>`;
    }),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.join("")}</sheetData></worksheet>`;
}

function cellXml(value: string | null, column: number, row: number, header: boolean): string {
  const ref = `${columnName(column)}${row}`;
  if (!header && value === null) return `<c r="${ref}"/>`;
  const number = !header && value !== null ? jsonValue(value) : value ?? "";
  if (typeof number === "number") return `<c r="${ref}"><v>${number}</v></c>`;
  const text = xmlText(String(number)).slice(0, 32767);
  const space = text !== text.trim() ? ` xml:space="preserve"` : "";
  return `<c r="${ref}" t="inlineStr"><is><t${space}>${text}</t></is></c>`;
}

function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

function sheetName(name: string, used: Set<string>): string {
  let base = name.replace(/[\\/*?:[\]]/g, " ").replace(/\s+/g, " ").trim() || "Results";
  if (base.length > 31) base = base.slice(0, 31).trim();
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    const tail = ` ${suffix}`;
    candidate = `${base.slice(0, 31 - tail.length).trim()}${tail}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function xmlText(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function contentTypes(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_, index) => {
    return `<Override PartName="/xl/worksheets/sheet${index + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`;
  }).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>${sheets}<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`;
}

function workbookXml(names: string[]): string {
  const sheets = names
    .map((name, index) => `<sheet name="${xmlText(name)}" sheetId="${index + 1}" r:id="rId${index + 1}"/>`)
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets}</sheets></workbook>`;
}

function workbookRels(sheetCount: number): string {
  const sheets = Array.from({ length: sheetCount }, (_, index) => {
    return `<Relationship Id="rId${index + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${index + 1}.xml"/>`;
  }).join("");
  const stylesId = sheetCount + 1;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets}<Relationship Id="rId${stylesId}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`;

function text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function storeZip(files: Array<{ name: string; data: Uint8Array }>): Uint8Array {
  const locals: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const file of files) {
    const name = text(file.name);
    const crc = crc32(file.data);
    const local = new Uint8Array(30 + name.length);
    const view = new DataView(local.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(4, 20, true);
    view.setUint32(14, crc, true);
    view.setUint32(18, file.data.length, true);
    view.setUint32(22, file.data.length, true);
    view.setUint16(26, name.length, true);
    local.set(name, 30);
    locals.push(local, file.data);

    const header = new Uint8Array(46 + name.length);
    const centralView = new DataView(header.buffer);
    centralView.setUint32(0, 0x02014b50, true);
    centralView.setUint16(4, 20, true);
    centralView.setUint16(6, 20, true);
    centralView.setUint32(16, crc, true);
    centralView.setUint32(20, file.data.length, true);
    centralView.setUint32(24, file.data.length, true);
    centralView.setUint16(28, name.length, true);
    centralView.setUint32(42, offset, true);
    header.set(name, 46);
    central.push(header);
    offset += local.length + file.data.length;
  }
  const centralSize = central.reduce((sum, part) => sum + part.length, 0);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, centralSize, true);
  endView.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + end.length);
  let cursor = 0;
  for (const part of [...locals, ...central, end]) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}

const CRC_TABLE = new Uint32Array(256);
for (let index = 0; index < 256; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  CRC_TABLE[index] = value >>> 0;
}

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let index = 0; index < data.length; index += 1) {
    crc = CRC_TABLE[(crc ^ data[index]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
