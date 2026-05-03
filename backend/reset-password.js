'use strict';

// Run this from the backend/ folder:
//   node reset-password.js
// Delete this file after use.

require('dotenv').config();
const bcrypt          = require('bcryptjs');
const { query, sql }  = require('./db/pool');

async function resetPassword() {
  const username    = 'admin';          // change if needed
  const newPassword = 'YourNewPassword123!';   // change this

  if (newPassword.length < 10) {
    console.error('Password must be at least 10 characters');
    process.exit(1);
  }

  const hash = await bcrypt.hash(newPassword, 12);

  const result = await query(
    "UPDATE admins SET password_hash = 'StrongPassword123!' WHERE username = 'admin'",
    {
      hash:     { type: sql.NVarChar, value: hash },
      username: { type: sql.NVarChar, value: username },
    }
  );

  if (result.rowsAffected[0] === 0) {
    console.error('User not found:', username);
  } else {
    console.log('Password reset successfully for:', username);
  }

  process.exit(0);
}

resetPassword().catch(err => {
  console.error(err);
  process.exit(1);
});
