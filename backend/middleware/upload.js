'use strict';

const multer = require('multer');

// ─────────────────────────────────────────────
//  CSV bulk-upload — kept in memory, never written to disk.
// ─────────────────────────────────────────────
const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB is generous for a few thousand rows of this schema
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['text/csv', 'application/vnd.ms-excel', 'text/plain'];
    const hasCsvExt = /\.csv$/i.test(file.originalname || '');
    // Browsers are inconsistent about the MIME type they report for .csv
    // (some send text/plain, some application/vnd.ms-excel) — require the
    // extension too so we don't accept arbitrary uploads on MIME alone.
    if (!hasCsvExt || !allowedMimes.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only .csv files are allowed.'));
    }
    cb(null, true);
  },
});

module.exports = { uploadCsv };