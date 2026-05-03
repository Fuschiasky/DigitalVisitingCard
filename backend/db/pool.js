'use strict';

const sql = require('mssql');

const config = {
  server:   process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME || 'digitalcard',
  user:     process.env.DB_USER || 'digitalvisitingcard_admin',
  password: process.env.DB_PASSWORD || 'DiageoIndia',
  options: {
    encrypt:                false,
    trustServerCertificate: true,
    enableArithAbort:       true,
    connectTimeout:         15000,
    requestTimeout:         15000,
  },
  pool: {
    max:                 20,
    min:                 2,
    idleTimeoutMillis:   30000,
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

async function getPool() {
  await poolConnect;
  return pool;
}

async function query(text, params) {
  const p = await getPool();
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
