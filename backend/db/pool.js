'use strict';

const sql = require('mssql');

const config = {
  server:   process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME || 'digitalcard',
  user:     process.env.DB_USER || 'sa',
  password: process.env.DB_PASSWORD,

  options: {
    encrypt:                process.env.DB_ENCRYPT !== 'false',   // true for Azure, false for local
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true', // true for local dev self-signed cert
    enableArithAbort:       true,
    connectTimeout:         15000,
    requestTimeout:         15000,
  },

  pool: {
    max:                parseInt(process.env.DB_POOL_LIMIT || '20', 10),
    min:                2,
    idleTimeoutMillis:  30000,
    acquireTimeoutMillis: 15000,
  },
};

const pool = new sql.ConnectionPool(config);

const poolConnect = pool.connect()
  .then(() => {
    console.log('[DB] MS SQL Server pool connected');
  })
  .catch(err => {
    console.error('[DB] MS SQL connection failed:', err.message);
    process.exit(1);
  });

// Helper: returns a connected pool, waits if still connecting
async function getPool() {
  await poolConnect;
  return pool;
}

// Helper: run a parameterised query
// Usage: query('SELECT * FROM admins WHERE id = @id', { id: { type: sql.Int, value: 1 } })
async function query(text, params) {
  const p       = await getPool();
  const request = p.request();

  if (params) {
    for (const [key, val] of Object.entries(params)) {
      if (val && typeof val === 'object' && 'type' in val) {
        request.input(key, val.type, val.value);
      } else {
        request.input(key, val);
      }
    }
  }

  return request.query(text);
}

module.exports = { pool, getPool, query, sql };
