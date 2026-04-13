'use strict';

var slug = location.pathname.split('/').filter(Boolean)[1] || '';

if (!slug) {
  renderError('not-found');
} else {
  fetch('/api/profile/' + encodeURIComponent(slug), {
    method: 'GET',
    headers: { 'Accept': 'application/json' },
    credentials: 'omit',
  })
  .then(function(res) {
    if (res.status === 404) throw new Error('not-found');
    if (!res.ok) throw new Error('server-error');
    return res.json();
  })
  .then(renderProfile)
  .catch(function(err) {
    renderError(err.message === 'not-found' ? 'not-found' : 'server-error');
  });
}

function esc(s) {
  return String(s || '').slice(0, 300)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderProfile(data) {
  var phones = Array.isArray(data.phones) ? data.phones.slice(0, 3) : [];
  var labels = ['Primary', 'Office', 'Other'];

  document.title = esc(data.fullName) + ' — Profile';

  var app = document.getElementById('app');

  /* Build card */
  var card = document.createElement('main');
  card.className = 'card';
  card.setAttribute('role', 'main');

  /* Avatar */
  var avatarWrap  = document.createElement('div');
  avatarWrap.className = 'avatar-wrap';
  avatarWrap.setAttribute('aria-label', 'Profile photo');

  var avatarInner = document.createElement('div');
  avatarInner.className = 'avatar-inner';

  if (data.photoUrl) {
    var img = document.createElement('img');
    img.className = 'avatar-img';
    img.src = data.photoUrl;
    img.alt = esc(data.fullName) + ' photo';
    img.loading = 'eager';

    var fallback = document.createElement('span');
    fallback.className = 'avatar-initials';
    fallback.textContent = data.initials || '';
    fallback.style.display = 'none';

    img.addEventListener('error', function() {
      img.style.display = 'none';
      fallback.style.display = 'flex';
    });

    avatarInner.appendChild(img);
    avatarInner.appendChild(fallback);
  } else {
    var initSpan = document.createElement('span');
    initSpan.className = 'avatar-initials';
    initSpan.textContent = data.initials || '';
    avatarInner.appendChild(initSpan);
  }

  avatarWrap.appendChild(avatarInner);
  card.appendChild(avatarWrap);

  /* Name */
  var nameEl = document.createElement('h1');
  nameEl.className = 'name';
  nameEl.textContent = data.fullName || '';
  card.appendChild(nameEl);

  /* Designation */
  var desgEl = document.createElement('p');
  desgEl.className = 'designation';
  desgEl.textContent = data.designation || '';
  card.appendChild(desgEl);

  /* Divider */
  var divider = document.createElement('div');
  divider.className = 'divider';
  divider.setAttribute('aria-hidden', 'true');
  card.appendChild(divider);

  /* Phone list */
  var ul = document.createElement('ul');
  ul.className = 'phones';
  ul.setAttribute('aria-label', 'Contact numbers');

  phones.forEach(function(ph, i) {
    var li = document.createElement('li');
    var a  = document.createElement('a');
    a.className = 'phone-item';
    a.href = 'tel:' + ph.replace(/\s/g, '');
    a.setAttribute('aria-label', (labels[i] || 'Phone') + ' number: ' + ph);

    /* Phone icon */
    var iconWrap = document.createElement('span');
    iconWrap.className = 'phone-icon';
    iconWrap.setAttribute('aria-hidden', 'true');
    iconWrap.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>';

    /* Label + number */
    var textWrap  = document.createElement('span');
    var labelEl   = document.createElement('div');
    labelEl.className   = 'phone-label';
    labelEl.textContent = labels[i] || 'Phone';
    var numEl     = document.createElement('div');
    numEl.className   = 'phone-number';
    numEl.textContent = ph;

    textWrap.appendChild(labelEl);
    textWrap.appendChild(numEl);
    a.appendChild(iconWrap);
    a.appendChild(textWrap);
    li.appendChild(a);
    ul.appendChild(li);
  });

  card.appendChild(ul);

  /* Footer */
  var footer = document.createElement('p');
  footer.className = 'card-footer';
  footer.setAttribute('aria-hidden', 'true');
  footer.textContent = 'Tap a number to call';
  card.appendChild(footer);

  app.innerHTML = '';
  app.appendChild(card);
}

function renderError(type) {
  var isNotFound = type === 'not-found';
  var app = document.getElementById('app');

  var wrap  = document.createElement('div');
  wrap.className = 'state-card';
  wrap.setAttribute('role', 'alert');

  var icon  = document.createElement('span');
  icon.style.fontSize   = '48px';
  icon.style.marginBottom = '16px';
  icon.style.display    = 'block';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = isNotFound ? '🔍' : '⚠️';

  var title = document.createElement('div');
  title.className   = 'state-title';
  title.textContent = isNotFound ? 'Profile not found' : 'Something went wrong';

  var msg   = document.createElement('p');
  msg.textContent = isNotFound
    ? 'This profile link may be invalid or inactive.'
    : 'Please try again in a moment.';

  wrap.appendChild(icon);
  wrap.appendChild(title);
  wrap.appendChild(msg);
  app.innerHTML = '';
  app.appendChild(wrap);
}
