import {
  $, $$, api, apiGet, confirmBox, emptyState, esc, fmtDuration, fmtTime, icon, money, openModal,
  relativeDay, shiftDate, state, toast, toastError, todayStr,
} from './core.js';
import { pickCustomer, pickServices } from './pickers.js';
import { loadFromAppointment } from './view-sale.js';

let day = todayStr();
let staffFilter = 'all';
let ui = null;

const STATUS = {
  booked: { label: 'Booked', tag: '' },
  arrived: { label: 'In the chair', tag: 'tag--info' },
  completed: { label: 'Paid', tag: 'tag--ok' },
  cancelled: { label: 'Cancelled', tag: '' },
  no_show: { label: 'No show', tag: 'tag--danger' },
};

function timeOptions(selected) {
  const open = Number(state.settings.open_hour) || 8;
  const close = Number(state.settings.close_hour) || 20;
  const out = [];
  for (let h = open; h < close; h += 1) {
    for (const m of [0, 15, 30, 45]) {
      const value = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
      out.push(`<option value="${value}"${value === selected ? ' selected' : ''}>${fmtTime(value)}</option>`);
    }
  }
  return out.join('');
}

export async function render(container, context) {
  ui = context;
  ui.setActions(`<button class="btn btn--brand btn--sm" data-new>${icon('plus', 16)} New booking</button>`);
  document.querySelector('#view-actions').onclick = (e) => {
    if (e.target.closest('[data-new]')) bookingDialog();
  };

  container.innerHTML = `
    <div class="card" style="margin-bottom:14px">
      <div class="card__body" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
        <button class="btn btn--icon" data-prev aria-label="Previous day">${icon('back', 18)}</button>
        <input class="input" type="date" data-date value="${day}" style="width:auto;min-width:150px">
        <button class="btn btn--icon" data-next aria-label="Next day" style="transform:rotate(180deg)">${icon('back', 18)}</button>
        <button class="btn btn--sm" data-today>Today</button>
        <span class="spacer"></span>
        <select class="select" data-staff style="width:auto;min-width:160px">
          <option value="all">All team members</option>
          ${state.staff.map((s) => `<option value="${s.id}"${String(s.id) === staffFilter ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select>
      </div>
    </div>
    <div id="agenda"></div>`;

  container.onclick = (e) => {
    if (e.target.closest('[data-prev]')) return setDay(shiftDate(day, -1));
    if (e.target.closest('[data-next]')) return setDay(shiftDate(day, 1));
    if (e.target.closest('[data-today]')) return setDay(todayStr());
    onAgendaClick(e);
  };
  $('[data-date]', container).onchange = (e) => setDay(e.target.value || todayStr());
  $('[data-staff]', container).onchange = (e) => { staffFilter = e.target.value; draw(); };

  await draw();
}

function setDay(next) {
  day = next;
  $('[data-date]').value = day;
  ui.setTitle(`Appointments · ${relativeDay(day)}`);
  draw();
}

let cache = [];

async function draw() {
  const host = $('#agenda');
  host.innerHTML = '<div class="empty">Loading…</div>';
  ui.setTitle(`Appointments · ${relativeDay(day)}`);

  try {
    const query = `date=${day}${staffFilter !== 'all' ? `&staffId=${staffFilter}` : ''}`;
    cache = await apiGet(`/api/appointments?${query}`);
  } catch (err) {
    host.innerHTML = emptyState('Could not load the diary', err.message);
    return;
  }

  const live = cache.filter((a) => a.status === 'booked' || a.status === 'arrived');
  const expected = live.reduce(
    (sum, a) => sum + a.items.reduce((t, i) => t + i.price, 0), 0,
  );

  host.innerHTML = `
    <div class="stats" style="margin-bottom:14px">
      ${[
        { label: 'Booked', value: String(cache.length) },
        { label: 'Still to come', value: String(live.length) },
        { label: 'Expected takings', value: money(expected), brand: true },
        { label: 'Paid', value: String(cache.filter((a) => a.status === 'completed').length) },
      ].map((s) => `<div class="stat${s.brand ? ' stat--brand' : ''}">
        <div class="stat__label">${s.label}</div><div class="stat__value num">${s.value}</div></div>`).join('')}
    </div>
    ${cache.length ? `<div class="agenda">${cache.map(card).join('')}</div>`
      : emptyState(`Nothing booked for ${relativeDay(day).toLowerCase()}`, 'Use “New booking” to add one.')}`;
}

function card(a) {
  const services = a.items.map((i) => i.name).join(', ');
  const value = a.items.reduce((t, i) => t + i.price, 0);
  const status = STATUS[a.status] || { label: a.status, tag: '' };
  const end = (() => {
    const [h, m] = a.start_at.slice(11, 16).split(':').map(Number);
    const total = h * 60 + m + a.duration_min;
    return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  })();

  return `
    <article class="appt appt--${a.status}" data-id="${a.id}">
      <div class="appt__time num">${fmtTime(a.start_at.slice(11, 16))}<small>to ${fmtTime(end)}</small></div>
      <div class="appt__body">
        <div class="appt__who">${esc(a.customer_name)}
          ${a.customer_phone ? `<a href="tel:${esc(a.customer_phone)}" style="font-size:12.5px;color:var(--brand);margin-left:6px">${esc(a.customer_phone)}</a>` : ''}
        </div>
        <div class="appt__svc">${esc(services)}</div>
        <div class="appt__meta">${esc(a.staff_name || 'No stylist assigned')} · ${money(value)}
          ${a.note ? ` · ${esc(a.note)}` : ''}</div>
      </div>
      <div class="appt__side">
        <span class="tag ${status.tag}">${esc(status.label)}</span>
        ${a.status === 'booked' ? `<button class="btn btn--sm" data-act="arrived">Arrived</button>` : ''}
        ${a.status === 'booked' || a.status === 'arrived'
          ? `<button class="btn btn--sm btn--brand" data-act="checkout">Check out</button>
             <button class="btn btn--sm" data-act="edit">${icon('edit', 15)}</button>
             <button class="btn btn--sm" data-act="menu">…</button>` : ''}
        ${a.sale_id ? `<span class="tag tag--ok">Receipt saved</span>` : ''}
      </div>
    </article>`;
}

async function onAgendaClick(e) {
  const btn = e.target.closest('[data-act]');
  if (!btn) return;
  const appt = cache.find((a) => a.id === Number(btn.closest('[data-id]').dataset.id));
  if (!appt) return;

  const act = btn.dataset.act;
  try {
    if (act === 'arrived') {
      await api('PATCH', `/api/appointments/${appt.id}/status`, { status: 'arrived' });
      toast(`${appt.customer_name} marked as arrived`, 'ok');
      return draw();
    }
    if (act === 'checkout') {
      loadFromAppointment(appt);
      ui.go('sale');
      toast('Booking loaded onto the till', 'ok');
      return;
    }
    if (act === 'edit') return bookingDialog(appt);
    if (act === 'menu') return moreMenu(appt);
  } catch (err) {
    toastError(err);
  }
}

async function moreMenu(appt) {
  const choice = await openModal({
    title: appt.customer_name,
    hideSubmit: true,
    cancelLabel: 'Close',
    body: `<div class="picklist">
      <button type="button" class="picklist__item" data-v="no_show"><strong>Mark as no-show</strong></button>
      <button type="button" class="picklist__item" data-v="cancelled"><strong>Cancel booking</strong></button>
      <button type="button" class="picklist__item" data-v="delete"><strong style="color:var(--danger)">Delete from diary</strong>
        <small>Removes it completely</small></button>
    </div>`,
    onMount(root, { close }) {
      $$('[data-v]', root).forEach((b) => { b.onclick = () => close(b.dataset.v); });
    },
  });
  if (!choice) return;

  try {
    if (choice === 'delete') {
      if (!(await confirmBox('Delete this booking from the diary?', { submitLabel: 'Delete' }))) return;
      await api('DELETE', `/api/appointments/${appt.id}`);
      toast('Booking deleted', 'ok');
    } else {
      await api('PATCH', `/api/appointments/${appt.id}/status`, { status: choice });
      toast('Booking updated', 'ok');
    }
    await draw();
    ui.refreshShell();
  } catch (err) {
    toastError(err);
  }
}

/* ---------------------------------------------------------------- booking */

async function bookingDialog(existing = null) {
  let chosen = existing ? existing.items.map((i) => ({
    id: i.service_id, name: i.name, price: i.price, duration_min: i.duration_min,
  })) : [];
  let customer = existing?.customer_id
    ? { id: existing.customer_id, name: existing.customer_name, phone: existing.customer_phone }
    : null;

  const startDate = existing ? existing.start_at.slice(0, 10) : day;
  const startTime = existing ? existing.start_at.slice(11, 16) : '10:00';

  const saved = await openModal({
    title: existing ? 'Edit booking' : 'New booking',
    submitLabel: existing ? 'Save changes' : 'Book it',
    body: `
      <button type="button" class="ticket__cust-btn" data-cust style="width:100%"></button>
      <div class="grid-2">
        <label class="field"><span>Name</span>
          <input class="input" name="cname" value="${esc(existing?.customer_name || '')}" placeholder="Customer name"></label>
        <label class="field"><span>Phone <em>optional</em></span>
          <input class="input" name="cphone" inputmode="tel" value="${esc(existing?.customer_phone || '')}"></label>
      </div>
      <div class="grid-2">
        <label class="field"><span>Date</span>
          <input class="input" type="date" name="date" value="${startDate}"></label>
        <label class="field"><span>Start time</span>
          <select class="select" name="time">${timeOptions(startTime)}</select></label>
      </div>
      <label class="field"><span>Stylist</span>
        <select class="select" name="staff">
          <option value="">Not assigned yet</option>
          ${state.staff.map((s) => `<option value="${s.id}"${s.id === existing?.staff_id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select></label>
      <div class="field"><span>Services</span>
        <div data-services></div>
        <button type="button" class="btn btn--sm" data-pick>${icon('plus', 15)} Choose services</button></div>
      <label class="field"><span>Note <em>optional</em></span>
        <input class="input" name="note" value="${esc(existing?.note || '')}" placeholder="Bringing own hair, allergic to…"></label>`,
    onMount(root) {
      const drawCustomer = () => {
        $('[data-cust]', root).innerHTML = customer
          ? `<span class="avatar">${esc((customer.name || '?')[0].toUpperCase())}</span>
             <span class="ticket__cust-txt"><strong>${esc(customer.name)}</strong>
             <small>Saved customer · tap to change</small></span>`
          : `<span class="avatar avatar--muted">${icon('user', 16)}</span>
             <span class="ticket__cust-txt"><strong>Look up a saved customer</strong>
             <small>Or just type a name below</small></span>`;
        $('[data-cust]', root).classList.toggle('is-set', !!customer);
      };

      const drawServices = () => {
        const host = $('[data-services]', root);
        host.innerHTML = chosen.length
          ? `<div class="picklist">${chosen.map((s, i) => `
              <div class="picklist__item" style="cursor:default">
                <span style="flex:1"><strong>${esc(s.name)}</strong><small>${fmtDuration(s.duration_min)}</small></span>
                <span class="num">${money(s.price)}</span>
                <button type="button" class="btn btn--icon btn--ghost" data-rm="${i}">${icon('close', 16)}</button>
              </div>`).join('')}</div>
             <div style="font-size:13px;color:var(--muted);margin-top:6px">
               ${fmtDuration(chosen.reduce((t, s) => t + s.duration_min, 0))} ·
               ${money(chosen.reduce((t, s) => t + s.price, 0))}</div>`
          : '<div style="font-size:13px;color:var(--muted)">No service chosen yet.</div>';
        $$('[data-rm]', host).forEach((b) => {
          b.onclick = () => { chosen.splice(Number(b.dataset.rm), 1); drawServices(); };
        });
      };

      $('[data-cust]', root).onclick = async () => {
        const picked = await pickCustomer();
        if (!picked) return;
        customer = picked;
        $('[name=cname]', root).value = picked.name;
        $('[name=cphone]', root).value = picked.phone || '';
        drawCustomer();
      };
      $('[data-pick]', root).onclick = async () => {
        const picked = await pickServices({ selected: chosen.filter((s) => s.id) });
        if (picked) { chosen = picked; drawServices(); }
      };
      $('[name=cname]', root).addEventListener('input', () => {
        if (customer) { customer = null; drawCustomer(); }
      });

      drawCustomer();
      drawServices();
    },
    async onSubmit(root) {
      const name = $('[name=cname]', root).value.trim();
      if (!name) { toast('Enter a customer name', 'err'); return false; }
      if (!chosen.length) { toast('Choose at least one service', 'err'); return false; }

      const payload = {
        customerId: customer?.id ?? null,
        customerName: name,
        customerPhone: $('[name=cphone]', root).value.trim(),
        saveCustomer: !customer,
        staffId: $('[name=staff]', root).value || null,
        startAt: `${$('[name=date]', root).value} ${$('[name=time]', root).value}`,
        note: $('[name=note]', root).value.trim(),
        items: chosen.map((s) => ({
          serviceId: s.id ?? null, name: s.name, price: s.price, durationMin: s.duration_min,
        })),
      };
      return existing
        ? api('PUT', `/api/appointments/${existing.id}`, payload)
        : api('POST', '/api/appointments', payload);
    },
  });

  if (!saved) return;
  toast(existing ? 'Booking updated' : 'Booking saved', 'ok');
  day = saved.start_at.slice(0, 10);
  const dateInput = $('[data-date]');
  if (dateInput) dateInput.value = day;
  await draw();
  ui.refreshShell();
}
