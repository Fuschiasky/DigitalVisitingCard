'use strict';

const router = require('express').Router();
const pool   = require('../db/pool');
const { requireValidSlug, publicLimiter } = require('../middleware/security');

// ─────────────────────────────────────────────
//  GET /api/profile/:slug
//  Returns profile JSON for the public viewer
// ─────────────────────────────────────────────
router.get('/:slug', publicLimiter, requireValidSlug, async (req, res) => {
  try {
    const { slug } = req.params;

    const [rows] = await pool.query(
      `SELECT
         first_name, last_name, designation,
         phone_primary, phone_2, phone_3,
         photo_path
       FROM profiles
       WHERE slug = ? AND is_active = 1`,
      [slug]
    );

    if (!rows.length) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const p = rows[0];

    // Build phone list (exclude nulls)
    const phones = [p.phone_primary, p.phone_2, p.phone_3].filter(Boolean);

    res.json({
      firstName:   p.first_name,
      lastName:    p.last_name,
      fullName:    `${p.first_name} ${p.last_name}`,
      designation: p.designation,
      phones,
      photoUrl:    p.photo_path || null,
      initials:    `${p.first_name[0]}${p.last_name[0]}`.toUpperCase(),
    });
  } catch (err) {
    console.error('[PROFILE] Fetch error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
