import {
  $, api, apiGet, esc, icon, loadBootstrap, money, state, toastError, setPin, getPin, todayStr,
} from './core.js';

import * as saleView from './view-sale.js';
import * as appointmentsView from './view-appointments.js';
import * as customersView from './view-customers.js';
import * as teamView from './view-team.js';
import * as reportsView from './view-reports.js';
import * as setupView from './view-setup.js';

const VIEWS = {
  sale: { label: 'New Sale', icon: 'cart', mod: saleView },
  appointments: { label: 'Appointments', icon: 'calendar', mod: appointmentsView },
  customers: { label: 'Customers', icon: 'users', mod: customersView },
  team: { label: 'Team', icon: 'scissors', mod: teamView },
  reports: { label: 'Reports', icon: 'chart', mod: reportsView },
  setup: { label: 'Setup', icon: 'gear', mod: setupView },
};

const els = {
  shell: $('#shell'),
  lock: $('#lock'),
  nav: $('.nav'),
  links: $('#nav-links'),
  view: $('#view'),
  title: $('#view-title'),
  actions: $('#view-actions'),
  scrim: $('#scrim'),
};

let current = '';
let apptBadge = 0;

/* ------------------------------------------------------------------ shell */

function renderNav() {
  els.links.innerHTML = Object.entries(VIEWS)
    .map(([key, v]) => `
      <button class="nav__link${key === current ? ' is-active' : ''}" data-go="${key}">
        ${icon(v.icon)}<span>${esc(v.label)}</span>
        ${key === 'appointments' && apptBadge ? `<span class="nav__badge num">${apptBadge}</span>` : ''}
      </button>`)
    .join('');
}

function closeNav() {
  els.nav.classList.remove('is-open');
  els.scrim.hidden = true;
}

const ui = {
  setTitle(text) { els.title.textContent = text; },
  setActions(html) { els.actions.innerHTML = html; },
  go(key) { location.hash = `#/${key}`; },
  async refreshShell() { await refreshShellStats(); },
};

async function refreshShellStats() {
  try {
    const today = todayStr();
    const [summary, appts] = await Promise.all([
      apiGet(`/api/reports/summary?from=${today}&to=${today}`),
      apiGet(`/api/appointments?date=${today}`),
    ]);
    state.todaySummary = summary;
    $('#today-total').textContent =
      `${money(summary.headline.net)} · ${summary.headline.sales} sale${summary.headline.sales === 1 ? '' : 's'}`;
    apptBadge = appts.filter((a) => a.status === 'booked' || a.status === 'arrived').length;
    renderNav();
  } catch { /* the view itself will surface connection problems */ }
}

function tickClock() {
  const now = new Date();
  $('#clock').textContent = now.toLocaleDateString('en-GB', {
    weekday: 'short', day: 'numeric', month: 'short',
  }) + ' · ' + now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/* ----------------------------------------------------------------- router */

async function route() {
  const key = (location.hash.replace(/^#\/?/, '') || 'sale').split('?')[0];
  const view = VIEWS[key] || VIEWS.sale;
  current = VIEWS[key] ? key : 'sale';

  renderNav();
  closeNav();
  ui.setTitle(view.label);
  ui.setActions('');
  els.view.innerHTML = '<div class="empty">Loading…</div>';
  window.scrollTo(0, 0);

  try {
    await view.mod.render(els.view, ui);
  } catch (err) {
    els.view.innerHTML = `<div class="card"><div class="card__body">
      <strong>Could not open ${esc(view.label)}</strong>
      <p style="color:var(--muted)">${esc(err.message)}</p>
      <button class="btn" onclick="location.reload()">Reload</button>
    </div></div>`;
  }
}

/* ------------------------------------------------------------------- lock */

function showLock(message = '') {
  els.lock.hidden = false;
  els.shell.hidden = true;
  $('#lock-error').textContent = message;
  $('#lock-pin').value = '';
  $('#lock-pin').focus();
}

$('#lock-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const pin = $('#lock-pin').value.trim();
  try {
    await api('POST', '/api/unlock', { pin });
    setPin(pin);
    els.lock.hidden = true;
    els.shell.hidden = false;
    await start();
  } catch (err) {
    $('#lock-error').textContent = err.status === 401 ? 'Wrong PIN, try again.' : err.message;
    $('#lock-pin').value = '';
    $('#lock-pin').focus();
  }
});

window.addEventListener('pos:locked', () => {
  if (!els.lock.hidden) return;
  showLock('Session locked — enter the PIN again.');
});

/* ------------------------------------------------------------------ boot */

document.addEventListener('click', (e) => {
  const link = e.target.closest('[data-go]');
  if (link) {
    ui.go(link.dataset.go);
    return;
  }
  if (e.target.closest('#menu-toggle')) {
    els.nav.classList.toggle('is-open');
    els.scrim.hidden = !els.nav.classList.contains('is-open');
  } else if (e.target.closest('#scrim')) {
    closeNav();
  }
});

window.addEventListener('hashchange', route);

async function start() {
  const boot = await loadBootstrap();
  $('#brand-name').textContent = boot.settings.shop_name || 'Afro & Sizy';
  $('#brand-sub').textContent = boot.settings.shop_tagline || 'Point of Sale';
  document.title = `${boot.settings.shop_name || 'Afro & Sizy'} — Point of Sale`;
  tickClock();
  await route();
  await refreshShellStats();
}

setInterval(tickClock, 20_000);
setInterval(() => { if (!els.shell.hidden) refreshShellStats(); }, 120_000);

try {
  const settings = await apiGet('/api/settings');
  if (settings.has_pin && !getPin()) {
    showLock();
  } else {
    els.shell.hidden = false;
    await start();
  }
} catch (err) {
  els.shell.hidden = false;
  els.view.innerHTML = `<div class="card"><div class="card__body">
    <strong>Cannot reach the till server</strong>
    <p style="color:var(--muted)">${esc(err.message)}</p></div></div>`;
  toastError(err);
}
