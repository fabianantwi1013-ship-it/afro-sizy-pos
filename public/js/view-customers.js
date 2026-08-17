import {
  $, $$, api, apiGet, confirmBox, debounce, emptyState, esc, fmtDateTime, icon, initials,
  money, openModal, state, toast, toastError,
} from './core.js';
import { newCustomerDialog } from './pickers.js';

let query = '';
let ui = null;

export async function render(container, context) {
  ui = context;
  ui.setActions(`<button class="btn btn--brand btn--sm" data-new>${icon('plus', 16)} New customer</button>`);
  document.querySelector('#view-actions').onclick = async (e) => {
    if (!e.target.closest('[data-new]')) return;
    const created = await newCustomerDialog();
    if (created) { toast('Customer added', 'ok'); draw(); }
  };

  container.innerHTML = `
    <div class="card" style="margin-bottom:14px"><div class="card__body">
      <div class="picker__search">${icon('search')}
        <input class="input" data-q value="${esc(query)}" placeholder="Search by name or phone…" autocomplete="off">
      </div>
    </div></div>
    <div id="cust-list"></div>`;

  const input = $('[data-q]', container);
  input.addEventListener('input', debounce(() => { query = input.value.trim(); draw(); }, 220));
  container.onclick = (e) => {
    const row = e.target.closest('[data-id]');
    if (row) openCustomer(Number(row.dataset.id));
  };

  await draw();
}

async function draw() {
  const host = $('#cust-list');
  host.innerHTML = '<div class="empty">Loading…</div>';
  let rows;
  try {
    rows = await apiGet(`/api/customers?q=${encodeURIComponent(query)}&limit=300`);
  } catch (err) {
    host.innerHTML = emptyState('Could not load customers', err.message);
    return;
  }

  if (!rows.length) {
    host.innerHTML = emptyState(
      query ? 'No customer matches that search' : 'No customers yet',
      query ? '' : 'They are saved automatically when you attach one to a sale.',
    );
    return;
  }

  const loyalty = state.settings.loyalty_enabled === '1';
  host.innerHTML = `
    <div class="card"><div class="card__body card__body--flush"><div class="table-wrap">
      <table class="table">
        <thead><tr>
          <th>Customer</th><th>Phone</th><th class="r">Visits</th>
          <th class="r">Spent</th>${loyalty ? '<th class="r">Points</th>' : ''}<th>Last visit</th>
        </tr></thead>
        <tbody>${rows.map((c) => `
          <tr class="is-clickable" data-id="${c.id}">
            <td><div style="display:flex;align-items:center;gap:9px">
              <span class="avatar">${esc(initials(c.name))}</span>
              <strong>${esc(c.name)}</strong>
              ${c.visits >= 5 ? '<span class="tag tag--brand">Regular</span>' : ''}
            </div></td>
            <td>${esc(c.phone || '—')}</td>
            <td class="r num">${c.visits}</td>
            <td class="r num"><strong>${money(c.spent)}</strong></td>
            ${loyalty ? `<td class="r num">${c.points}</td>` : ''}
            <td>${c.last_visit ? esc(fmtDateTime(c.last_visit)) : '—'}</td>
          </tr>`).join('')}</tbody>
      </table>
    </div></div></div>`;
}

async function openCustomer(id) {
  let c;
  try { c = await apiGet(`/api/customers/${id}`); }
  catch (err) { return toastError(err); }

  const loyalty = state.settings.loyalty_enabled === '1';

  const action = await openModal({
    title: c.name,
    wide: true,
    hideSubmit: true,
    cancelLabel: 'Close',
    extraFoot: `
      <button type="button" class="btn" data-v="edit">${icon('edit', 16)} Edit</button>
      ${loyalty ? '<button type="button" class="btn" data-v="points">Adjust points</button>' : ''}
      ${c.visits === 0 ? '<button type="button" class="btn btn--danger" data-v="delete">Delete</button>' : ''}`,
    body: `
      <div class="stats">
        <div class="stat"><div class="stat__label">Visits</div><div class="stat__value num">${c.visits}</div></div>
        <div class="stat stat--brand"><div class="stat__label">Lifetime spend</div>
          <div class="stat__value num">${money(c.spent)}</div></div>
        ${loyalty ? `<div class="stat"><div class="stat__label">Points</div>
          <div class="stat__value num">${c.points}</div>
          <div class="stat__sub">worth ${money(Math.floor(c.points / (Number(state.settings.points_per_cedi_redeem) || 20)) * 100)}</div></div>` : ''}
      </div>

      <div style="font-size:13.5px;color:var(--ink-2)">
        ${c.phone ? `<a href="tel:${esc(c.phone)}" style="color:var(--brand);font-weight:600">${esc(c.phone)}</a> · ` : ''}
        Customer since ${esc(fmtDateTime(c.created_at))}
        ${c.notes ? `<div style="margin-top:6px;padding:9px 11px;background:var(--line-2);border-radius:10px">${esc(c.notes)}</div>` : ''}
      </div>

      ${c.upcoming.length ? `
        <div><h3 style="font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Upcoming</h3>
        ${c.upcoming.map((a) => `<div class="tot"><span>${esc(fmtDateTime(a.start_at))}</span>
          <span class="tag">${esc(a.status)}</span></div>`).join('')}</div>` : ''}

      ${c.favourites.length ? `
        <div><h3 style="font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Usual services</h3>
        ${c.favourites.map((f) => `<div class="tot"><span>${esc(f.name)} <em style="font-style:normal;color:var(--muted)">×${f.times}</em></span>
          <span class="num">${money(f.spent)}</span></div>`).join('')}</div>` : ''}

      <div><h3 style="font-size:13px;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Visit history</h3>
        ${c.sales.length ? `<div class="table-wrap"><table class="table">
          <tbody>${c.sales.map((s) => `
            <tr${s.status === 'voided' ? ' style="opacity:.5"' : ''}>
              <td>${esc(fmtDateTime(s.created_at))}</td>
              <td style="color:var(--muted)">${esc(s.receipt_no)}</td>
              <td class="r num"><strong>${money(s.total)}</strong>
                ${s.status === 'voided' ? ' <span class="tag tag--danger">Voided</span>' : ''}</td>
            </tr>`).join('')}</tbody></table></div>`
          : '<div style="font-size:13.5px;color:var(--muted)">No visits recorded yet.</div>'}
      </div>`,
    onMount(root, { close }) {
      $$('[data-v]', root.closest('.modal')).forEach((b) => { b.onclick = () => close(b.dataset.v); });
    },
  });

  if (action === 'edit') await editCustomer(c);
  else if (action === 'points') await adjustPoints(c);
  else if (action === 'delete') await deleteCustomer(c);
  if (action) draw();
}

async function editCustomer(c) {
  const saved = await openModal({
    title: 'Edit customer',
    submitLabel: 'Save',
    body: `
      <label class="field"><span>Name</span><input class="input" name="name" value="${esc(c.name)}"></label>
      <label class="field"><span>Phone <em>optional</em></span>
        <input class="input" name="phone" inputmode="tel" value="${esc(c.phone || '')}"></label>
      <label class="field"><span>Notes</span>
        <textarea class="textarea" name="notes">${esc(c.notes || '')}</textarea></label>`,
    onSubmit(root) {
      const name = $('[name=name]', root).value.trim();
      if (!name) { toast('Name is required', 'err'); return false; }
      return api('PUT', `/api/customers/${c.id}`, {
        name,
        phone: $('[name=phone]', root).value.trim(),
        notes: $('[name=notes]', root).value.trim(),
        points: c.points,
      });
    },
  });
  if (saved) toast('Customer updated', 'ok');
}

async function adjustPoints(c) {
  const saved = await openModal({
    title: 'Adjust loyalty points',
    submitLabel: 'Save',
    body: `
      <p style="margin:0;color:var(--ink-2)">${esc(c.name)} currently has
        <strong class="num">${c.points}</strong> points.</p>
      <label class="field"><span>New balance</span>
        <input class="input num" name="points" inputmode="numeric" value="${c.points}"></label>
      <p style="margin:0;font-size:12.5px;color:var(--muted)">Use this to correct a mistake or add a goodwill bonus.</p>`,
    onSubmit(root) {
      const points = Math.max(0, Math.floor(Number($('[name=points]', root).value) || 0));
      return api('PUT', `/api/customers/${c.id}`, {
        name: c.name, phone: c.phone, notes: c.notes, points,
      });
    },
  });
  if (saved) toast('Points updated', 'ok');
}

async function deleteCustomer(c) {
  if (!(await confirmBox(`Delete ${c.name}? This cannot be undone.`, { submitLabel: 'Delete' }))) return;
  try {
    await api('DELETE', `/api/customers/${c.id}`);
    toast('Customer deleted', 'ok');
  } catch (err) { toastError(err); }
}
