import { $, $$, shiftDate, todayStr } from './core.js';

/** Monday-based week start. */
function weekStart(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return shiftDate(dateStr, -((dt.getDay() + 6) % 7));
}

function monthStart(dateStr) { return `${dateStr.slice(0, 7)}-01`; }

function lastMonth(dateStr) {
  const [y, m] = dateStr.split('-').map(Number);
  const start = m === 1 ? `${y - 1}-12-01` : `${y}-${String(m - 1).padStart(2, '0')}-01`;
  return { from: start, to: shiftDate(monthStart(dateStr), -1) };
}

export const PRESETS = {
  today: { label: 'Today', of: (t) => ({ from: t, to: t }) },
  yesterday: { label: 'Yesterday', of: (t) => ({ from: shiftDate(t, -1), to: shiftDate(t, -1) }) },
  week: { label: 'This week', of: (t) => ({ from: weekStart(t), to: t }) },
  month: { label: 'This month', of: (t) => ({ from: monthStart(t), to: t }) },
  lastmonth: { label: 'Last month', of: (t) => lastMonth(t) },
};

export function defaultRange(preset = 'today') {
  return { preset, ...PRESETS[preset].of(todayStr()) };
}

export function rangeBarHtml(range) {
  return `
    <div class="card" style="margin-bottom:14px"><div class="card__body row">
      ${Object.entries(PRESETS).map(([key, p]) =>
        `<button class="chip${range.preset === key ? ' is-active' : ''}" data-preset="${key}">${p.label}</button>`).join('')}
      <span class="spacer"></span>
      <input class="input" type="date" data-from value="${range.from}" style="width:auto">
      <span style="color:var(--muted)">to</span>
      <input class="input" type="date" data-to value="${range.to}" style="width:auto">
    </div></div>`;
}

export function bindRangeBar(container, range, onChange) {
  $$('[data-preset]', container).forEach((btn) => {
    btn.onclick = () => {
      const key = btn.dataset.preset;
      Object.assign(range, { preset: key, ...PRESETS[key].of(todayStr()) });
      onChange();
    };
  });
  const from = $('[data-from]', container);
  const to = $('[data-to]', container);
  const custom = () => {
    if (!from.value || !to.value) return;
    if (from.value > to.value) { to.value = from.value; }
    Object.assign(range, { preset: 'custom', from: from.value, to: to.value });
    onChange();
  };
  from.onchange = custom;
  to.onchange = custom;
}

export const rangeQuery = (range) => `from=${range.from}&to=${range.to}`;
