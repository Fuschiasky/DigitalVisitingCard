'use strict';

const jwt    = require('jsonwebtoken');
const crypto = require('crypto');
const { query, sql } = require('../db/pool');

const ACCESS_SECRET  = process.env.JWT_ACCESS_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_TTL     = '15m';
const REFRESH_TTL    = '7d';

if (!ACCESS_SECRET || !REFRESH_SECRET) {
  console.error('[AUTH] JWT secrets not set in environment. Refusing to start.');
  process.exit(1);
}

// ─────────────────────────────────────────────
//  Token generation
// ─────────────────────────────────────────────
function signAccess(payload) {
  return jwt.sign(payload, ACCESS_SECRET, { expiresIn: ACCESS_TTL, algorithm: 'HS256' });
}

function signRefresh(payload) {
  return jwt.sign(payload, REFRESH_SECRET, { expiresIn: REFRESH_TTL, algorithm: 'HS256' });
}

// ─────────────────────────────────────────────
//  Store refresh token hash in DB
// ─────────────────────────────────────────────
async function storeRefreshToken(adminId, token) {
  const hash    = crypto.createHash('sha256').update(token).digest('hex');
  const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  // Prune old tokens for this admin (keep last 4)
  await query(`
    DELETE FROM refresh_tokens
    WHERE admin_id = @adminId
      AND id NOT IN (
        SELECT TOP 4 id
        FROM refresh_tokens
        WHERE admin_id = @adminId2
        ORDER BY created_at DESC
      )
  `, {
    adminId:  { type: sql.Int, value: adminId },
    adminId2: { type: sql.Int, value: adminId },
  });

  await query(
    `INSERT INTO refresh_tokens (admin_id, token_hash, expires_at)
     VALUES (@adminId, @hash, @expires)`,
    {
      adminId:  { type: sql.Int,       value: adminId },
      hash:     { type: sql.NVarChar,  value: hash },
      expires:  { type: sql.DateTime2, value: expires },
    }
  );

  return hash;
}

// ─────────────────────────────────────────────
//  Middleware: require valid access token
// ─────────────────────────────────────────────
function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorised' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, ACCESS_SECRET, { algorithms: ['HS256'] });
    req.admin     = payload;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// ─────────────────────────────────────────────
//  Validate refresh token from DB
// ─────────────────────────────────────────────
async function validateRefreshToken(token) {
  const hash   = crypto.createHash('sha256').update(token).digest('hex');
  const result = await query(`
    SELECT rt.admin_id, a.username
    FROM refresh_tokens rt
    JOIN admins a ON a.id = rt.admin_id
    WHERE rt.token_hash = @hash
      AND rt.expires_at > GETUTCDATE()
  `, { hash: { type: sql.NVarChar, value: hash } });

  const rows = result.recordset;
  if (!rows.length) return null;
  return { adminId: rows[0].admin_id, username: rows[0].username, hash };
}

async function revokeRefreshToken(hash) {
  await query(
    'DELETE FROM refresh_tokens WHERE token_hash = @hash',
    { hash: { type: sql.NVarChar, value: hash } }
  );
}

module.exports = {
  signAccess,
  signRefresh,
  storeRefreshToken,
  requireAuth,
  validateRefreshToken,
  revokeRefreshToken,
};
