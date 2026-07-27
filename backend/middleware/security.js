'use strict';

const helmet       = require('helmet');
const rateLimit    = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const validator = require('validator');

// ─────────────────────────────────────────────
//  Helmet — security headers
// ─────────────────────────────────────────────
const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc:     ["'self'"],
      scriptSrc:      ["'self'"],
      styleSrc:       ["'self'", "'unsafe-inline'"],   // allow inline styles for avatar colour
      imgSrc:         ["'self'", 'data:'],
      connectSrc:     ["'self'"],
      fontSrc:        ["'self'", 'https://fonts.gstatic.com'],
      objectSrc:      ["'none'"],
      frameAncestors: ["'none'"],
      baseUri:        ["'self'"],
      formAction:     ["'self'"],
    },
  },
  hsts: {
    maxAge:            31_536_000,   // 1 year
    includeSubDomains: true,
    preload:           true,
  },
  referrerPolicy:        { policy: 'strict-origin-when-cross-origin' },
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  crossOriginEmbedderPolicy: false,   // allow images to load from same origin
});

// ─────────────────────────────────────────────
//  Rate limiters
// ─────────────────────────────────────────────
const publicLimiter = rateLimit({
  windowMs:         60 * 1000,   // 1 minute
  max:              120,          // generous for QR scans
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many requests, slow down.' },
  skip: (req) => req.method === 'OPTIONS',
});

const adminLoginLimiter = rateLimit({
  windowMs:         15 * 60 * 1000,   // 15 minutes
  max:              10,                // 10 login attempts per 15 min per IP
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many login attempts. Wait 15 minutes.' },
});

const adminApiLimiter = rateLimit({
  windowMs:         60 * 1000,
  max:              60,
  standardHeaders:  true,
  legacyHeaders:    false,
  message:          { error: 'Too many requests.' },
});

// ─────────────────────────────────────────────
//  Input sanitisation helpers
// ─────────────────────────────────────────────
function stripHtml(str) {
  if (typeof str !== 'string') return str;
  // Remove all HTML tags and null bytes
  return str.replace(/<[^>]*>/g, '').replace(/\0/g, '').trim();
}

function sanitiseProfile(req, res, next) {
  const fields = ['first_name', 'last_name', 'designation', 'email', 'phone_primary', 'phone_2', 'phone_3'];
  for (const f of fields) {
    if (req.body[f] !== undefined) {
      req.body[f] = stripHtml(req.body[f]);
    }
  }
  next();
}

// ─────────────────────────────────────────────
//  express-validator rules
// ─────────────────────────────────────────────
const PHONE_RE = /^\+?[\d\s\-().]{7,20}$/;

const profileValidationRules = [
  body('first_name')
    .trim().notEmpty().withMessage('First name is required')
    .isLength({ max: 100 }).withMessage('First name too long'),
  body('last_name')
    .trim().notEmpty().withMessage('Last name is required')
    .isLength({ max: 100 }).withMessage('Last name too long'),
  body('designation')
    .trim().notEmpty().withMessage('Designation is required')
    .isLength({ max: 200 }).withMessage('Designation too long'),
  body('email')
    .trim().notEmpty().withMessage('Email is required')
    .isEmail().withMessage('Invalid email address')
    .isLength({ max: 255 }).withMessage('Email too long'),
  body('phone_primary')
    .trim().notEmpty().withMessage('Primary phone is required')
    .matches(PHONE_RE).withMessage('Invalid primary phone number'),
  body('phone_2')
    .optional({ nullable: true, checkFalsy: true })
    .trim().matches(PHONE_RE).withMessage('Invalid phone 2'),
  body('phone_3')
    .optional({ nullable: true, checkFalsy: true })
    .trim().matches(PHONE_RE).withMessage('Invalid phone 3'),
];

const loginValidationRules = [
  body('username').trim().notEmpty().isLength({ max: 64 }).escape(),
  body('password').notEmpty().isLength({ max: 128 }),
];

function validateRequest(req, res, next) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array().map(e => e.msg) });
  }
  next();
}

// ─────────────────────────────────────────────
//  UUID validator for route params
// ─────────────────────────────────────────────
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireValidSlug(req, res, next) {
  if (!UUID_RE.test(req.params.slug)) {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}

// ─────────────────────────────────────────────
//  Plain-object row validator, shared by bulk upload.
//  Mirrors profileValidationRules exactly (same field names,
//  same PHONE_RE, same length limits) so a row that would be
//  accepted via the single-create form is accepted here too,
//  and vice versa — one set of rules, not two that can drift.
// ─────────────────────────────────────────────
function validateProfileRow(row) {
  const errors = [];
  const clean = {};

  const first_name = stripHtml(row.first_name || '').trim();
  if (!first_name) errors.push('First name is required');
  else if (first_name.length > 100) errors.push('First name too long');
  clean.first_name = first_name;

  const last_name = stripHtml(row.last_name || '').trim();
  if (!last_name) errors.push('Last name is required');
  else if (last_name.length > 100) errors.push('Last name too long');
  clean.last_name = last_name;

  const designation = stripHtml(row.designation || '').trim();
  if (!designation) errors.push('Designation is required');
  else if (designation.length > 200) errors.push('Designation too long');
  clean.designation = designation;

  const email = stripHtml(row.email || '').trim();
  if (!email) errors.push('Email is required');
  else if (!validator.isEmail(email)) errors.push('Invalid email address');
  else if (email.length > 255) errors.push('Email too long');
  clean.email = email;

  const phone_primary = stripHtml(row.phone_primary || '').trim();
  if (!phone_primary) errors.push('Primary phone is required');
  else if (!PHONE_RE.test(phone_primary)) errors.push('Invalid primary phone number');
  clean.phone_primary = phone_primary;

  const phone_2 = stripHtml(row.phone_2 || '').trim();
  if (phone_2 && !PHONE_RE.test(phone_2)) errors.push('Invalid phone 2');
  clean.phone_2 = phone_2 || null;

  const phone_3 = stripHtml(row.phone_3 || '').trim();
  if (phone_3 && !PHONE_RE.test(phone_3)) errors.push('Invalid phone 3');
  clean.phone_3 = phone_3 || null;

  return { valid: errors.length === 0, errors, clean };
}

module.exports = {
  helmetConfig,
  publicLimiter,
  adminLoginLimiter,
  adminApiLimiter,
  sanitiseProfile,
  profileValidationRules,
  loginValidationRules,
  validateRequest,
  requireValidSlug,
  validateProfileRow,
};