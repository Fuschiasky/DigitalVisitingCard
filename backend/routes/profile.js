'use strict';

const router = require('express').Router();
const { query, sql } = require('../db/pool');
const { requireValidSlug, publicLimiter } = require('../middleware/security');

// ─────────────────────────────────────────────
//  GET /api/profile/:slug
// ─────────────────────────────────────────────
router.get('/:slug', publicLimiter, requireValidSlug, async (req, res) => {
  try {
    const { slug } = req.params;

    const result = await query(`
      SELECT first_name, last_name, designation, email,
             phone_primary, phone_2, phone_3,
             photo_path
      FROM profiles
      WHERE slug = @slug AND is_active = 1
    `, { slug: { type: sql.Char, value: slug } });

    if (!result.recordset.length) {
      return res.status(404).json({ error: 'Profile not found' });
    }

    const p = result.recordset[0];
    const phones = [p.phone_primary, p.phone_2, p.phone_3].filter(Boolean);

    res.json({
      firstName:   p.first_name,
      lastName:    p.last_name,
      fullName:    `${p.first_name} ${p.last_name}`,
      designation: p.designation,
      email:       p.email,
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