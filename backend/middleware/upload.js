'use strict';

const multer     = require('multer');
const cloudinary = require('cloudinary').v2;
const { CloudinaryStorage } = require('multer-storage-cloudinary');

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary,
  params: {
    folder:          'diageo-profiles',
    allowed_formats: ['jpg', 'jpeg', 'png', 'webp'],
    transformation:  [{ width: 400, height: 400, crop: 'fill', gravity: 'face' }],
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
});

function verifyUploadedFile(req, res, next) {
  next();
}

const UPLOAD_DIR = '';

module.exports = { upload, verifyUploadedFile, UPLOAD_DIR };


//----------------------------------------------------------------
//USE BELOW WHEN RUNNING ON LOCAL MACHINE
//----------------------------------------------------------------

// 'use strict';

// const multer = require('multer');
// const path   = require('path');
// const crypto = require('crypto');
// const fs     = require('fs');

// const UPLOAD_DIR  = path.join(__dirname, '..', 'uploads');
// const MAX_SIZE    = 5 * 1024 * 1024;   // 5 MB

// // Ensure upload directory exists with restricted permissions
// if (!fs.existsSync(UPLOAD_DIR)) {
//   fs.mkdirSync(UPLOAD_DIR, { recursive: true, mode: 0o750 });
// }

// // Allowed MIME types
// const ALLOWED_MIMES = new Set(['image/jpeg', 'image/png', 'image/webp']);

// // Magic bytes validation (defence-in-depth — don't trust MIME alone)
// const MAGIC = {
//   'image/jpeg': [0xFF, 0xD8, 0xFF],
//   'image/png':  [0x89, 0x50, 0x4E, 0x47],
//   'image/webp': [0x52, 0x49, 0x46, 0x46],   // RIFF....WEBP
// };

// function checkMagicBytes(buffer, mime) {
//   const bytes = MAGIC[mime];
//   if (!bytes) return false;
//   for (let i = 0; i < bytes.length; i++) {
//     if (buffer[i] !== bytes[i]) return false;
//   }
//   return true;
// }

// const storage = multer.diskStorage({
//   destination: (req, file, cb) => cb(null, UPLOAD_DIR),
//   filename:    (req, file, cb) => {
//     const ext      = path.extname(file.originalname).toLowerCase().replace(/[^.a-z]/g, '');
//     const safeName = crypto.randomBytes(24).toString('hex') + ext;
//     cb(null, safeName);
//   },
// });

// const upload = multer({
//   storage,
//   limits: { fileSize: MAX_SIZE, files: 1 },
//   fileFilter: (req, file, cb) => {
//     if (!ALLOWED_MIMES.has(file.mimetype)) {
//       return cb(new Error('Only JPEG, PNG, and WebP images are allowed'), false);
//     }
//     cb(null, true);
//   },
// });

// // Second-pass magic byte check after multer saves the file
// function verifyUploadedFile(req, res, next) {
//   if (!req.file) return next();

//   const filePath = req.file.path;
//   const buf      = Buffer.alloc(12);
//   let   fd;

//   try {
//     fd = fs.openSync(filePath, 'r');
//     fs.readSync(fd, buf, 0, 12, 0);
//     fs.closeSync(fd);
//   } catch {
//     fs.unlinkSync(filePath);
//     return res.status(400).json({ error: 'Could not read uploaded file' });
//   }

//   if (!checkMagicBytes(buf, req.file.mimetype)) {
//     fs.unlinkSync(filePath);
//     return res.status(400).json({ error: 'File content does not match declared type' });
//   }

//   next();
// }

// module.exports = { upload, verifyUploadedFile, UPLOAD_DIR };