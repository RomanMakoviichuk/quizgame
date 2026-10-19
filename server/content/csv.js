/**
 * Minimal RFC-4180-ish CSV parser / serializer. No dependencies.
 *
 * - Fields may be quoted with `"`; embedded quotes are doubled (`""`).
 * - Handles `\r\n`, `\n` and `\r` line endings, and newlines inside quotes.
 * - `parse()` returns an array of row objects keyed by the header row.
 */

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const src = String(text || "");

  for (let i = 0; i < src.length; i++) {
    const c = src[i];

    if (inQuotes) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
      continue;
    }

    if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\r") {
      // swallow; a following \n finishes the line
      if (src[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += c;
    }
  }
  // trailing field / row
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // drop fully-empty trailing rows
  const cleaned = rows.filter(
    (r) => !(r.length === 1 && r[0].trim() === "")
  );
  if (cleaned.length === 0) return { header: [], rows: [] };

  const header = cleaned[0].map((h) => h.trim());
  const dataRows = cleaned.slice(1).map((r, idx) => {
    const obj = {};
    header.forEach((h, hi) => {
      obj[h] = (r[hi] ?? "").trim();
    });
    // 1-based row number as it appears in the file (header = row 1)
    obj.__row = idx + 2;
    return obj;
  });
  return { header, rows: dataRows };
}

function escapeField(value) {
  const s = value == null ? "" : String(value);
  if (/[",\r\n]/.test(s)) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

function toCsv(header, rows) {
  const lines = [header.map(escapeField).join(",")];
  for (const r of rows) {
    lines.push(header.map((h) => escapeField(r[h])).join(","));
  }
  return lines.join("\r\n") + "\r\n";
}

module.exports = { parseCsv, toCsv };
