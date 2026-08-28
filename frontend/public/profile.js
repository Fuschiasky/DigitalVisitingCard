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

/* ── vCard export ──
   Runs entirely client-side from data already fetched to render the
   page, so tapping "Save contact" needs no additional network request
   and works even if the phone has no signal at that moment — the only
   time connectivity is required is loading the profile page itself. */
function vcardEscape(s) {
  return String(s || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n');
}

function buildVcard(data) {
  var phones = Array.isArray(data.phones) ? data.phones.slice(0, 3) : [];
  var phoneTypes = ['CELL', 'WORK', 'HOME'];
  var lines = [];

  lines.push('BEGIN:VCARD');
  lines.push('VERSION:3.0');
  lines.push('FN:' + vcardEscape(data.fullName));
  /* No first/last name split is available (or wanted) here — the
     structured N field is required by the vCard spec for a contact
     to import cleanly on some clients, so it carries the full name
     as a single component rather than being split. */
  lines.push('N:' + vcardEscape(data.fullName) + ';;;;');
  if (data.designation) lines.push('TITLE:' + vcardEscape(data.designation));
  lines.push('ORG:Diageo India');

  phones.forEach(function(ph, i) {
    lines.push('TEL;TYPE=' + (phoneTypes[i] || 'VOICE') + ':' + vcardEscape(ph));
  });

  if (data.email) lines.push('EMAIL:' + vcardEscape(data.email));
  if (data.address) lines.push('ADR;TYPE=WORK:;;' + vcardEscape(data.address) + ';;;;');

  lines.push('END:VCARD');
  /* vCard requires CRLF line endings, not bare \n. */
  return lines.join('\r\n') + '\r\n';
}

function downloadVcard(data) {
  var vcardText = buildVcard(data);
  var blob = new Blob([vcardText], { type: 'text/vcard;charset=utf-8' });
  var url  = URL.createObjectURL(blob);

  var safeName = String(data.fullName || 'contact').replace(/[^\w\- ]+/g, '').trim() || 'contact';
  var filename = safeName.replace(/\s+/g, '-') + '.vcf';

  var link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  /* Release the blob URL shortly after triggering the download —
     immediate revocation can race with the browser actually starting
     the download on some platforms, so this gives it a moment. */
  setTimeout(function() { URL.revokeObjectURL(url); }, 1000);
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

  /* Email item — same list, own row, mailto: link */
  if (data.email) {
    var emailLi = document.createElement('li');
    var emailA  = document.createElement('a');
    emailA.className = 'phone-item';
    emailA.href = 'mailto:' + data.email;
    emailA.setAttribute('aria-label', 'Email: ' + data.email);

    var emailIconWrap = document.createElement('span');
    emailIconWrap.className = 'phone-icon';
    emailIconWrap.setAttribute('aria-hidden', 'true');
    emailIconWrap.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"/><path d="M22 6l-10 7L2 6"/></svg>';

    var emailTextWrap = document.createElement('span');
    var emailLabelEl   = document.createElement('div');
    emailLabelEl.className   = 'phone-label';
    emailLabelEl.textContent = 'Email';
    var emailValEl     = document.createElement('div');
    emailValEl.className   = 'phone-number';
    emailValEl.textContent = data.email;

    emailTextWrap.appendChild(emailLabelEl);
    emailTextWrap.appendChild(emailValEl);
    emailA.appendChild(emailIconWrap);
    emailA.appendChild(emailTextWrap);
    emailLi.appendChild(emailA);
    ul.appendChild(emailLi);
  }

  /* Address item — same list, own row, but plain (non-interactive):
     no href, no tap action. Multi-line text is preserved via CSS
     white-space handling on .address-text rather than building
     separate line elements. */
  if (data.address) {
    var addressLi = document.createElement('li');
    var addressDiv = document.createElement('div');
    addressDiv.className = 'phone-item address-item';

    var addressIconWrap = document.createElement('span');
    addressIconWrap.className = 'phone-icon';
    addressIconWrap.setAttribute('aria-hidden', 'true');
    addressIconWrap.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>';

    var addressTextWrap = document.createElement('span');
    var addressLabelEl  = document.createElement('div');
    addressLabelEl.className   = 'phone-label';
    addressLabelEl.textContent = 'Address';
    var addressValEl    = document.createElement('div');
    addressValEl.className   = 'phone-number address-text';
    addressValEl.textContent = data.address;

    addressTextWrap.appendChild(addressLabelEl);
    addressTextWrap.appendChild(addressValEl);
    addressDiv.appendChild(addressIconWrap);
    addressDiv.appendChild(addressTextWrap);
    addressLi.appendChild(addressDiv);
    ul.appendChild(addressLi);
  }

  card.appendChild(ul);

  /* Footer */
  var footer = document.createElement('p');
  footer.className = 'card-footer';
  footer.setAttribute('aria-hidden', 'true');
  footer.textContent = 'Tap to call or email';
  card.appendChild(footer);

  /* Save contact — builds and downloads a vCard entirely client-side
     from the data already in memory, so it works without a fresh
     network request even if connectivity is lost after the page loaded. */
  var saveBtn = document.createElement('button');
  saveBtn.type = 'button';
  saveBtn.className = 'save-contact-btn';
  saveBtn.setAttribute('aria-label', 'Save ' + (data.fullName || 'contact') + ' to your contacts');

  var saveBtnIcon = document.createElement('span');
  saveBtnIcon.setAttribute('aria-hidden', 'true');
  saveBtnIcon.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/></svg>';

  var saveBtnLabel = document.createElement('span');
  saveBtnLabel.textContent = 'Save contact (.vcf)';

  saveBtn.appendChild(saveBtnIcon);
  saveBtn.appendChild(saveBtnLabel);
  saveBtn.addEventListener('click', function() {
    downloadVcard(data);
  });
  card.appendChild(saveBtn);

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