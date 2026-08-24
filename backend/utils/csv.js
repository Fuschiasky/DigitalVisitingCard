'use strict';

const multer = require('multer');

const uploadCsv = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB is generous for a few thousand rows of this schema
  fileFilter: (req, file, cb) => {
    const allowedMimes = ['text/csv', 'application/vnd.ms-excel', 'text/plain'];
    const hasCsvExt = /\.csv$/i.test(file.originalname || '');
    if (!hasCsvExt || !allowedMimes.includes(file.mimetype)) {
      return cb(new Error('Invalid file type. Only .csv files are allowed.'));
    }
    cb(null, true);
  },
});

module.exports = { uploadCsv };