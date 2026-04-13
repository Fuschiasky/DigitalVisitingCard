'use strict';

const router  = require('express').Router();
const bcrypt  = require('bcryptjs');
const pool    = require('../db/pool');
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
//  One-time: create the first admin account.
//  Disabled once any admin exists.
// ─────────────────────────────────────────────
router.post('/setup', adminLoginLimiter, loginValidationRules, validateRequest, async (req, res) => {
  try {
    const [[{ count }]] = await pool.query('SELECT COUNT(*) AS count FROM admins');
    if (count > 0) {
      return res.status(403).json({ error: 'Setup already completed' });
    }

    const { username, password } = req.body;
    if (password.length < 10) {
      return res.status(400).json({ error: 'Password must be at least 10 characters' });
    }

    const hash = await bcrypt.hash(password, BCRYPT_ROUNDS);
    const [result] = await pool.query(
      'INSERT INTO admins (username, password_hash) VALUES (?, ?)',
      [username, hash]
    );

    await pool.query(
      `INSERT INTO audit_log (admin_id, action, ip_address) VALUES (?, 'ADMIN_CREATED', ?)`,
      [result.insertId, req.ip]
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

    const [rows] = await pool.query(
      'SELECT id, username, password_hash FROM admins WHERE username = ?',
      [username]
    );

    // Always run bcrypt to prevent timing attacks even if user not found
    const dummyHash = '$2b$12$invalidhashpaddingtomakethissafer000000000000000000000';
    const hash      = rows[0]?.password_hash || dummyHash;
    const match     = await bcrypt.compare(password, hash);

    if (!rows[0] || !match) {
      await pool.query(
        `INSERT INTO audit_log (action, ip_address, detail) VALUES ('LOGIN_FAILED', ?, ?)`,
        [req.ip, JSON.stringify({ username })]
      );
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const admin        = rows[0];
    const accessToken  = signAccess({ id: admin.id, username: admin.username });
    const refreshToken = signRefresh({ id: admin.id });
    await storeRefreshToken(admin.id, refreshToken);

    await pool.query('UPDATE admins SET last_login = NOW() WHERE id = ?', [admin.id]);
    await pool.query(
      `INSERT INTO audit_log (admin_id, action, ip_address) VALUES (?, 'LOGIN_SUCCESS', ?)`,
      [admin.id, req.ip]
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
    const record = await validateRefreshToken(refreshToken);
    if (!record) return res.status(401).json({ error: 'Invalid or expired refresh token' });

    // Rotate: revoke old, issue new pair
    await revokeRefreshToken(record.hash);
    const newAccess  = signAccess({ id: record.adminId, username: record.username });
    const newRefresh = signRefresh({ id: record.adminId });
    await storeRefreshToken(record.adminId, newRefresh);

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
  if (refreshToken) {
    const record = await validateRefreshToken(refreshToken).catch(() => null);
    if (record) await revokeRefreshToken(record.hash);
  }
  res.json({ message: 'Logged out' });
});

module.exports = router;
