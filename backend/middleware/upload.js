'use strict';

const multer = require('multer');
const path   = require('path');
const crypto = require('crypto');
const fs     = require('fs');

// Upload directory
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'frontend', 'public', 'uploads');

// Create uploads directory if it doesn't exist
if (!fs.existsSync(UPLOAD_DIR)) {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
}

console.log('[UPLOAD] Directory:', UPLOAD_DIR);

// Configure multer storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Generate unique filename
    const hash = crypto.randomBytes(32).toString('hex');
    const ext = path.extname(file.originalname);
    const filename = hash + ext;
    cb(null, filename);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
  fileFilter: (req, file, cb) => {
    // Whitelist MIME types
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only JPEG, PNG, WebP allowed.'));
    }
    cb(null, true);
  },
});

// ─────────────────────────────────────────────
//  CSV bulk-upload — kept in memory, never written to disk.
//  Distinct instance from the photo `upload` above since the
//  storage engine, size limit, and allowed types are unrelated.
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

// Verify uploaded file
function verifyUploadedFile(req, res, next) {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Check magic bytes (prevent uploading renamed executables)
  const fd = fs.openSync(req.file.path, 'r');
  const buffer = Buffer.alloc(12);
  fs.readSync(fd, buffer, 0, 12, 0);
  fs.closeSync(fd);

  const hex = buffer.toString('hex');
  const validSignatures = [
    'ffd8ff',           // JPEG
    '89504e47',         // PNG
    '52494646',         // WebP (RIFF)
  ];

  const isValid = validSignatures.some(sig => hex.startsWith(sig));
  if (!isValid) {
    fs.unlink(req.file.path, () => {});
    return res.status(400).json({ error: 'Invalid image file' });
  }

  next();
}

module.exports = { upload, uploadCsv, verifyUploadedFile, UPLOAD_DIR };