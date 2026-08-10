'use strict';

require('dotenv').config();

const express  = require('express');
const path     = require('path');
const cors     = require('cors');
const morgan   = require('morgan');
const fs       = require('fs');

const { helmetConfig, publicLimiter } = require('./middleware/security');
const { UPLOAD_DIR }                  = require('./middleware/upload');

const authRoute    = require('./routes/auth');
const adminRoute   = require('./routes/admin');
const profileRoute = require('./routes/profile');

const app  = express();
const PORT = process.env.PORT || 3000;

// ─────────────────────────────────────────────
//  Trust proxy — IIS sits in front of this app as a single reverse-proxy
//  hop, forwarding the real client IP via X-Forwarded-For. Setting this
//  to 1 tells Express to trust exactly that one hop when determining
//  req.ip (used by express-rate-limit for the login/API limiters).
//  If another proxy/load balancer is ever added in front of IIS, this
//  needs to become 2, or the limiter would trust an IP an attacker
//  could forge from outside.
// ─────────────────────────────────────────────
app.set('trust proxy', 1);

// ─────────────────────────────────────────────
//  Security headers
// ─────────────────────────────────────────────
app.use(helmetConfig);

// ─────────────────────────────────────────────
//  CORS — lock to your production domain
// ─────────────────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000')
  .split(',').map(o => o.trim());

app.use(cors({
  origin: (origin, cb) => {
    // Allow same-origin requests (no Origin header) and listed origins
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    cb(new Error('CORS policy violation'));
  },
  methods:     ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false,
  maxAge:      86400,
}));

// ─────────────────────────────────────────────
//  Request logging
// ─────────────────────────────────────────────
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ─────────────────────────────────────────────
//  Body parsing (small limits to prevent DoS)
// ─────────────────────────────────────────────
app.use(express.json({ limit: '50kb' }));
app.use(express.urlencoded({ extended: false, limit: '50kb' }));

// ─────────────────────────────────────────────
//  Static: uploaded photos
//  Served at /uploads/:filename — no directory listing
// ─────────────────────────────────────────────
app.use('/uploads', publicLimiter, (req, res, next) => {
  // Prevent path traversal
  const requested = path.resolve(UPLOAD_DIR, path.basename(req.path));
  if (!requested.startsWith(UPLOAD_DIR)) {
    return res.status(400).end();
  }
  next();
}, express.static(UPLOAD_DIR, {
  index:    false,
  dotfiles: 'deny',
  maxAge:   '7d',
  etag:     true,
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  },
}));

// ─────────────────────────────────────────────
//  API routes
// ─────────────────────────────────────────────
app.use('/api/auth',    authRoute);
app.use('/api/admin',  adminRoute);
app.use('/api/profile', profileRoute);

// ─────────────────────────────────────────────
//  Static JS for public profile page
// ─────────────────────────────────────────────
app.get('/profile.js', publicLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'public', 'profile.js'));
});

// ─────────────────────────────────────────────
//  Diageo India logo, shown above the public profile card
// ─────────────────────────────────────────────
app.get('/diageo-logo.png', publicLimiter, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'public', 'diageo-logo.png'));
});

// ─────────────────────────────────────────────
//  Brand logos for the two scrolling carousels on the public
//  profile page. Served at /brands/:filename — no directory listing.
//  Drop matching .jpg files into frontend/public/brands/ (filenames
//  referenced directly in profile.html, e.g. mcdowells.jpg).
// ─────────────────────────────────────────────
const BRANDS_DIR = path.join(__dirname, '..', 'frontend', 'public', 'brands');

app.use('/brands', publicLimiter, (req, res, next) => {
  const requested = path.resolve(BRANDS_DIR, path.basename(req.path));
  if (!requested.startsWith(BRANDS_DIR)) {
    return res.status(400).end();
  }
  next();
}, express.static(BRANDS_DIR, {
  index:    false,
  dotfiles: 'deny',
  maxAge:   '7d',
  etag:     true,
  setHeaders: (res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'public, max-age=604800, immutable');
  },
}));

// ─────────────────────────────────────────────
//  Profile page — serve HTML shell, JS fetches data
//  Matched: /p/<uuid>
// ─────────────────────────────────────────────
const UUID_RE = /^\/p\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

app.get(UUID_RE, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'public', 'profile.html'));
});

// ─────────────────────────────────────────────
//  Admin panel
// ─────────────────────────────────────────────
const adminPath = path.join(__dirname, '..', 'frontend', 'admin');

app.get('/admin', (req, res) => {
  res.sendFile(path.join(adminPath, 'index.html'));
});

app.get('/admin/', (req, res) => {
  res.sendFile(path.join(adminPath, 'index.html'));
});

app.use('/admin', express.static(adminPath, { dotfiles: 'deny' }));

// Serve admin.js explicitly at root level
app.get('/admin.js', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'frontend', 'admin', 'admin.js'));
});

// ─────────────────────────────────────────────
//  Root redirect
// ─────────────────────────────────────────────
app.get('/', (req, res) => res.redirect('/admin'));

// ─────────────────────────────────────────────
//  Health check (for load balancers / uptime monitors)
// ─────────────────────────────────────────────
app.get('/health', (req, res) => res.json({ status: 'ok', ts: Date.now() }));

// ─────────────────────────────────────────────
//  404 catch-all
// ─────────────────────────────────────────────
app.use((req, res) => res.status(404).json({ error: 'Not found' }));

// ─────────────────────────────────────────────
//  Global error handler
// ─────────────────────────────────────────────
app.use((err, req, res, _next) => {
  if (err.message === 'CORS policy violation') {
    return res.status(403).json({ error: 'CORS' });
  }
  console.error('[SERVER] Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ─────────────────────────────────────────────
//  Start
// ─────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`[SERVER] DigitalCard running on port ${PORT} (${process.env.NODE_ENV || 'development'})`);
});

module.exports = app;