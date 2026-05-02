'use strict';

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('c-submit');
  if (btn) btn.addEventListener('click', submitContact);
});

async function submitContact() {
  const name    = document.getElementById('c-name')?.value.trim();
  const email   = document.getElementById('c-email')?.value.trim();
  const service = document.getElementById('c-service')?.value;
  const budget  = document.getElementById('c-budget')?.value;
  const message = document.getElementById('c-message')?.value.trim();
  const errEl   = document.getElementById('c-error');
  const success = document.getElementById('c-success');
  const btn     = document.getElementById('c-submit');

  errEl.style.display = 'none';

  if (!name || !email || !message) {
    errEl.textContent = '> Name, email, and message are required.';
    errEl.style.display = 'block';
    return;
  }

  if (!email.includes('@') || !email.includes('.')) {
    errEl.textContent = '> That email address does not look right.';
    errEl.style.display = 'block';
    return;
  }

  const submission = {
    id:        Date.now(),
    name,
    email,
    service:   service || 'Not specified',
    budget:    budget  || 'Not specified',
    message,
    timestamp: new Date().toISOString(),
    read:      false,
  };

  btn.disabled    = true;
  btn.textContent = 'SENDING...';

  try {
    const res = await fetch('/api/contact', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(submission),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Server error ${res.status}`);
    }

    // Mirror to localStorage as a local backup
    try {
      const messages = JSON.parse(localStorage.getItem('pcs_messages') || '[]');
      messages.unshift(submission);
      if (messages.length > 100) messages.pop();
      localStorage.setItem('pcs_messages', JSON.stringify(messages));
    } catch (_) {}

    btn.textContent = 'SENT';

    ['c-name','c-email','c-message'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.getElementById('c-service').value = '';
    document.getElementById('c-budget').value  = '';

    success.style.display = 'block';
    success.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (e) {
    btn.disabled    = false;
    btn.textContent = 'SEND MESSAGE →';
    errEl.textContent   = `> ${e.message || 'Failed to send. Please try again.'}`;
    errEl.style.display = 'block';
  }
}
