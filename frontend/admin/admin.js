'use strict';

/* ── State ── */
var accessToken  = '';
var refreshToken = '';
var editingSlug  = null;
var deletingSlug = null;

/* ── DOM helpers ── */
function $(id) { return document.getElementById(id); }

function esc(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function showErr(id, msg) {
  var el = $(id);
  el.textContent = msg;
  el.style.display = 'block';
}

function hideMsg(id) {
  var el = $(id);
  if (el) el.style.display = 'none';
}

function showToast(msg, type) {
  var t = $('toast');
  t.textContent = msg;
  t.className = 'toast toast-' + (type || 'ok') + ' show';
  setTimeout(function() { t.className = 'toast'; }, 3000);
}

/* ── API wrapper with auto token refresh ── */
function api(method, path, body, isJson) {
  if (isJson === undefined) isJson = true;

  var opts = {
    method: method,
    headers: { 'Authorization': 'Bearer ' + accessToken },
    credentials: 'omit',
  };

  if (body && isJson) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  } else if (body) {
    opts.body = body;
  }

  return fetch(path, opts).then(function(res) {
    if (res.status === 401 && refreshToken) {
      return fetch('/api/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: refreshToken }),
      }).then(function(r) {
        if (r.ok) {
          return r.json().then(function(d) {
            accessToken  = d.accessToken;
            refreshToken = d.refreshToken;
            opts.headers['Authorization'] = 'Bearer ' + accessToken;
            return fetch(path, opts);
          });
        } else {
          logout();
          return null;
        }
      });
    }
    return res;
  });
}

/* ── Login ── */
function doLogin() {
  var btn  = $('login-btn');
  var user = $('l-user').value.trim();
  var pass = $('l-pass').value;

  hideMsg('login-err');

  if (!user || !pass) {
    showErr('login-err', 'Please enter username and password.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Signing in…';

  fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: user, password: pass }),
    credentials: 'omit',
  })
  .then(function(res) {
    return res.json().then(function(data) {
      return { ok: res.ok, data: data };
    });
  })
  .then(function(result) {
    if (!result.ok) {
      showErr('login-err', result.data.error || 'Login failed');
      return;
    }
    accessToken  = result.data.accessToken;
    refreshToken = result.data.refreshToken;
    $('login-screen').style.display = 'none';
    $('app').style.display = 'flex';
    $('topbar-user').textContent = result.data.username;
    loadProfiles();
  })
  .catch(function() {
    showErr('login-err', 'Network error. Is the server running?');
  })
  .finally(function() {
    btn.disabled = false;
    btn.textContent = 'Sign In';
  });
}

/* ── Logout ── */
function logout() {
  if (refreshToken) {
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: refreshToken }),
      credentials: 'omit',
    }).catch(function() {});
  }
  accessToken = '';
  refreshToken = '';
  $('app').style.display = 'none';
  $('login-screen').style.display = 'flex';
  $('l-pass').value = '';
}

/* ── Load and render profile list ── */
function loadProfiles() {
  api('GET', '/api/admin/profiles')
  .then(function(res) {
    if (!res) return;
    return res.json().then(function(data) {
      if (!res.ok) { showErr('err-banner', data.error); return; }
      renderTable(data.profiles);
    });
  })
  .catch(function() {
    showErr('err-banner', 'Failed to load profiles.');
  });
}

function renderTable(profiles) {
  var tbody = $('profile-list');
  var empty = $('empty-state');

  if (!profiles || !profiles.length) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  var origin = location.origin;
  var rows = '';

  for (var i = 0; i < profiles.length; i++) {
    var p        = profiles[i];
    var profileUrl = origin + '/p/' + p.slug;
    var shortUrl   = '/p/' + p.slug.slice(0, 8) + '…';

    var addressPreview = p.address ? p.address.replace(/\s*\n\s*/g, ', ') : '';
    if (addressPreview.length > 40) addressPreview = addressPreview.slice(0, 40) + '…';

    rows += '<tr data-slug="' + esc(p.slug) + '">'
      + '<td><strong>' + esc(p.first_name) + ' ' + esc(p.last_name) + '</strong></td>'
      + '<td style="color:var(--text-dim)">' + esc(p.designation) + '</td>'
      + '<td>' + esc(p.email) + '</td>'
      + '<td style="color:var(--text-dim)" title="' + esc(p.address || '') + '">' + (addressPreview ? esc(addressPreview) : '—') + '</td>'
      + '<td>' + (p.phone_primary ? esc(p.phone_primary) : '—') + '</td>'
      + '<td><span class="badge ' + (p.is_active ? 'badge-active' : 'badge-inactive') + '">'
      +   (p.is_active ? 'Active' : 'Inactive') + '</span></td>'
      + '<td><span class="url-chip" data-url="' + esc(profileUrl) + '" title="' + esc(profileUrl) + '">&#128203; ' + esc(shortUrl) + '</span></td>'
      + '<td><div class="actions">'
      +   '<button class="btn btn-ghost btn-sm edit-btn" data-slug="' + esc(p.slug) + '">Edit</button>'
      +   '<button class="btn btn-danger btn-sm delete-btn" data-slug="' + esc(p.slug) + '">Delete</button>'
      + '</div></td>'
      + '</tr>';
  }

  tbody.innerHTML = rows;

  /* Attach edit / delete / copy via event delegation */
  tbody.querySelectorAll('.edit-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { openModal(this.dataset.slug); });
  });
  tbody.querySelectorAll('.delete-btn').forEach(function(btn) {
    btn.addEventListener('click', function() { openDeleteModal(this.dataset.slug); });
  });
  tbody.querySelectorAll('.url-chip').forEach(function(chip) {
    chip.addEventListener('click', function() {
      navigator.clipboard.writeText(this.dataset.url)
        .then(function() { showToast('URL copied!'); })
        .catch(function() { showToast('Could not copy', 'err'); });
    });
  });
}

/* ── Create / Edit modal ── */
function openModal(slug) {
  editingSlug = slug || null;
  hideMsg('modal-err');
  hideMsg('modal-ok');
  $('modal-title').textContent = slug ? 'Edit Profile' : 'New Profile';
  clearForm();

  if (slug) {
    api('GET', '/api/admin/profiles')
    .then(function(res) {
      if (!res) return;
      return res.json().then(function(d) {
        var p = (d.profiles || []).find(function(x) { return x.slug === slug; });
        if (p) {
          $('m-fname').value = p.first_name    || '';
          $('m-lname').value = p.last_name     || '';
          $('m-desg').value  = p.designation   || '';
          $('m-email').value = p.email         || '';
          $('m-address').value = p.address     || '';
          $('m-ph1').value   = p.phone_primary || '';
          $('m-ph2').value   = p.phone_2       || '';
          $('m-ph3').value   = p.phone_3       || '';
        }
      });
    });
  }

  $('profile-modal').classList.add('open');
  setTimeout(function() { $('m-fname').focus(); }, 100);
}

function closeModal() {
  $('profile-modal').classList.remove('open');
  editingSlug = null;
}

function clearForm() {
  ['m-fname','m-lname','m-desg','m-email','m-address','m-ph1','m-ph2','m-ph3'].forEach(function(id) {
    $(id).value = '';
  });
}

function saveProfile() {
  hideMsg('modal-err');
  hideMsg('modal-ok');

  var btn = $('modal-save');
  var payload = {
    first_name:    $('m-fname').value.trim(),
    last_name:     $('m-lname').value.trim(),
    designation:   $('m-desg').value.trim(),
    email:         $('m-email').value.trim(),
    address:       $('m-address').value.trim() || null,
    phone_primary: $('m-ph1').value.trim(),
    phone_2:       $('m-ph2').value.trim() || null,
    phone_3:       $('m-ph3').value.trim() || null,
  };

  if (!payload.first_name || !payload.last_name || !payload.designation || !payload.email || !payload.address) {
    showErr('modal-err', 'Please fill in all required fields (*).');
    return;
  }

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payload.email)) {
    showErr('modal-err', 'Please enter a valid email address.');
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Saving…';

  var method     = editingSlug ? 'PUT'  : 'POST';
  var apiPath    = editingSlug ? '/api/admin/profiles/' + editingSlug : '/api/admin/profiles';
  var savedSlug  = editingSlug;

  api(method, apiPath, payload)
  .then(function(res) {
    if (!res) return;
    return res.json().then(function(data) {
      if (!res.ok) {
        showErr('modal-err', (data.errors || [data.error]).join(', '));
        return;
      }

      savedSlug = savedSlug || (data.profile && data.profile.slug);
    });
  })
  .then(function() {
    showToast(editingSlug ? 'Profile updated ✓' : 'Profile created ✓');
    loadProfiles();
    if (editingSlug) {
      closeModal();
    } else {
      var okEl = $('modal-ok');
      okEl.textContent = 'Profile created! Copy the URL from the table for your QR code.';
      okEl.style.display = 'block';
    }
  })
  .catch(function() {
    showErr('modal-err', 'Network error. Please try again.');
  })
  .finally(function() {
    btn.disabled = false;
    btn.textContent = 'Save Profile';
  });
}

/* ── Delete modal ── */
function openDeleteModal(slug) {
  deletingSlug = slug;
  $('delete-modal').classList.add('open');
}

function doDelete() {
  if (!deletingSlug) return;
  var btn = $('del-confirm');
  btn.disabled = true;
  btn.textContent = 'Deleting…';

  api('DELETE', '/api/admin/profiles/' + deletingSlug)
  .then(function(res) {
    if (res && res.ok) {
      showToast('Profile deleted');
      $('delete-modal').classList.remove('open');
      deletingSlug = null;
      loadProfiles();
    } else {
      showToast('Delete failed', 'err');
    }
  })
  .catch(function() { showToast('Network error', 'err'); })
  .finally(function() {
    btn.disabled = false;
    btn.textContent = 'Delete';
  });
}

/* ── Bulk upload ── */
function openBulkModal() {
  hideMsg('bulk-err');
  $('bulk-input').value = '';
  $('bulk-zone').className = 'photo-zone';
  $('bulk-zone-text').textContent = 'Click to choose a CSV file';
  var results = $('bulk-results');
  results.style.display = 'none';
  results.innerHTML = '';
  $('bulk-modal').classList.add('open');
}

function closeBulkModal() {
  $('bulk-modal').classList.remove('open');
}

function handleBulkFile(file) {
  if (!/\.csv$/i.test(file.name)) {
    showErr('bulk-err', 'Please choose a .csv file.');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    showErr('bulk-err', 'CSV must be smaller than 2 MB.');
    return;
  }
  hideMsg('bulk-err');
  $('bulk-zone').className = 'photo-zone has-file';
  $('bulk-zone-text').textContent = '✓ ' + file.name;
  var dt = new DataTransfer();
  dt.items.add(file);
  $('bulk-input').files = dt.files;
}

function renderBulkResults(data) {
  var results = $('bulk-results');
  var html = '<div style="margin-bottom:8px;font-weight:500">'
    + esc(data.message) + '</div>';

  if (data.created && data.created.length) {
    html += '<div style="color:var(--success);margin-bottom:8px">Created:</div><ul style="margin:0 0 12px 18px;padding:0">';
    data.created.forEach(function(c) {
      html += '<li>Row ' + esc(c.row) + ': ' + esc(c.name) + '</li>';
    });
    html += '</ul>';
  }

  if (data.failed && data.failed.length) {
    html += '<div style="color:var(--danger);margin-bottom:8px">Failed:</div><ul style="margin:0 0 0 18px;padding:0">';
    data.failed.forEach(function(f) {
      html += '<li>Row ' + esc(f.row) + ': ' + esc(f.errors.join(', ')) + '</li>';
    });
    html += '</ul>';
  }

  results.innerHTML = html;
  results.style.display = 'block';
}

function doBulkUpload() {
  hideMsg('bulk-err');
  var file = $('bulk-input').files[0];
  if (!file) {
    showErr('bulk-err', 'Please choose a CSV file first.');
    return;
  }

  var btn = $('bulk-submit');
  btn.disabled = true;
  btn.textContent = 'Uploading…';

  var fd = new FormData();
  fd.append('file', file);

  api('POST', '/api/admin/profiles/bulk', fd, false)
  .then(function(res) {
    if (!res) return;
    return res.json().then(function(data) {
      if (!res.ok && !(data.created && data.created.length)) {
        showErr('bulk-err', data.error || 'Upload failed');
        return;
      }
      renderBulkResults(data);
      if (data.created && data.created.length) {
        showToast(data.created.length + ' profile(s) created ✓');
        loadProfiles();
      }
    });
  })
  .catch(function() {
    showErr('bulk-err', 'Network error. Please try again.');
  })
  .finally(function() {
    btn.disabled = false;
    btn.textContent = 'Upload';
  });
}

/* ── Wire up all event listeners once DOM is ready ── */
document.addEventListener('DOMContentLoaded', function() {

  $('login-btn').addEventListener('click', doLogin);
  $('l-pass').addEventListener('keydown', function(e) {
    if (e.key === 'Enter') doLogin();
  });

  $('logout-btn').addEventListener('click', logout);
  $('new-profile-btn').addEventListener('click', function() { openModal(null); });
  $('bulk-upload-btn').addEventListener('click', openBulkModal);

  $('modal-cancel').addEventListener('click', closeModal);
  $('profile-modal').addEventListener('click', function(e) {
    if (e.target === $('profile-modal')) closeModal();
  });
  $('modal-save').addEventListener('click', saveProfile);

  $('del-cancel').addEventListener('click', function() {
    deletingSlug = null;
    $('delete-modal').classList.remove('open');
  });
  $('del-confirm').addEventListener('click', doDelete);

  $('bulk-cancel').addEventListener('click', closeBulkModal);
  $('bulk-modal').addEventListener('click', function(e) {
    if (e.target === $('bulk-modal')) closeBulkModal();
  });
  $('bulk-submit').addEventListener('click', doBulkUpload);

  var bulkZone  = $('bulk-zone');
  var bulkInput = $('bulk-input');

  bulkZone.addEventListener('click', function() { bulkInput.click(); });
  bulkZone.addEventListener('keydown', function(e) {
    if (e.key === 'Enter' || e.key === ' ') bulkInput.click();
  });
  bulkZone.addEventListener('dragover', function(e) {
    e.preventDefault();
    bulkZone.style.borderColor = 'var(--gold)';
  });
  bulkZone.addEventListener('dragleave', function() {
    bulkZone.style.borderColor = '';
  });
  bulkZone.addEventListener('drop', function(e) {
    e.preventDefault();
    bulkZone.style.borderColor = '';
    if (e.dataTransfer.files[0]) handleBulkFile(e.dataTransfer.files[0]);
  });
  bulkInput.addEventListener('change', function() {
    if (bulkInput.files[0]) handleBulkFile(bulkInput.files[0]);
  });

});