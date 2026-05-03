'use strict';

require('dotenv').config();
const sql = require('mssql');
const os = require('os');

console.log('\n=== MS SQL Server Connection Diagnostic ===\n');

// Show system info
console.log('System Information:');
console.log('  Windows User:', os.userInfo().username);
console.log('  Hostname:', os.hostname());

// Show environment
console.log('\nEnvironment Variables:');
console.log('  DB_HOST:', process.env.DB_HOST || 'NOT SET');
console.log('  DB_PORT:', process.env.DB_PORT || 'NOT SET');
console.log('  DB_NAME:', process.env.DB_NAME || 'NOT SET');
console.log('  DB_ENCRYPT:', process.env.DB_ENCRYPT || 'NOT SET');
console.log('  DB_TRUST_CERT:', process.env.DB_TRUST_CERT || 'NOT SET');
console.log('  DB_USER:', process.env.DB_USER ? 'SET' : 'NOT SET');
console.log('  DB_PASSWORD:', process.env.DB_PASSWORD ? 'SET' : 'NOT SET');

// Build config
const config = {
  server:   process.env.DB_HOST || 'localhost',
  port:     parseInt(process.env.DB_PORT || '1433', 10),
  database: process.env.DB_NAME || 'digitalcard',
  options: {
    encrypt:                process.env.DB_ENCRYPT !== 'false',
    trustServerCertificate: process.env.DB_TRUST_CERT === 'true',
    enableArithAbort:       true,
    integratedSecurity:     true,
  },
};

console.log('\nConnection Config:');
console.log(JSON.stringify(config, null, 2));

// Try to connect
console.log('\nAttempting connection...\n');

const pool = new sql.ConnectionPool(config);

pool.connect((err) => {
  if (err) {
    console.error('❌ CONNECTION FAILED');
    console.error('Error Message:', err.message);
    console.error('Error Code:', err.code);
    console.error('Error Number:', err.number);
    console.error('Error State:', err.state);
    console.error('\nFull Error:', err);
    process.exit(1);
  } else {
    console.log('✅ CONNECTION SUCCESSFUL!\n');
    
    // Try a simple query
    const request = pool.request();
    request.query('SELECT @@VERSION AS version', (err, result) => {
      if (err) {
        console.error('❌ Query failed:', err.message);
      } else {
        console.log('SQL Server Version:', result.recordset[0].version);
      }
      
      pool.close();
      process.exit(0);
    });
  }
});

// Timeout after 30 seconds
setTimeout(() => {
  console.error('\n❌ Connection timeout (30 seconds) — server is not responding');
  process.exit(1);
}, 30000);