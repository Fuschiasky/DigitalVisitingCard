'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const path   = require('path');
const fs     = require('fs');
const { query, sql } = require('../db/pool');
const { requireAuth }        = require('../middleware/auth');
const { upload, uploadCsv, verifyUploadedFile, UPLOAD_DIR } = require('../middleware/upload');
const {
  profileValidationRules, validateRequest,
  sanitiseProfile, requireValidSlug, validateProfileRow,
  adminApiLimiter,
} = require('../middleware/security');
const { parseProfileCsv } = require('../utils/csv');
const multer = require('multer');

// Wraps uploadCsv.single('file') so a rejected MIME/extension or an
// oversized file returns a clear 400 with the real reason, instead of
// falling through to the app's generic 500 error handler (which is what
// happens today on the equivalent photo-upload route — same underlying
// gap, fixed here so the new bulk feature doesn't inherit it).
function handleCsvUpload(req, res, next) {
  uploadCsv.single('file')(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(400).json({ error: 'CSV file is too large (max 2 MB).' });
      }
      return res.status(400).json({ error: err.message });
    }
    // Errors thrown from fileFilter's cb(new Error(...))
    return res.status(400).json({ error: err.message || 'Invalid file upload.' });
  });
}

// All admin routes require valid JWT
router.use(requireAuth);

// ─────────────────────────────────────────────
//  GET /api/admin/profiles
// ─────────────────────────────────────────────
router.get('/profiles', async (req, res) => {
  try {
    const result = await query(`
      SELECT id, slug, first_name, last_name, designation, email,
             phone_primary, phone_2, phone_3,
             CASE WHEN photo_path IS NOT NULL THEN 1 ELSE 0 END AS has_photo,
             is_active, created_at, updated_at
      FROM profiles
      ORDER BY created_at DESC
    `);
    res.json({ profiles: result.recordset });
  } catch (err) {
    console.error('[ADMIN] List error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
//  POST /api/admin/profiles
// ─────────────────────────────────────────────
router.post(
  '/profiles',
  sanitiseProfile,
  profileValidationRules,
  validateRequest,
  async (req, res) => {
    try {
      const {
        first_name, last_name, designation, email,
        phone_primary, phone_2, phone_3,
      } = req.body;

      const slug   = uuidv4();

      const result = await query(`
        INSERT INTO profiles
          (slug, first_name, last_name, designation, email,
           phone_primary, phone_2, phone_3, created_by)
        OUTPUT INSERTED.id
        VALUES (@slug, @first_name, @last_name, @designation, @email,
                @phone_primary, @phone_2, @phone_3, @created_by)
      `, {
        slug:          { type: sql.Char,     value: slug },
        first_name:    { type: sql.NVarChar, value: first_name },
        last_name:     { type: sql.NVarChar, value: last_name },
        designation:   { type: sql.NVarChar, value: designation },
        email:         { type: sql.NVarChar, value: email },
        phone_primary: { type: sql.NVarChar, value: phone_primary },
        phone_2:       { type: sql.NVarChar, value: phone_2  || null },
        phone_3:       { type: sql.NVarChar, value: phone_3  || null },
        created_by:    { type: sql.Int,      value: req.admin.id },
      });

      const newId = result.recordset[0].id;

      await query(`
        INSERT INTO audit_log (admin_id, action, target_id, ip_address, detail)
        VALUES (@adminId, 'PROFILE_CREATED', @targetId, @ip, @detail)
      `, {
        adminId:  { type: sql.Int,      value: req.admin.id },
        targetId: { type: sql.Int,      value: newId },
        ip:       { type: sql.NVarChar, value: req.ip },
        detail:   { type: sql.NVarChar, value: JSON.stringify({ slug, first_name, last_name }) },
      });

      res.status(201).json({
        message:    'Profile created',
        profile:    { id: newId, slug },
        profileUrl: `/p/${slug}`,
      });
    } catch (err) {
      console.error('[ADMIN] Create error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ─────────────────────────────────────────────
//  POST /api/admin/profiles/bulk
//  Accepts a CSV file (field name "file") with columns:
//  first_name, last_name, designation, email, phone_primary, phone_2, phone_3
//  (header names are matched case-insensitively; "Phone 2" etc. also work).
//
//  Each row is validated with the same rules as single-profile
//  creation. Rows that fail validation are skipped and reported —
//  they do not abort the rest of the batch, since the common case
//  is "199 good rows and 1 typo", not "all or nothing".
// ─────────────────────────────────────────────
router.post('/profiles/bulk', adminApiLimiter, handleCsvUpload, async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No CSV file uploaded' });
  }

  const MAX_ROWS = 500; // sane upper bound per batch; prevents one request pinning the DB pool

  let parsed;
  try {
    parsed = parseProfileCsv(req.file.buffer);
  } catch (err) {
    console.error('[ADMIN] Bulk CSV parse error:', err);
    return res.status(400).json({ error: 'Could not parse CSV file' });
  } finally {
    // The CSV is held only as an in-memory buffer (multer.memoryStorage —
    // never written to disk). Once parsed into rows there's no reason to
    // keep the raw bytes around for the rest of the request; drop the
    // reference so it's eligible for garbage collection immediately
    // rather than lingering until the response finishes.
    req.file.buffer = null;
  }

  if (parsed.headerError) {
    return res.status(400).json({ error: parsed.headerError });
  }

  if (!parsed.rows.length) {
    return res.status(400).json({ error: 'CSV file contains no data rows' });
  }

  if (parsed.rows.length > MAX_ROWS) {
    return res.status(400).json({
      error: `CSV contains ${parsed.rows.length} rows; the limit per upload is ${MAX_ROWS}. Split it into smaller files.`,
    });
  }

  const created = [];
  const failed  = [];

  for (const row of parsed.rows) {
    const { valid, errors, clean } = validateProfileRow(row);

    if (!valid) {
      failed.push({ row: row._rowNumber, errors });
      continue;
    }

    try {
      const slug = uuidv4();
      const result = await query(`
        INSERT INTO profiles
          (slug, first_name, last_name, designation, email,
           phone_primary, phone_2, phone_3, created_by)
        OUTPUT INSERTED.id
        VALUES (@slug, @first_name, @last_name, @designation, @email,
                @phone_primary, @phone_2, @phone_3, @created_by)
      `, {
        slug:          { type: sql.Char,     value: slug },
        first_name:    { type: sql.NVarChar, value: clean.first_name },
        last_name:     { type: sql.NVarChar, value: clean.last_name },
        designation:   { type: sql.NVarChar, value: clean.designation },
        email:         { type: sql.NVarChar, value: clean.email },
        phone_primary: { type: sql.NVarChar, value: clean.phone_primary },
        phone_2:       { type: sql.NVarChar, value: clean.phone_2 },
        phone_3:       { type: sql.NVarChar, value: clean.phone_3 },
        created_by:    { type: sql.Int,      value: req.admin.id },
      });

      created.push({
        row: row._rowNumber,
        id: result.recordset[0].id,
        slug,
        name: `${clean.first_name} ${clean.last_name}`,
      });
    } catch (err) {
      console.error('[ADMIN] Bulk row insert error (row ' + row._rowNumber + '):', err);
      failed.push({ row: row._rowNumber, errors: ['Server error while saving this row'] });
    }
  }

  const totalRows = parsed.rows.length;
  parsed = null; // release parsed row data; only totalRows is needed from here on

  try {
    await query(`
      INSERT INTO audit_log (admin_id, action, ip_address, detail)
      VALUES (@adminId, 'PROFILE_BULK_UPLOAD', @ip, @detail)
    `, {
      adminId: { type: sql.Int,      value: req.admin.id },
      ip:      { type: sql.NVarChar, value: req.ip },
      detail:  {
        type: sql.NVarChar,
        value: JSON.stringify({ totalRows, created: created.length, failed: failed.length }),
      },
    });
  } catch (err) {
    // Audit log failure shouldn't mask a successful upload — log and continue.
    console.error('[ADMIN] Bulk upload audit log error:', err);
  }

  res.status(created.length ? 201 : 400).json({
    message:      `${created.length} profile(s) created, ${failed.length} row(s) failed`,
    totalRows,
    created,
    failed,
  });
});


router.put(
  '/profiles/:slug',
  requireValidSlug,
  sanitiseProfile,
  profileValidationRules,
  validateRequest,
  async (req, res) => {
    try {
      const { slug } = req.params;
      const {
        first_name, last_name, designation, email,
        phone_primary, phone_2, phone_3, is_active,
      } = req.body;

      const existing = await query(
        'SELECT id FROM profiles WHERE slug = @slug',
        { slug: { type: sql.Char, value: slug } }
      );
      if (!existing.recordset.length) {
        return res.status(404).json({ error: 'Profile not found' });
      }

      await query(`
        UPDATE profiles
        SET first_name    = @first_name,
            last_name     = @last_name,
            designation   = @designation,
            email         = @email,
            phone_primary = @phone_primary,
            phone_2       = @phone_2,
            phone_3       = @phone_3,
            is_active     = @is_active
        WHERE slug = @slug
      `, {
        slug:          { type: sql.Char,    value: slug },
        first_name:    { type: sql.NVarChar, value: first_name },
        last_name:     { type: sql.NVarChar, value: last_name },
        designation:   { type: sql.NVarChar, value: designation },
        email:         { type: sql.NVarChar, value: email },
        phone_primary: { type: sql.NVarChar, value: phone_primary },
        phone_2:       { type: sql.NVarChar, value: phone_2  || null },
        phone_3:       { type: sql.NVarChar, value: phone_3  || null },
        is_active:     { type: sql.TinyInt,  value: is_active !== undefined ? (is_active ? 1 : 0) : 1 },
      });

      await query(`
        INSERT INTO audit_log (admin_id, action, target_id, ip_address)
        VALUES (@adminId, 'PROFILE_UPDATED', @targetId, @ip)
      `, {
        adminId:  { type: sql.Int,      value: req.admin.id },
        targetId: { type: sql.Int,      value: existing.recordset[0].id },
        ip:       { type: sql.NVarChar, value: req.ip },
      });

      res.json({ message: 'Profile updated' });
    } catch (err) {
      console.error('[ADMIN] Update error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ─────────────────────────────────────────────
//  DELETE /api/admin/profiles/:slug
// ─────────────────────────────────────────────
router.delete('/profiles/:slug', requireValidSlug, async (req, res) => {
  try {
    const { slug } = req.params;
    const existing = await query(
      'SELECT id, photo_path FROM profiles WHERE slug = @slug',
      { slug: { type: sql.Char, value: slug } }
    );
    if (!existing.recordset.length) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const profile = existing.recordset[0];

    if (profile.photo_path && UPLOAD_DIR) {
      const filePath = path.join(UPLOAD_DIR, path.basename(profile.photo_path));
      fs.unlink(filePath, () => {});
    }

    await query(
      'DELETE FROM profiles WHERE slug = @slug',
      { slug: { type: sql.Char, value: slug } }
    );

    await query(`
      INSERT INTO audit_log (admin_id, action, target_id, ip_address, detail)
      VALUES (@adminId, 'PROFILE_DELETED', @targetId, @ip, @detail)
    `, {
      adminId:  { type: sql.Int,      value: req.admin.id },
      targetId: { type: sql.Int,      value: profile.id },
      ip:       { type: sql.NVarChar, value: req.ip },
      detail:   { type: sql.NVarChar, value: JSON.stringify({ slug }) },
    });

    res.json({ message: 'Profile deleted' });
  } catch (err) {
    console.error('[ADMIN] Delete error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
//  POST /api/admin/profiles/:slug/photo
// ─────────────────────────────────────────────
router.post(
  '/profiles/:slug/photo',
  requireValidSlug,
  upload.single('photo'),
  verifyUploadedFile,
  async (req, res) => {
    try {
      const { slug } = req.params;
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

      const existing = await query(
        'SELECT id, photo_path FROM profiles WHERE slug = @slug',
        { slug: { type: sql.Char, value: slug } }
      );
      if (!existing.recordset.length) {
        if (req.file.path) fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: 'Profile not found' });
      }

      const profile = existing.recordset[0];

      // Remove old photo file if exists
      if (profile.photo_path && UPLOAD_DIR) {
        const old = path.join(UPLOAD_DIR, path.basename(profile.photo_path));
        fs.unlink(old, () => {});
      }

      // IMPORTANT: Store URL path, not file path
      const photoPath = `/uploads/${req.file.filename}`;

      console.log('[ADMIN] File saved to:', req.file.path);
      console.log('[ADMIN] Storing URL path:', photoPath);

      // Update database with URL path
      await query(
        `UPDATE profiles 
         SET photo_path = @photoPath
         WHERE slug = @slug`,
        {
          photoPath: { type: sql.NVarChar, value: photoPath },
          slug:      { type: sql.Char,     value: slug },
        }
      );

      await query(`
        INSERT INTO audit_log (admin_id, action, target_id, ip_address)
        VALUES (@adminId, 'PHOTO_UPLOADED', @targetId, @ip)
      `, {
        adminId:  { type: sql.Int,      value: req.admin.id },
        targetId: { type: sql.Int,      value: profile.id },
        ip:       { type: sql.NVarChar, value: req.ip },
      });

      res.json({ message: 'Photo uploaded', photoUrl: photoPath });
    } catch (err) {
      if (req.file && req.file.path) fs.unlink(req.file.path, () => {});
      console.error('[ADMIN] Photo upload error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);


// ─────────────────────────────────────────────
//  DELETE /api/admin/profiles/:slug/photo
// ─────────────────────────────────────────────
router.delete('/profiles/:slug/photo', requireValidSlug, async (req, res) => {
  try {
    const { slug } = req.params;
    const existing = await query(
      'SELECT id, photo_path FROM profiles WHERE slug = @slug',
      { slug: { type: sql.Char, value: slug } }
    );
    if (!existing.recordset.length) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const profile = existing.recordset[0];
    if (profile.photo_path && UPLOAD_DIR) {
      const filePath = path.join(UPLOAD_DIR, path.basename(profile.photo_path));
      fs.unlink(filePath, () => {});
    }

    await query(
      'UPDATE profiles SET photo_path = NULL WHERE slug = @slug',
      { slug: { type: sql.Char, value: slug } }
    );

    res.json({ message: 'Photo removed' });
  } catch (err) {
    console.error('[ADMIN] Remove photo error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;