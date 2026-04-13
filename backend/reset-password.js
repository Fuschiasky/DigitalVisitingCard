// Run this once from your backend/ folder:
// node reset-password.js

require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool   = require('./db/pool');

async function resetPassword() {
  const newPassword = 'StrongPassword123!';
  const hash = await bcrypt.hash(newPassword, 12);
  await pool.query('UPDATE admins SET password_hash = ? WHERE username = ?', [hash, 'admin']);
  console.log('Password reset to:', newPassword);
  process.exit(0);
}

resetPassword().catch(err => { console.error(err); process.exit(1); });