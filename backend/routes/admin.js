'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const path   = require('path');
const fs     = require('fs');
const pool   = require('../db/pool');
const { requireAuth }        = require('../middleware/auth');
const { upload, verifyUploadedFile, UPLOAD_DIR } = require('../middleware/upload');
const {
  profileValidationRules, validateRequest,
  sanitiseProfile, requireValidSlug,
} = require('../middleware/security');

// All admin routes require valid JWT
router.use(requireAuth);

// ─────────────────────────────────────────────
//  GET /api/admin/profiles
// ─────────────────────────────────────────────
router.get('/profiles', async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, slug, first_name, last_name, designation,
              phone_primary, phone_2, phone_3,
              photo_path IS NOT NULL AS has_photo,
              is_active, created_at, updated_at
       FROM profiles
       ORDER BY created_at DESC`
    );
    res.json({ profiles: rows });
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
        first_name, last_name, designation,
        phone_primary, phone_2, phone_3,
      } = req.body;

      const slug = uuidv4();

      const [result] = await pool.query(
        `INSERT INTO profiles
           (slug, first_name, last_name, designation,
            phone_primary, phone_2, phone_3, created_by)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [slug, first_name, last_name, designation,
         phone_primary,
         phone_2  || null,
         phone_3  || null,
         req.admin.id]
      );

      await pool.query(
        `INSERT INTO audit_log (admin_id, action, target_id, ip_address, detail)
         VALUES (?, 'PROFILE_CREATED', ?, ?, ?)`,
        [req.admin.id, result.insertId, req.ip, JSON.stringify({ slug, first_name, last_name })]
      );

      res.status(201).json({
        message: 'Profile created',
        profile: { id: result.insertId, slug },
        profileUrl: `/p/${slug}`,
      });
    } catch (err) {
      console.error('[ADMIN] Create error:', err);
      res.status(500).json({ error: 'Server error' });
    }
  }
);

// ─────────────────────────────────────────────
//  PUT /api/admin/profiles/:slug
// ─────────────────────────────────────────────
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
        first_name, last_name, designation,
        phone_primary, phone_2, phone_3, is_active,
      } = req.body;

      const [rows] = await pool.query('SELECT id FROM profiles WHERE slug = ?', [slug]);
      if (!rows.length) return res.status(404).json({ error: 'Profile not found' });

      await pool.query(
        `UPDATE profiles
         SET first_name = ?, last_name = ?, designation = ?,
             phone_primary = ?, phone_2 = ?, phone_3 = ?,
             is_active = ?
         WHERE slug = ?`,
        [first_name, last_name, designation,
         phone_primary,
         phone_2  || null,
         phone_3  || null,
         is_active !== undefined ? (is_active ? 1 : 0) : 1,
         slug]
      );

      await pool.query(
        `INSERT INTO audit_log (admin_id, action, target_id, ip_address)
         VALUES (?, 'PROFILE_UPDATED', ?, ?)`,
        [req.admin.id, rows[0].id, req.ip]
      );

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
    const [rows] = await pool.query(
      'SELECT id, photo_path FROM profiles WHERE slug = ?', [slug]
    );
    if (!rows.length) return res.status(404).json({ error: 'Profile not found' });

    const profile = rows[0];

    // Delete photo file if present
    if (profile.photo_path) {
      const filePath = path.join(UPLOAD_DIR, path.basename(profile.photo_path));
      fs.unlink(filePath, () => {});   // non-blocking, ignore errors
    }

    await pool.query('DELETE FROM profiles WHERE slug = ?', [slug]);

    await pool.query(
      `INSERT INTO audit_log (admin_id, action, target_id, ip_address, detail)
       VALUES (?, 'PROFILE_DELETED', ?, ?, ?)`,
      [req.admin.id, profile.id, req.ip, JSON.stringify({ slug })]
    );

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

      const [rows] = await pool.query(
        'SELECT id, photo_path FROM profiles WHERE slug = ?', [slug]
      );
      if (!rows.length) {
        fs.unlinkSync(req.file.path);
        return res.status(404).json({ error: 'Profile not found' });
      }

      // Remove old photo - Used when running locally with file paths in DB. If storing full path in DB, this is not needed as the new upload will overwrite the old file.
      // if (rows[0].photo_path) {
      //   const old = path.join(UPLOAD_DIR, path.basename(rows[0].photo_path));
      //   fs.unlink(old, () => {});
      // }

      //const photoPath = `/uploads/${req.file.filename}`; Used when running locally
      const photoPath = req.file.path;
      await pool.query('UPDATE profiles SET photo_path = ? WHERE slug = ?', [photoPath, slug]);

      await pool.query(
        `INSERT INTO audit_log (admin_id, action, target_id, ip_address)
         VALUES (?, 'PHOTO_UPLOADED', ?, ?)`,
        [req.admin.id, rows[0].id, req.ip]
      );

      res.json({ message: 'Photo uploaded', photoUrl: photoPath });
    } catch (err) {
      if (req.file) fs.unlink(req.file.path, () => {});
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
    const [rows] = await pool.query('SELECT id, photo_path FROM profiles WHERE slug = ?', [slug]);
    if (!rows.length) return res.status(404).json({ error: 'Profile not found' });

    if (rows[0].photo_path) {
      const filePath = path.join(UPLOAD_DIR, path.basename(rows[0].photo_path));
      fs.unlink(filePath, () => {});
      await pool.query('UPDATE profiles SET photo_path = NULL WHERE slug = ?', [slug]);
    }

    res.json({ message: 'Photo removed' });
  } catch (err) {
    console.error('[ADMIN] Remove photo error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
