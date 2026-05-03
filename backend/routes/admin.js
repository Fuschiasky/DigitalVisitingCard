'use strict';

const router = require('express').Router();
const { v4: uuidv4 } = require('uuid');
const path   = require('path');
const fs     = require('fs');
const { query, sql } = require('../db/pool');
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
    const result = await query(`
      SELECT id, slug, first_name, last_name, designation,
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
        first_name, last_name, designation,
        phone_primary, phone_2, phone_3,
      } = req.body;

      const slug   = uuidv4();

      const result = await query(`
        INSERT INTO profiles
          (slug, first_name, last_name, designation,
           phone_primary, phone_2, phone_3, created_by)
        OUTPUT INSERTED.id
        VALUES (@slug, @first_name, @last_name, @designation,
                @phone_primary, @phone_2, @phone_3, @created_by)
      `, {
        slug:          { type: sql.Char,     value: slug },
        first_name:    { type: sql.NVarChar, value: first_name },
        last_name:     { type: sql.NVarChar, value: last_name },
        designation:   { type: sql.NVarChar, value: designation },
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
