/* Shared helpers: DOM, formatting, API access, dialogs, toasts. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const state = {
  settings: {},
  categories: [],
  services: [],
  staff: [],
  paymentMethods: ['cash', 'momo', 'card', 'bank', 'other'],
  today: '',
  todaySummary: null,
};

/* ------------------------------------------------------------------- api */

const PIN_KEY = 'afro-sizy-pin';
export const getPin = () => sessionStorage.getItem(PIN_KEY) || '';
export const setPin = (pin) => sessionStorage.setItem(PIN_KEY, pin);
export const clearPin = () => sessionStorage.removeItem(PIN_KEY);

export class ApiError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/** The GitHub Pages build sets this; the real till never does. */
export const DEMO = document.documentElement.dataset.posMode === 'demo';
let demoRequest = null;

export async function api(method, path, body) {
  if (DEMO) {
    demoRequest ??= (await import('./demo/backend.js')).request;
    return demoRequest(method, path, body);
  }

  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const pin = getPin();
  if (pin) headers['x-pos-pin'] = pin;

  let res;
  try {
    res = await fetch(path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the till server — is it still running?');
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = null; }
  }
  if (res.status === 401) {
    clearPin();
    window.dispatchEvent(new CustomEvent('pos:locked'));
  }
  if (!res.ok) throw new ApiError(res.status, data?.error || `Request failed (${res.status})`);
  return data;
}

export const apiGet = (path) => api('GET', path);

export async function loadBootstrap() {
  const data = await api('GET', '/api/bootstrap');
  Object.assign(state, data);
  return data;
}

/* -------------------------------------------------------------- formatting */

export function money(minor, { sign = false } = {}) {
  const symbol = state.settings.currency_symbol || '₵';
  const value = (Math.abs(minor || 0) / 100).toLocaleString('en-GB', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  const prefix = minor < 0 ? '−' : sign ? '+' : '';
  return `${prefix}${symbol}${value}`;
}

/** Accepts "120", "120.50", "₵120" -> pesewas. Returns null when unparseable. */
export function parseMoney(input) {
  const clean = String(input ?? '').replace(/[^\d.]/g, '');
  if (!clean) return null;
  const n = Number(clean);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n * 100);
}

const pad = (n) => String(n).padStart(2, '0');
export const todayStr = () => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
export function shiftDate(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
}
export function startOfMonth(dateStr) {
  return `${dateStr.slice(0, 7)}-01`;
}

/** 45 -> "45m", 90 -> "1h 30", 300 -> "5h" */
export function fmtDuration(minutes) {
  const m = Math.max(0, Math.round(minutes || 0));
  if (m < 60) return `${m}m`;
  const hours = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${hours}h ${rest}` : `${hours}h`;
}

export function fmtTime(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  return `${((h + 11) % 12) + 1}:${pad(m)}${suffix}`;
}

export function fmtDate(dateStr, { weekday = false } = {}) {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return dt.toLocaleDateString('en-GB', {
    weekday: weekday ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    year: y === new Date().getFullYear() ? undefined : 'numeric',
  });
}

export function fmtDateTime(stamp) {
  if (!stamp) return '';
  const [date, time = ''] = stamp.split(' ');
  const label = date === todayStr() ? 'Today' : fmtDate(date);
  return time ? `${label}, ${fmtTime(time.slice(0, 5))}` : label;
}

export function relativeDay(dateStr) {
  if (dateStr === todayStr()) return 'Today';
  if (dateStr === shiftDate(todayStr(), 1)) return 'Tomorrow';
  if (dateStr === shiftDate(todayStr(), -1)) return 'Yesterday';
  return fmtDate(dateStr, { weekday: true });
}

export const initials = (name) =>
  String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join('') || '?';

export function debounce(fn, ms = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/* ------------------------------------------------------------------ icons */

const ICONS = {
  cart: '<path d="M3 4h2l2.4 10.4A2 2 0 0 0 9.35 16h7.5a2 2 0 0 0 1.95-1.55L20.5 7H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  users: '<path d="M16 20v-1.5A3.5 3.5 0 0 0 12.5 15h-5A3.5 3.5 0 0 0 4 18.5V20"/><circle cx="10" cy="8" r="3.4"/><path d="M20 20v-1.5a3.5 3.5 0 0 0-2.7-3.4M15.5 4.6a3.4 3.4 0 0 1 0 6.6"/>',
  scissors: '<circle cx="6" cy="6" r="2.6"/><circle cx="6" cy="18" r="2.6"/><path d="M20 4L8.1 16.4M14.5 14.5L20 20M8.1 7.6l3.4 3.5"/>',
  chart: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  gear: '<circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-2.7 1.1V21a2 2 0 1 1-4 0v-.2a1.6 1.6 0 0 0-2.7-1.1l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.6 1.6 0 0 0 3 15a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.6-2.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.6 1.6 0 0 0 10 3.6V3a2 2 0 1 1 4 0v.2a1.6 1.6 0 0 0 2.7 1.1l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.6 1.6 0 0 0 21 11a2 2 0 1 1 0 4 1.6 1.6 0 0 0-1.6 1z"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13M9 7V4h6v3"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  print: '<path d="M7 8V3h10v5M7 18H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2"/><rect x="7" y="14" width="10" height="7"/>',
  check: '<path d="M4 12.5l5.2 5L20 6.5"/>',
  edit: '<path d="M4 20h4L19 9a2.1 2.1 0 0 0-3-3L5 17v3z"/>',
  download: '<path d="M12 3v12M7 11l5 5 5-5M4 21h16"/>',
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-6 8-6s8 2 8 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5.2l3.2 2"/>',
  back: '<path d="M15 5l-7 7 7 7"/>',
};

// Brand marks are solid shapes rather than the outline set above.
const FILLED = {
  whatsapp: '<path d="M17.47 14.38c-.3-.15-1.76-.87-2.03-.97-.28-.1-.47-.15-.67.15-.2.3-.77.97-.94 1.16-.18.2-.35.23-.65.08-.3-.15-1.25-.47-2.39-1.48-.88-.79-1.48-1.76-1.65-2.06-.18-.3-.02-.46.13-.6.14-.14.3-.35.45-.53.15-.17.2-.3.3-.5.1-.2.05-.37-.03-.52-.07-.15-.67-1.61-.91-2.2-.25-.58-.49-.5-.67-.51h-.57c-.2 0-.52.07-.8.37-.27.3-1.03 1.02-1.03 2.48 0 1.46 1.06 2.87 1.21 3.07.15.2 2.1 3.2 5.08 4.49.7.3 1.26.49 1.69.62.71.23 1.36.2 1.87.12.57-.09 1.76-.72 2-1.42.25-.69.25-1.29.18-1.41-.08-.13-.28-.2-.57-.35M12.05 21.79h-.01a9.87 9.87 0 0 1-5.03-1.38l-.36-.21-3.74.98 1-3.65-.24-.37a9.86 9.86 0 0 1-1.51-5.26c0-5.45 4.44-9.89 9.89-9.89 2.64 0 5.12 1.03 6.99 2.9a9.83 9.83 0 0 1 2.89 6.99c0 5.45-4.43 9.89-9.88 9.89m8.41-18.3A11.82 11.82 0 0 0 12.05 0C5.5 0 .16 5.34.16 11.89c0 2.1.55 4.14 1.59 5.95L.06 24l6.3-1.65a11.88 11.88 0 0 0 5.69 1.45c6.55 0 11.89-5.34 11.89-11.9a11.82 11.82 0 0 0-3.48-8.41Z"/>',
};

export function icon(name, size = 18) {
  if (FILLED[name]) {
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}"
      fill="currentColor" aria-hidden="true">${FILLED[name]}</svg>`;
  }
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none"
    stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
    aria-hidden="true">${ICONS[name] || ''}</svg>`;
}

/** Link that opens WhatsApp with the receipt already typed out. */
export function whatsappLink(saleId, { label = 'WhatsApp', small = false, title = '' } = {}) {
  return `<a class="btn${small ? ' btn--sm' : ''} btn--whatsapp" target="_blank" rel="noopener"
    href="/api/sales/${saleId}/whatsapp"${title ? ` title="${esc(title)}"` : ''}
    >${icon('whatsapp', small ? 15 : 16)}${label ? ` ${esc(label)}` : ''}</a>`;
}

/* ----------------------------------------------------------------- toasts */

export function toast(message, kind = '') {
  const host = $('#toasts');
  const node = document.createElement('div');
  node.className = `toast${kind ? ` toast--${kind}` : ''}`;
  node.textContent = message;
  host.append(node);
  setTimeout(() => {
    node.style.transition = 'opacity .2s';
    node.style.opacity = '0';
    setTimeout(() => node.remove(), 220);
  }, kind === 'err' ? 4200 : 2400);
}

export const toastError = (err) => toast(err?.message || String(err), 'err');

/* ----------------------------------------------------------------- modals */

/**
 * openModal({ title, body, wide, submitLabel, danger, extraFoot, onMount, onSubmit })
 * Resolves with whatever onSubmit returns (or true), or null when cancelled.
 * onSubmit may return `false` to keep the dialog open.
 */
export function openModal(opts) {
  const {
    title, body = '', wide = false, submitLabel = 'Save',
    cancelLabel = 'Cancel', danger = false, extraFoot = '',
    onMount, onSubmit, hideSubmit = false,
  } = opts;

  const dlg = document.createElement('dialog');
  dlg.className = `modal${wide ? ' modal--wide' : ''}`;
  dlg.innerHTML = `
    <form method="dialog" class="modal__form">
      <div class="modal__head">
        <h2>${esc(title)}</h2>
        <button type="button" class="modal__x" data-x aria-label="Close">${icon('close', 20)}</button>
      </div>
      <div class="modal__body" data-body>${body}</div>
      <div class="modal__foot">
        ${extraFoot}
        <span class="spacer"></span>
        <button type="button" class="btn" data-cancel>${esc(cancelLabel)}</button>
        ${hideSubmit ? '' : `<button type="submit" class="btn ${danger ? 'btn--danger' : 'btn--brand'}" data-ok>${esc(submitLabel)}</button>`}
      </div>
    </form>`;
  document.body.append(dlg);

  const root = $('[data-body]', dlg);
  let settled = false;

  return new Promise((resolve) => {
    const finish = (value) => {
      if (settled) return;
      settled = true;
      dlg.close();
      dlg.remove();
      resolve(value);
    };

    dlg.addEventListener('cancel', (e) => { e.preventDefault(); finish(null); });
    $('[data-x]', dlg).onclick = () => finish(null);
    $('[data-cancel]', dlg).onclick = () => finish(null);

    $('form', dlg).addEventListener('submit', async (e) => {
      e.preventDefault();
      const okBtn = $('[data-ok]', dlg);
      if (okBtn) okBtn.disabled = true;
      try {
        const result = onSubmit ? await onSubmit(root, dlg) : true;
        if (result === false) return;
        finish(result === undefined ? true : result);
      } catch (err) {
        toastError(err);
      } finally {
        if (okBtn) okBtn.disabled = false;
      }
    });

    dlg.showModal();
    onMount?.(root, { close: finish, dialog: dlg });
    const first = $('input:not([type=hidden]), select, textarea', root);
    if (first && !matchMedia('(pointer: coarse)').matches) first.focus();
  });
}

export function confirmBox(message, { title = 'Are you sure?', submitLabel = 'Confirm', danger = true } = {}) {
  return openModal({
    title,
    body: `<p style="margin:0;color:var(--ink-2)">${esc(message)}</p>`,
    submitLabel,
    danger,
  });
}

export function promptBox({ title, label, value = '', placeholder = '', submitLabel = 'Save', required = true }) {
  return openModal({
    title,
    submitLabel,
    body: `<label class="field"><span>${esc(label)}</span>
      <input class="input" name="v" value="${esc(value)}" placeholder="${esc(placeholder)}"></label>`,
    onSubmit(root) {
      const v = $('input[name=v]', root).value.trim();
      if (required && !v) { toast('Please fill this in', 'err'); return false; }
      return v;
    },
  });
}

/* --------------------------------------------------------------- fragments */

export function statCard({ label, value, sub = '', brand = false }) {
  return `<div class="stat${brand ? ' stat--brand' : ''}">
    <div class="stat__label">${esc(label)}</div>
    <div class="stat__value num">${esc(value)}</div>
    ${sub ? `<div class="stat__sub">${esc(sub)}</div>` : ''}
  </div>`;
}

export function emptyState(title, hint = '') {
  return `<div class="empty"><strong>${esc(title)}</strong>${hint ? esc(hint) : ''}</div>`;
}

export function barList(rows, { max, alt = false } = {}) {
  const top = max ?? Math.max(1, ...rows.map((r) => r.value));
  return `<div class="bars">${rows.map((r) => `
    <div>
      <div class="bar__top"><span>${esc(r.label)}</span><span class="num">${esc(r.display)}</span></div>
      <div class="bar__track"><div class="bar__fill${alt ? ' bar__fill--alt' : ''}"
        style="width:${Math.max(2, Math.round((r.value / top) * 100))}%"></div></div>
    </div>`).join('')}</div>`;
}

export const PAYMENT_LABELS = {
  cash: 'Cash',
  momo: 'Mobile Money',
  card: 'Card',
  bank: 'Bank transfer',
  other: 'Other',
};

export const paymentLabel = (m) => PAYMENT_LABELS[m] || m;
