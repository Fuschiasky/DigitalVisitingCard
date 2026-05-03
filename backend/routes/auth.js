'use strict';

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const { query, sql } = require('../db/pool');
const {
  signAccess, signRefresh, storeRefreshToken,
  validateRefreshToken, revokeRefreshToken,
} = require('../middleware/auth');
const {
  adminLoginLimiter, loginValidationRules, validateRequest,
} = require('../middleware/security');

const BCRYPT_ROUNDS = 12;

// ─────────────────────────────────────────────
//  POST /api/auth/setup
// ─────────────────────────────────────────────
router.post('/setup', adminLoginLimiter, loginValidationRules, validateRequest, async (req, res) => {
  try {
    const countResult = await query('SELECT COUNT(*) AS count FROM admins');
    if (countResult.recordset[0].count > 0) {
      return res.status(403).json({ error: 'Setup already completed' });
    }

    const { username, password } = req.body;
    if (password.length < 10) {
      return res.status(400).json({ error: 'Password must be at least 10 characters' });
    }

    const hash   = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const result = await query(
      `INSERT INTO admins (username, password_hash)
       OUTPUT INSERTED.id
       VALUES (@username, @hash)`,
      {
        username: { type: sql.NVarChar, value: username },
        hash:     { type: sql.NVarChar, value: hash },
      }
    );

    const newId = result.recordset[0].id;

    await query(
      `INSERT INTO audit_log (admin_id, action, ip_address)
       VALUES (@adminId, 'ADMIN_CREATED', @ip)`,
      {
        adminId: { type: sql.Int,      value: newId },
        ip:      { type: sql.NVarChar, value: req.ip },
      }
    );

    res.status(201).json({ message: 'Admin account created. You can now log in.' });
  } catch (err) {
    console.error('[AUTH] Setup error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
//  POST /api/auth/login
// ─────────────────────────────────────────────
router.post('/login', adminLoginLimiter, loginValidationRules, validateRequest, async (req, res) => {
  try {
    const { username, password } = req.body;

    const result = await query(
      'SELECT id, username, password_hash FROM admins WHERE username = @username',
      { username: { type: sql.NVarChar, value: username } }
    );
    const rows = result.recordset;

    // Always run bcrypt to prevent timing attacks even if user not found
    const dummyHash = '$2b$12$invalidhashpaddingtomakethissafer000000000000000000000';
    const hash      = rows[0]?.password_hash || dummyHash;
    const match     = await bcrypt.compare(password, hash);

    if (!rows[0] || !match) {
      await query(
        `INSERT INTO audit_log (action, ip_address, detail)
         VALUES ('LOGIN_FAILED', @ip, @detail)`,
        {
          ip:     { type: sql.NVarChar, value: req.ip },
          detail: { type: sql.NVarChar, value: JSON.stringify({ username }) },
        }
      );
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const admin        = rows[0];
    const accessToken  = signAccess({ id: admin.id, username: admin.username });
    const refreshToken = signRefresh({ id: admin.id });
    await storeRefreshToken(admin.id, refreshToken);

    await query(
      'UPDATE admins SET last_login = GETUTCDATE() WHERE id = @id',
      { id: { type: sql.Int, value: admin.id } }
    );

    await query(
      `INSERT INTO audit_log (admin_id, action, ip_address)
       VALUES (@adminId, 'LOGIN_SUCCESS', @ip)`,
      {
        adminId: { type: sql.Int,      value: admin.id },
        ip:      { type: sql.NVarChar, value: req.ip },
      }
    );

    res.json({ accessToken, refreshToken, username: admin.username });
  } catch (err) {
    console.error('[AUTH] Login error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
//  POST /api/auth/refresh
// ─────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  try {
    const valid = await validateRefreshToken(refreshToken);
    if (!valid) return res.status(401).json({ error: 'Invalid or expired refresh token' });

    await revokeRefreshToken(valid.hash);

    const newAccess  = signAccess({ id: valid.adminId, username: valid.username });
    const newRefresh = signRefresh({ id: valid.adminId });
    await storeRefreshToken(valid.adminId, newRefresh);

    res.json({ accessToken: newAccess, refreshToken: newRefresh });
  } catch (err) {
    console.error('[AUTH] Refresh error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

// ─────────────────────────────────────────────
//  POST /api/auth/logout
// ─────────────────────────────────────────────
router.post('/logout', async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'Refresh token required' });

  try {
    const valid = await validateRefreshToken(refreshToken);
    if (valid) await revokeRefreshToken(valid.hash);
    res.json({ message: 'Logged out' });
  } catch (err) {
    console.error('[AUTH] Logout error:', err);
    res.status(500).json({ error: 'Server error' });
  }
});

module.exports = router;
