/* خروجی Excel و PDF بدون کتابخانه‌ی سنگین (حجم برنامه کم می‌ماند).
   سند گزارش:  { title, subtitle, sections: [{ title, head?: [..], rows: [[..]] }] }
   سلول: عدد یا متن.  در اندروید فایل ساخته و با Share ارسال/ذخیره می‌شود. */
import { Capacitor } from "@capacitor/core";
import { Filesystem, Directory } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";

const enc = new TextEncoder();
const FONT = "'Vazirmatn', Tahoma, 'Segoe UI', sans-serif";
const faNum = (n) => Math.round(Number(n) || 0).toLocaleString("fa-IR");
const cellText = (v) => (typeof v === "number" ? faNum(v) : String(v ?? ""));
const safeName = (s) => String(s || "report").replace(/[\\/:*?"<>|\s]+/g, "-").slice(0, 60);

/* ---------- ارسال / ذخیره ---------- */
function toBase64(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export async function saveAndShare(filename, bytes, mime) {
  if (Capacitor.isNativePlatform()) {
    const r = await Filesystem.writeFile({ path: filename, data: toBase64(bytes), directory: Directory.Cache });
    await Share.share({ title: filename, text: filename, files: [r.uri], dialogTitle: "ذخیره یا ارسال گزارش" });
    return;
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: mime }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ---------- zip (بدون فشرده‌سازی) برای xlsx ---------- */
let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) { CRC_TABLE = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; CRC_TABLE[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function zipStore(files) {
  const chunks = [], central = []; let offset = 0;
  const u16 = (v) => [v & 255, (v >>> 8) & 255], u32 = (v) => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  for (const [name, data] of files) {
    const nb = enc.encode(name), crc = crc32(data);
    const local = new Uint8Array([0x50, 0x4b, 3, 4, ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)]);
    chunks.push(local, nb, data);
    central.push(new Uint8Array([0x50, 0x4b, 1, 2, ...u16(20), ...u16(20), ...u16(0x0800), ...u16(0), ...u16(0), ...u16(0x21), ...u32(crc), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nb);
    offset += local.length + nb.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array([0x50, 0x4b, 5, 6, ...u16(0), ...u16(0), ...u16(files.length), ...u16(files.length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0)); let p = 0;
  for (const c of all) { out.set(c, p); p += c.length; }
  return out;
}

/* ---------- xlsx ---------- */
const xmlEsc = (s) => String(s).replace(/[&<>"\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c] || ""));
const colName = (i) => { let s = ""; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
export function buildXlsx(doc) {
  const rows = []; let maxCols = 1;
  const push = (cells) => { rows.push(cells); maxCols = Math.max(maxCols, cells.length); };
  push([{ v: doc.title, s: 1 }]);
  if (doc.subtitle) push([{ v: doc.subtitle }]);
  for (const sec of doc.sections || []) {
    push([]);
    if (sec.title) push([{ v: sec.title, s: 1 }]);
    if (sec.head) push(sec.head.map((h) => ({ v: h, s: 3 })));
    for (const r of sec.rows || []) push(r.map((v) => ({ v, s: typeof v === "number" ? 2 : 0 })));
  }
  const sheetRows = rows.map((cells, ri) => {
    const cs = cells.map((c, ci) => {
      const ref = colName(ci) + (ri + 1);
      if (c.v === "" || c.v == null) return "";
      return typeof c.v === "number"
        ? `<c r="${ref}" s="${c.s || 2}"><v>${c.v}</v></c>`
        : `<c r="${ref}" s="${c.s || 0}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(c.v)}</t></is></c>`;
    }).join("");
    return `<row r="${ri + 1}">${cs}</row>`;
  }).join("");
  const cols = `<cols><col min="1" max="1" width="30" customWidth="1"/><col min="2" max="${Math.max(2, maxCols)}" width="20" customWidth="1"/></cols>`;
  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews>${cols}<sheetData>${sheetRows}</sheetData></worksheet>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFE8E0F2"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="4"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const files = [
    ["[Content_Types].xml", enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`)],
    ["_rels/.rels", enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`)],
    ["xl/workbook.xml", enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="گزارش" sheetId="1" r:id="rId1"/></sheets></workbook>`)],
    ["xl/_rels/workbook.xml.rels", enc.encode(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`)],
    ["xl/styles.xml", enc.encode(styles)],
    ["xl/worksheets/sheet1.xml", enc.encode(sheet)],
  ];
  return zipStore(files);
}

/* ---------- PDF: هر صفحه با Canvas (شکل‌دهی درست فارسی) کشیده و در PDF گذاشته می‌شود ---------- */
const PW = 1190, PH = 1684, MX = 60, MY = 70, ROW = 46;   // A4 با مقیاس ۲
function fit(ctx, text, maxW) {
  let t = String(text);
  if (ctx.measureText(t).width <= maxW) return t;
  while (t.length > 1 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}
function renderPages(doc) {
  const pages = []; let cv, ctx, y;
  const newPage = () => {
    cv = document.createElement("canvas"); cv.width = PW; cv.height = PH;
    ctx = cv.getContext("2d"); ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, PW, PH);
    ctx.direction = "rtl"; ctx.textBaseline = "middle"; y = MY; pages.push(cv);
  };
  const text = (t, xRight, yy, { size = 24, bold = false, color = "#222", maxW = PW - 2 * MX, align = "right" } = {}) => {
    ctx.font = `${bold ? "bold " : ""}${size}px ${FONT}`; ctx.fillStyle = color; ctx.textAlign = align;
    ctx.fillText(fit(ctx, t, maxW), xRight, yy);
  };
  newPage();
  text(doc.title, PW - MX, y, { size: 40, bold: true, color: "#3E1461" }); y += 56;
  if (doc.subtitle) { text(doc.subtitle, PW - MX, y, { size: 24, color: "#666" }); y += 44; }
  for (const sec of doc.sections || []) {
    const ncol = Math.max(1, sec.head ? sec.head.length : Math.max(...(sec.rows || [[1]]).map((r) => r.length)));
    const colW = (PW - 2 * MX) / ncol;
    const drawHead = () => {
      if (!sec.head) return;
      ctx.fillStyle = "#E8E0F2"; ctx.fillRect(MX, y - ROW / 2, PW - 2 * MX, ROW);
      sec.head.forEach((h, i) => text(h, PW - MX - i * colW - 12, y, { size: 22, bold: true, color: "#3E1461", maxW: colW - 24 }));
      y += ROW;
    };
    if (y + ROW * 3 > PH - MY) newPage();
    if (sec.title) { y += 14; text(sec.title, PW - MX, y, { size: 28, bold: true, color: "#222" }); y += 48; }
    drawHead();
    (sec.rows || []).forEach((r, ri) => {
      if (y + ROW > PH - MY) { newPage(); drawHead(); }
      if (ri % 2) { ctx.fillStyle = "#F7F5FA"; ctx.fillRect(MX, y - ROW / 2, PW - 2 * MX, ROW); }
      r.forEach((v, i) => {
        const isNum = typeof v === "number";
        const color = isNum ? (v < 0 ? "#C0392B" : "#1E7A4A") : "#222";
        text(cellText(v), PW - MX - i * colW - 12, y, { size: 22, color: isNum ? color : "#222", maxW: colW - 24 });
      });
      y += ROW;
    });
    y += 20;
  }
  const total = pages.length;
  pages.forEach((p, i) => {
    const c = p.getContext("2d"); c.direction = "rtl"; c.textBaseline = "middle"; c.fillStyle = "#999"; c.font = `20px ${FONT}`;
    c.textAlign = "center"; c.fillText(`صفحه ${faNum(i + 1)} از ${faNum(total)}  ·  Rexa`, PW / 2, PH - 34);
  });
  return pages;
}
export function buildPdf(doc) {
  const pages = renderPages(doc);
  const objs = []; const add = (body) => { objs.push(body); return objs.length; };    // شماره‌ی شیء = اندیس + ۱
  const bytesOf = (s) => (typeof s === "string" ? enc.encode(s) : s);
  const catalog = add(null), pagesObj = add(null);
  const kids = [];
  for (const cv of pages) {
    const b64 = cv.toDataURL("image/jpeg", 0.82).split(",")[1];
    const jpg = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const img = add([`<< /Type /XObject /Subtype /Image /Width ${PW} /Height ${PH} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpg.length} >>\nstream\n`, jpg, "\nendstream"]);
    const content = `q 595 0 0 842 0 0 cm /Im0 Do Q`;
    const cont = add([`<< /Length ${content.length} >>\nstream\n${content}\nendstream`]);
    const page = add([`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${img} 0 R >> >> /Contents ${cont} 0 R >>`]);
    kids.push(page);
  }
  objs[catalog - 1] = [`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`];
  objs[pagesObj - 1] = [`<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(" ")}] /Count ${kids.length} >>`];
  const parts = [bytesOf("%PDF-1.4\n")]; const offsets = []; let pos = parts[0].length;
  objs.forEach((body, i) => {
    offsets.push(pos);
    const head = bytesOf(`${i + 1} 0 obj\n`), tail = bytesOf("\nendobj\n");
    const mid = body.map(bytesOf);
    [head, ...mid, tail].forEach((c) => { parts.push(c); pos += c.length; });
  });
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((o) => { xref += `${String(o).padStart(10, "0")} 00000 n \n`; });
  xref += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R >>\nstartxref\n${pos}\n%%EOF`;
  parts.push(bytesOf(xref));
  const out = new Uint8Array(parts.reduce((s, c) => s + c.length, 0)); let p = 0;
  for (const c of parts) { out.set(c, p); p += c.length; }
  return out;
}

const stamp = () => { const d = new Date(), z = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}`; };
// نام فایل فقط لاتین: در اندروید نام فارسی باعث شکست ارسال/ذخیره‌ی فایل می‌شد
export async function exportDocXlsx(doc) { await saveAndShare(`rexa-report-${stamp()}.xlsx`, buildXlsx(doc), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"); }
export async function exportDocPdf(doc) { if (document.fonts?.ready) { try { await document.fonts.ready; } catch {} } await saveAndShare(`rexa-report-${stamp()}.pdf`, buildPdf(doc), "application/pdf"); }
