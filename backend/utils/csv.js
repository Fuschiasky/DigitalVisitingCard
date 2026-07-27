'use strict';

// ─────────────────────────────────────────────
//  Minimal RFC4180-style CSV parser.
//  Handles quoted fields, embedded commas, embedded quotes
//  ("" escape), and both \n and \r\n line endings — the cases
//  a real export from Excel/Google Sheets will actually contain.
//  No external dependency; the format needed here doesn't
//  warrant pulling in a full CSV library.
// ─────────────────────────────────────────────
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const len = text.length;

  while (i < len) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }

    if (ch === '"') { inQuotes = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r') { i++; continue; }
    if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
      i++; continue;
    }
    field += ch; i++;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  // Drop fully-empty trailing rows (common artifact of a trailing newline)
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

// ─────────────────────────────────────────────
//  Parse a CSV buffer into an array of row objects keyed by
//  header name. Header matching is case-insensitive and
//  ignores surrounding whitespace, so "First Name" / "first_name"
//  / " first_name " all map to the same field.
// ─────────────────────────────────────────────
const HEADER_ALIASES = {
  firstname:      'first_name',
  first_name:     'first_name',
  lastname:       'last_name',
  last_name:      'last_name',
  designation:    'designation',
  title:          'designation',
  email:          'email',
  emailid:        'email',
  emailaddress:   'email',
  phoneprimary:   'phone_primary',
  phone_primary:  'phone_primary',
  phone1:         'phone_primary',
  phone:          'phone_primary',
  phone2:         'phone_2',
  phone_2:        'phone_2',
  phone3:         'phone_3',
  phone_3:        'phone_3',
};

function normaliseHeader(h) {
  const key = String(h || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
  return HEADER_ALIASES[key] || HEADER_ALIASES[key.replace(/_/g, '')] || null;
}

function parseProfileCsv(buffer) {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, ''); // strip BOM if present
  const rows = parseCsv(text);
  if (!rows.length) return { rows: [], headerError: 'CSV file is empty' };

  const headerRow = rows[0];
  const fieldMap  = headerRow.map(normaliseHeader);

  if (!fieldMap.includes('first_name') || !fieldMap.includes('last_name') ||
      !fieldMap.includes('designation') || !fieldMap.includes('email') ||
      !fieldMap.includes('phone_primary')) {
    return {
      rows: [],
      headerError:
        'CSV header must include first_name, last_name, designation, email, and phone_primary columns',
    };
  }

  const dataRows = rows.slice(1).map((cells, idx) => {
    const obj = { _rowNumber: idx + 2 }; // +2: 1-indexed, plus header row
    fieldMap.forEach((field, col) => {
      if (field) obj[field] = cells[col] !== undefined ? cells[col] : '';
    });
    return obj;
  }).filter(obj => {
    // Skip fully-blank rows (trailing blank lines in the file)
    return Object.keys(obj).some(k => k !== '_rowNumber' && obj[k]);
  });

  return { rows: dataRows, headerError: null };
}

module.exports = { parseCsv, parseProfileCsv };