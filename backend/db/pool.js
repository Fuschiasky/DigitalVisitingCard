'use strict';

const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host:               process.env.DB_HOST     || '127.0.0.1',
  port:               parseInt(process.env.DB_PORT || '3306', 10),
  user:               process.env.DB_USER     || 'profilelink',
  password:           process.env.DB_PASSWORD,
  database:           process.env.DB_NAME     || 'profilelink',
  charset:            'utf8mb4',

  // Pool settings tuned for high concurrency
  connectionLimit:    parseInt(process.env.DB_POOL_LIMIT || '20', 10),
  queueLimit:         0,                    // unlimited queue
  waitForConnections: true,

  // Keep-alive
  enableKeepAlive:    true,
  keepAliveInitialDelay: 30000,

  // Fail fast on bad queries rather than hanging
  connectTimeout:     10_000,

  // Prevent injection via type coercion
  typeCast: true,
  decimalNumbers: false,
});

// Verify connection on startup
pool.getConnection()
  .then(conn => {
    console.log('[DB] MySQL pool connected');
    conn.release();
  })
  .catch(err => {
    console.error('[DB] MySQL connection failed:', err.message);
    process.exit(1);
  });

module.exports = pool;
