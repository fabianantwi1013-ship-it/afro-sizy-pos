import {
  $, $$, api, apiGet, confirmBox, esc, fmtDuration, icon, initials, money, openModal, parseMoney,
  paymentLabel, state, toast, toastError, todayStr, emptyState, whatsappLink,
} from './core.js';
import { pickCustomer } from './pickers.js';
import { downloadReceipt, printReceipt } from './receipt.js';

const TICKET_KEY = 'afro-sizy-ticket';
let seq = 1;
let ui = null;
let filter = { category: 'all', q: '' };

const ticket = {
  items: [],
  customer: null,
  discount: 0,
  discountReason: '',
  pointsToRedeem: 0,
  note: '',
  appointmentId: null,
};

/* ------------------------------------------------------------ ticket state */

function saveTicket() {
  try { localStorage.setItem(TICKET_KEY, JSON.stringify(ticket)); } catch { /* private mode */ }
}

function restoreTicket() {
  try {
    const raw = localStorage.getItem(TICKET_KEY);
    if (!raw) return;
    Object.assign(ticket, JSON.parse(raw));
    seq = Math.max(1, ...ticket.items.map((i) => i.key + 1));
  } catch { /* ignore corrupt drafts */ }
}

function resetTicket() {
  ticket.items = [];
  ticket.customer = null;
  ticket.discount = 0;
  ticket.discountReason = '';
  ticket.pointsToRedeem = 0;
  ticket.note = '';
  ticket.appointmentId = null;
  saveTicket();
}

/** Pre-loads the till from an appointment (used by the Appointments screen). */
export function loadFromAppointment(appt) {
  resetTicket();
  ticket.appointmentId = appt.id;
  ticket.customer = appt.customer_id
    ? { id: appt.customer_id, name: appt.customer_name, phone: appt.customer_phone, points: 0 }
    : null;
  ticket.items = appt.items.map((it) => ({
    key: seq++,
    serviceId: it.service_id,
    name: it.name,
    category: state.services.find((s) => s.id === it.service_id)?.category || null,
    unitPrice: it.price,
    qty: 1,
    staffId: appt.staff_id || null,
  }));
  saveTicket();
}

/* ----------------------------------------------------------------- totals */

const redeemRate = () => Math.max(1, Number(state.settings.points_per_cedi_redeem) || 20);
const loyaltyOn = () => state.settings.loyalty_enabled === '1';

function totals() {
  const subtotal = ticket.items.reduce((sum, it) => sum + it.unitPrice * it.qty, 0);
  const discount = Math.min(ticket.discount, subtotal);
  const maxRedeemValue = subtotal - discount;
  let pointsDiscount = Math.floor(ticket.pointsToRedeem / redeemRate()) * 100;
  if (pointsDiscount > maxRedeemValue) pointsDiscount = Math.floor(maxRedeemValue / 100) * 100;
  const pointsUsed = (pointsDiscount / 100) * redeemRate();
  return { subtotal, discount, pointsDiscount, pointsUsed, total: subtotal - discount - pointsDiscount };
}

/* ------------------------------------------------------------------ view */

export async function render(container, context) {
  ui = context;
  restoreTicket();

  ui.setActions(`
    <button class="btn btn--sm" data-recent>${icon('clock', 16)} Recent sales</button>
    <button class="btn btn--sm" data-custom>${icon('plus', 16)} Custom item</button>`);

  container.innerHTML = `
    <div class="sale">
      <section class="picker">
        <div class="picker__search">${icon('search')}
          <input class="input" id="svc-q" placeholder="Search a service…" autocomplete="off"></div>
        <div class="picker__cats" id="svc-cats"></div>
        <div class="picker__grid" id="svc-grid"></div>
      </section>
      <aside class="ticket" id="ticket"></aside>
    </div>`;

  $('#svc-q').addEventListener('input', (e) => {
    filter.q = e.target.value.trim().toLowerCase();
    renderGrid();
  });

  container.onclick = onContainerClick;
  document.querySelector('#view-actions').onclick = (e) => {
    if (e.target.closest('[data-recent]')) recentSales();
    if (e.target.closest('[data-custom]')) addCustomLine();
  };

  renderCats();
  renderGrid();
  renderTicket();
  refreshTicketCustomer();
}

/** A saved ticket may be hours old — pull the customer's current points balance. */
async function refreshTicketCustomer() {
  if (!ticket.customer?.id) return;
  try {
    const fresh = await apiGet(`/api/customers/${ticket.customer.id}`);
    ticket.customer = { id: fresh.id, name: fresh.name, phone: fresh.phone, points: fresh.points };
    renderTicket();
  } catch { /* keep whatever we already had */ }
}

function renderCats() {
  $('#svc-cats').innerHTML = [
    `<button class="chip${filter.category === 'all' ? ' is-active' : ''}" data-cat="all">All</button>`,
    ...state.categories.map((c) =>
      `<button class="chip${filter.category === c.name ? ' is-active' : ''}" data-cat="${esc(c.name)}">${esc(c.name)}</button>`),
  ].join('');
}

function renderGrid() {
  const rows = state.services.filter((s) => {
    if (filter.category !== 'all' && s.category !== filter.category) return false;
    if (!filter.q) return true;
    return s.name.toLowerCase().includes(filter.q) || s.category.toLowerCase().includes(filter.q);
  });

  $('#svc-grid').innerHTML = rows.length
    ? rows.map((s) => `
      <button class="svc" data-svc="${s.id}">
        <span>
          ${filter.category === 'all' ? `<span class="svc__cat">${esc(s.category)}</span>` : ''}
          <span class="svc__name">${esc(s.name)}</span>
        </span>
        <span class="svc__meta">
          <span class="svc__price num">${money(s.price)}</span>
          <span class="svc__dur num">${fmtDuration(s.duration_min)}</span>
        </span>
      </button>`).join('')
    : emptyState('No service matches', 'Try another word, or add it in Setup.');
}

function staffOptions(selectedId) {
  return [
    `<option value=""${selectedId ? '' : ' selected'}>Who served? …</option>`,
    ...state.staff.map((s) =>
      `<option value="${s.id}"${s.id === selectedId ? ' selected' : ''}>${esc(s.name)}</option>`),
  ].join('');
}

function renderTicket() {
  const t = totals();
  const c = ticket.customer;
  const showPoints = loyaltyOn() && c && (c.points > 0 || t.pointsUsed > 0);
  const isOpen = $('#ticket')?.classList.contains('is-open');

  $('#ticket').innerHTML = `
    <button class="ticket__handle" data-toggle>
      <span class="avatar avatar--muted">${ticket.items.length}</span>
      <span style="flex:1;text-align:left;font-weight:600">Current ticket</span>
      <span class="num" style="font-weight:750">${money(t.total)}</span>
    </button>

    <div class="ticket__head">
      <div class="ticket__cust">
        <button class="ticket__cust-btn${c ? ' is-set' : ''}" data-cust>
          <span class="avatar${c ? '' : ' avatar--muted'}">${c ? esc(initials(c.name)) : icon('user', 16)}</span>
          <span class="ticket__cust-txt">
            <strong>${c ? esc(c.name) : 'Walk-in customer'}</strong>
            <small>${c ? esc([c.phone, loyaltyOn() && c.points ? `${c.points} pts` : ''].filter(Boolean).join(' · ') || 'No phone') : 'Tap to attach a customer'}</small>
          </span>
        </button>
        ${c ? `<button class="btn btn--icon btn--ghost" data-cust-clear aria-label="Remove customer">${icon('close', 18)}</button>` : ''}
      </div>
    </div>

    <div class="ticket__lines">
      ${ticket.items.length
        ? ticket.items.map(renderLine).join('')
        : '<div class="empty" style="padding:26px 16px">Tap a service to start the ticket.</div>'}
    </div>

    <div class="ticket__totals">
      <div class="tot"><span>Subtotal</span><span class="num">${money(t.subtotal)}</span></div>
      <div class="tot">
        <span>Discount ${ticket.discountReason ? `<em style="color:var(--muted);font-style:normal">· ${esc(ticket.discountReason)}</em>` : ''}</span>
        <span>${t.discount ? `<span class="num">−${money(t.discount)}</span> ` : ''}<button data-discount>${t.discount ? 'change' : 'add'}</button></span>
      </div>
      ${showPoints ? `
      <div class="tot tot--credit">
        <span>Loyalty ${t.pointsUsed ? `(${t.pointsUsed} pts)` : `(${c.points} available)`}</span>
        <span>${t.pointsDiscount ? `<span class="num">−${money(t.pointsDiscount)}</span> ` : ''}<button data-points>${t.pointsDiscount ? 'change' : 'redeem'}</button></span>
      </div>` : ''}
      <div class="tot tot--grand"><span>Total</span><span class="num">${money(t.total)}</span></div>
    </div>

    <div class="ticket__actions">
      <button class="btn" data-clear ${ticket.items.length ? '' : 'disabled'}>Clear</button>
      <button class="btn btn--brand btn--lg" style="flex:1" data-pay ${ticket.items.length ? '' : 'disabled'}>
        Charge ${money(t.total)}
      </button>
    </div>`;

  if (isOpen) $('#ticket').classList.add('is-open');
  saveTicket();
}

function renderLine(it) {
  const staffMissing = !it.staffId && state.staff.length > 0;
  return `
    <div class="line" data-key="${it.key}">
      <div class="line__top">
        <span class="line__name">${esc(it.name)}</span>
        <span class="line__amt num" role="button" tabindex="0" data-price
              title="Tap to change the price">${money(it.unitPrice * it.qty)}</span>
        <button class="line__del" data-del aria-label="Remove">${icon('trash', 16)}</button>
      </div>
      <div class="line__ctl">
        <span class="qty">
          <button type="button" data-minus aria-label="Less">−</button>
          <span class="num">${it.qty}</span>
          <button type="button" data-plus aria-label="More">+</button>
        </span>
        ${state.staff.length
          ? `<select class="select line__staff${staffMissing ? ' is-unset' : ''}" data-staff>${staffOptions(it.staffId)}</select>`
          : '<span style="font-size:12px;color:var(--muted)">Add your team in Setup to track commission</span>'}
      </div>
    </div>`;
}

/* ---------------------------------------------------------------- actions */

function addService(serviceId) {
  const svc = state.services.find((s) => s.id === serviceId);
  if (!svc) return;
  const existing = ticket.items.find((it) => it.serviceId === svc.id && it.unitPrice === svc.price);
  if (existing) existing.qty += 1;
  else {
    ticket.items.push({
      key: seq++,
      serviceId: svc.id,
      name: svc.name,
      category: svc.category,
      unitPrice: svc.price,
      qty: 1,
      staffId: state.staff.length === 1 ? state.staff[0].id : null,
    });
  }
  renderTicket();
}

async function addCustomLine() {
  const result = await openModal({
    title: 'Custom item',
    submitLabel: 'Add to ticket',
    body: `
      <label class="field"><span>Description</span>
        <input class="input" name="name" placeholder="e.g. Hair extension supplied"></label>
      <label class="field"><span>Price</span>
        <input class="input num" name="price" inputmode="decimal" placeholder="0.00"></label>`,
    onSubmit(root) {
      const name = $('[name=name]', root).value.trim();
      const price = parseMoney($('[name=price]', root).value);
      if (!name) { toast('Give the item a description', 'err'); return false; }
      if (price === null) { toast('Enter a valid price', 'err'); return false; }
      return { name, price };
    },
  });
  if (!result) return;
  ticket.items.push({
    key: seq++,
    serviceId: null,
    name: result.name,
    category: 'Custom',
    unitPrice: result.price,
    qty: 1,
    staffId: state.staff.length === 1 ? state.staff[0].id : null,
  });
  renderTicket();
}

async function editDiscount() {
  const t = totals();
  const result = await openModal({
    title: 'Discount',
    submitLabel: 'Apply',
    extraFoot: t.discount ? '<button type="button" class="btn btn--danger" data-remove>Remove</button>' : '',
    body: `
      <div class="grid-2">
        <label class="field"><span>Amount off</span>
          <input class="input num" name="amount" inputmode="decimal" value="${t.discount ? (t.discount / 100).toFixed(2) : ''}" placeholder="0.00"></label>
        <label class="field"><span>…or percent off</span>
          <input class="input num" name="percent" inputmode="decimal" placeholder="e.g. 10"></label>
      </div>
      <label class="field"><span>Reason <em>optional</em></span>
        <input class="input" name="reason" value="${esc(ticket.discountReason)}" placeholder="Regular client, promo…"></label>
      <p style="margin:0;font-size:12.5px;color:var(--muted)">Subtotal is ${money(t.subtotal)}.</p>`,
    onMount(root, { close }) {
      const remove = root.closest('.modal').querySelector('[data-remove]');
      if (remove) remove.onclick = () => close({ amount: 0, reason: '' });
      const pct = $('[name=percent]', root);
      const amt = $('[name=amount]', root);
      pct.addEventListener('input', () => {
        const n = Number(pct.value);
        if (Number.isFinite(n) && n > 0) amt.value = ((t.subtotal * n) / 100 / 100).toFixed(2);
      });
    },
    onSubmit(root) {
      const amount = parseMoney($('[name=amount]', root).value) ?? 0;
      if (amount > t.subtotal) { toast('Discount is more than the subtotal', 'err'); return false; }
      return { amount, reason: $('[name=reason]', root).value.trim() };
    },
  });
  if (!result) return;
  ticket.discount = result.amount;
  ticket.discountReason = result.amount ? result.reason : '';
  renderTicket();
}

async function editPoints() {
  const c = ticket.customer;
  const t = totals();
  const rate = redeemRate();
  const spendable = Math.min(c.points, Math.floor((t.subtotal - t.discount) / 100) * rate);

  const result = await openModal({
    title: 'Redeem loyalty points',
    submitLabel: 'Apply',
    body: `
      <p style="margin:0;color:var(--ink-2)">${esc(c.name)} has <strong class="num">${c.points}</strong> points.
        Every <strong>${rate}</strong> points is worth ${money(100)} off.</p>
      <label class="field"><span>Points to use <em>max ${spendable}</em></span>
        <input class="input num" name="pts" inputmode="numeric" value="${Math.min(ticket.pointsToRedeem, spendable) || spendable}"></label>
      <div data-preview style="font-size:13.5px;color:var(--ok);font-weight:600"></div>`,
    onMount(root) {
      const input = $('[name=pts]', root);
      const preview = $('[data-preview]', root);
      const update = () => {
        const pts = Math.min(Math.max(0, Math.floor(Number(input.value) || 0)), spendable);
        const value = Math.floor(pts / rate) * 100;
        preview.textContent = value
          ? `Takes ${money(value)} off — uses ${(value / 100) * rate} points.`
          : `Needs at least ${rate} points to be worth anything.`;
      };
      input.addEventListener('input', update);
      update();
    },
    onSubmit(root) {
      const pts = Math.min(Math.max(0, Math.floor(Number($('[name=pts]', root).value) || 0)), spendable);
      return { pts };
    },
  });
  if (!result) return;
  ticket.pointsToRedeem = result.pts;
  renderTicket();
}

async function editPrice(item) {
  const result = await openModal({
    title: item.name,
    submitLabel: 'Update price',
    body: `<label class="field"><span>Unit price</span>
      <input class="input num" name="price" inputmode="decimal" value="${(item.unitPrice / 100).toFixed(2)}"></label>`,
    onSubmit(root) {
      const price = parseMoney($('[name=price]', root).value);
      if (price === null) { toast('Enter a valid price', 'err'); return false; }
      return price;
    },
  });
  if (result === null) return;
  item.unitPrice = result;
  renderTicket();
}

function onContainerClick(e) {
  const svcBtn = e.target.closest('[data-svc]');
  if (svcBtn) return addService(Number(svcBtn.dataset.svc));

  const catBtn = e.target.closest('[data-cat]');
  if (catBtn) {
    filter.category = catBtn.dataset.cat;
    renderCats();
    renderGrid();
    return;
  }

  if (e.target.closest('[data-toggle]')) {
    $('#ticket').classList.toggle('is-open');
    return;
  }

  const lineEl = e.target.closest('.line');
  if (lineEl) {
    const item = ticket.items.find((it) => it.key === Number(lineEl.dataset.key));
    if (!item) return;
    if (e.target.closest('[data-del]')) {
      ticket.items = ticket.items.filter((it) => it !== item);
      if (!ticket.items.length) { ticket.discount = 0; ticket.pointsToRedeem = 0; }
      return renderTicket();
    }
    if (e.target.closest('[data-plus]')) { item.qty += 1; return renderTicket(); }
    if (e.target.closest('[data-minus]')) {
      item.qty -= 1;
      if (item.qty < 1) ticket.items = ticket.items.filter((it) => it !== item);
      return renderTicket();
    }
    if (e.target.closest('[data-price]')) return editPrice(item);
  }

  if (e.target.closest('[data-cust]')) return attachCustomer();
  if (e.target.closest('[data-cust-clear]')) {
    ticket.customer = null;
    ticket.pointsToRedeem = 0;
    return renderTicket();
  }
  if (e.target.closest('[data-discount]')) return editDiscount();
  if (e.target.closest('[data-points]')) return editPoints();
  if (e.target.closest('[data-clear]')) return clearTicket();
  if (e.target.closest('[data-pay]')) return checkout();
}

document.addEventListener('change', (e) => {
  const select = e.target.closest('[data-staff]');
  if (!select) return;
  const item = ticket.items.find((it) => it.key === Number(select.closest('.line').dataset.key));
  if (item) {
    item.staffId = select.value ? Number(select.value) : null;
    select.classList.toggle('is-unset', !item.staffId);
    saveTicket();
  }
});

async function attachCustomer() {
  const chosen = await pickCustomer();
  if (!chosen) return;
  ticket.customer = chosen;
  ticket.pointsToRedeem = 0;
  renderTicket();
}

async function clearTicket() {
  if (!(await confirmBox('Clear this ticket and start again?', { submitLabel: 'Clear ticket' }))) return;
  resetTicket();
  renderTicket();
}

/* --------------------------------------------------------------- checkout */

function quickAmounts(due) {
  const options = new Set([due]);
  for (const step of [500, 1000, 5000, 10_000]) {
    const up = Math.ceil(due / step) * step;
    if (up > due) options.add(up);
  }
  for (const note of [5000, 10_000, 20_000]) if (note > due) options.add(note);
  return [...options].sort((a, b) => a - b).slice(0, 5);
}

async function checkout() {
  const t = totals();
  if (!ticket.items.length) return;

  const unassigned = ticket.items.filter((it) => !it.staffId).length;
  if (unassigned && state.staff.length) {
    const go = await confirmBox(
      `${unassigned} line${unassigned === 1 ? '' : 's'} have no stylist assigned, so no commission will be recorded. Continue anyway?`,
      { title: 'Stylist not set', submitLabel: 'Charge anyway', danger: false },
    );
    if (!go) return;
  }

  let extra = [];   // additional split payments

  const sale = await openModal({
    title: 'Take payment',
    submitLabel: `Complete sale`,
    body: `
      <div class="pay__due"><span>Total due</span><strong class="num">${money(t.total)}</strong></div>
      <div class="pay__methods" data-methods>
        ${state.paymentMethods.map((m, i) => `
          <button type="button" class="pay__method${i === 0 ? ' is-active' : ''}" data-m="${m}">
            ${esc(paymentLabel(m))}</button>`).join('')}
      </div>
      <label class="field"><span>Amount received</span>
        <input class="input num" name="amount" inputmode="decimal" value="${(t.total / 100).toFixed(2)}"></label>
      <div class="pay__quick" data-quick>
        ${quickAmounts(t.total).map((a) => `<button type="button" class="chip num" data-amt="${a}">${money(a)}</button>`).join('')}
      </div>
      <label class="field" data-ref-wrap hidden><span>Reference <em>optional</em></span>
        <input class="input" name="reference" placeholder="MoMo transaction ID, last 4 digits…"></label>
      <div class="pay__split" data-splits></div>
      <button type="button" class="btn btn--sm" data-add-split>${icon('plus', 15)} Split with another method</button>
      <label class="field"><span>Note <em>optional</em></span>
        <input class="input" name="note" placeholder="Anything to remember about this sale"></label>
      <div class="pay__change" data-change></div>`,
    onMount(root, { dialog }) {
      const amountEl = $('[name=amount]', root);
      const refWrap = $('[data-ref-wrap]', root);
      const changeEl = $('[data-change]', root);
      const splitsEl = $('[data-splits]', root);
      let method = state.paymentMethods[0];

      const tendered = () =>
        (parseMoney(amountEl.value) ?? 0) + extra.reduce((sum, p) => sum + (p.amount || 0), 0);

      const refresh = () => {
        refWrap.hidden = method === 'cash';
        const diff = tendered() - t.total;
        const ok = diff >= 0;
        changeEl.className = `pay__change ${ok ? 'pay__change--ok' : 'pay__change--short'}`;
        changeEl.innerHTML = ok
          ? `<span>Change to give</span><span class="num">${money(diff)}</span>`
          : `<span>Still owing</span><span class="num">${money(-diff)}</span>`;
        $('[data-ok]', dialog).disabled = !ok;
      };

      const drawSplits = () => {
        splitsEl.innerHTML = extra.map((p, i) => `
          <div class="pay__split-row">
            <select class="select" data-split-m="${i}">
              ${state.paymentMethods.map((m) =>
                `<option value="${m}"${m === p.method ? ' selected' : ''}>${esc(paymentLabel(m))}</option>`).join('')}
            </select>
            <input class="input num" data-split-a="${i}" inputmode="decimal"
                   value="${p.amount ? (p.amount / 100).toFixed(2) : ''}" placeholder="0.00">
            <button type="button" class="btn btn--icon btn--ghost" data-split-x="${i}">${icon('close', 18)}</button>
          </div>`).join('');

        $$('[data-split-m]', splitsEl).forEach((el) => {
          el.onchange = () => { extra[Number(el.dataset.splitM)].method = el.value; refresh(); };
        });
        $$('[data-split-a]', splitsEl).forEach((el) => {
          el.oninput = () => { extra[Number(el.dataset.splitA)].amount = parseMoney(el.value) ?? 0; refresh(); };
        });
        $$('[data-split-x]', splitsEl).forEach((el) => {
          el.onclick = () => { extra.splice(Number(el.dataset.splitX), 1); drawSplits(); refresh(); };
        });
        refresh();
      };

      $('[data-methods]', root).onclick = (e) => {
        const btn = e.target.closest('[data-m]');
        if (!btn) return;
        method = btn.dataset.m;
        $$('[data-m]', root).forEach((b) => b.classList.toggle('is-active', b === btn));
        refresh();
      };
      $('[data-quick]', root).onclick = (e) => {
        const btn = e.target.closest('[data-amt]');
        if (!btn) return;
        amountEl.value = (Number(btn.dataset.amt) / 100).toFixed(2);
        refresh();
      };
      $('[data-add-split]', root).onclick = () => {
        const short = Math.max(0, t.total - tendered());
        extra.push({ method: method === 'cash' ? 'momo' : 'cash', amount: short });
        drawSplits();
      };
      amountEl.addEventListener('input', refresh);
      amountEl.addEventListener('focus', () => amountEl.select());
      root.dataset.ready = '1';
      root.__method = () => method;
      refresh();
    },
    async onSubmit(root) {
      const amount = parseMoney($('[name=amount]', root).value) ?? 0;
      const payments = [
        {
          method: root.__method(),
          amount,
          reference: $('[name=reference]', root).value.trim(),
        },
        ...extra.filter((p) => p.amount > 0),
      ].filter((p) => p.amount > 0);

      const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
      if (totalPaid < t.total) { toast('Amount received is less than the total', 'err'); return false; }

      // Change is only ever handed back in cash, so trim non-cash overpayment.
      const nonCash = payments.filter((p) => p.method !== 'cash').reduce((s, p) => s + p.amount, 0);
      if (nonCash > t.total) {
        toast('Non-cash payments add up to more than the total', 'err');
        return false;
      }

      return api('POST', '/api/sales', {
        customerId: ticket.customer?.id ?? null,
        items: ticket.items.map((it) => ({
          serviceId: it.serviceId,
          name: it.name,
          category: it.category,
          unitPrice: it.unitPrice,
          qty: it.qty,
          staffId: it.staffId,
        })),
        discount: ticket.discount,
        discountReason: ticket.discountReason,
        pointsToRedeem: ticket.pointsToRedeem,
        payments,
        note: $('[name=note]', root).value.trim(),
        appointmentId: ticket.appointmentId,
      });
    },
  });

  if (!sale) return;
  resetTicket();
  renderTicket();
  ui.refreshShell();
  await saleDone(sale);
}

async function saleDone(sale) {
  await openModal({
    title: 'Sale complete',
    submitLabel: 'New sale',
    cancelLabel: 'Close',
    extraFoot: `
      ${whatsappLink(sale.id)}
      <button type="button" class="btn" data-print>${icon('print', 16)} Print</button>
      <button type="button" class="btn" data-download>${icon('download', 16)} Download</button>`,
    body: `
      <div style="text-align:center;padding:6px 0 2px">
        <div style="width:56px;height:56px;margin:0 auto 10px;border-radius:50%;background:var(--ok-soft);
                    color:var(--ok);display:grid;place-items:center">${icon('check', 30)}</div>
        <div class="num" style="font-size:30px;font-weight:750">${money(sale.total)}</div>
        <div style="color:var(--muted);font-size:13.5px">Receipt ${esc(sale.receipt_no)}</div>
      </div>
      ${sale.change_due ? `<div class="pay__change pay__change--ok">
        <span>Change to give</span><span class="num">${money(sale.change_due)}</span></div>` : ''}
      <div class="card__body" style="padding:0">
        ${sale.payments.map((p) => `<div class="tot"><span>${esc(paymentLabel(p.method))}</span>
          <span class="num">${money(p.amount)}</span></div>`).join('')}
        ${sale.points_earned ? `<div class="tot tot--credit"><span>Loyalty points earned</span>
          <span class="num">${sale.points_earned}</span></div>` : ''}
      </div>`,
    onMount(root) {
      const foot = root.closest('.modal');
      $('[data-print]', foot).onclick = () => printReceipt(sale);
      $('[data-download]', foot).onclick = async () => {
        try {
          await downloadReceipt(sale);
          toast('Receipt image saved to Downloads', 'ok');
        } catch (err) { toastError(err); }
      };
    },
  });
}

/* ----------------------------------------------------------- recent sales */

async function recentSales() {
  await openModal({
    title: "Today's sales",
    wide: true,
    hideSubmit: true,
    cancelLabel: 'Close',
    body: '<div data-list><div class="empty">Loading…</div></div>',
    async onMount(root) {
      const list = $('[data-list]', root);

      const draw = async () => {
        const today = todayStr();
        const { sales } = await apiGet(`/api/sales?from=${today}&to=${today}&limit=60`);
        list.innerHTML = sales.length ? `
          <div class="table-wrap"><table class="table">
            <thead><tr><th>Receipt</th><th>Time</th><th>Customer</th><th class="r">Total</th><th></th></tr></thead>
            <tbody>${sales.map((s) => `
              <tr${s.status === 'voided' ? ' style="opacity:.5"' : ''}>
                <td><strong>${esc(s.receipt_no)}</strong>
                  ${s.status === 'voided' ? '<span class="tag tag--danger">Voided</span>' : ''}
                  <div style="font-size:12px;color:var(--muted)">${esc(s.item_summary || '')}</div></td>
                <td class="num" style="white-space:nowrap">${esc((s.created_at || '').slice(11, 16))}</td>
                <td>${esc(s.customer_name || 'Walk-in')}</td>
                <td class="r num"><strong>${money(s.total)}</strong></td>
                <td class="r" style="white-space:nowrap">
                  ${whatsappLink(s.id, { label: '', small: true, title: 'Send on WhatsApp' })}
                  <button class="btn btn--sm" data-print="${s.id}" title="Print receipt">${icon('print', 15)}</button>
                  <button class="btn btn--sm" data-download="${s.id}" title="Download receipt image">${icon('download', 15)}</button>
                  ${s.status === 'completed' ? `<button class="btn btn--sm btn--danger" data-void="${s.id}">Void</button>` : ''}
                </td>
              </tr>`).join('')}</tbody></table></div>`
          : emptyState('No sales yet today', 'Ring one up and it will show here.');

        $$('[data-print]', list).forEach((btn) => {
          btn.onclick = async () => {
            try { printReceipt(await apiGet(`/api/sales/${btn.dataset.print}`)); }
            catch (err) { toastError(err); }
          };
        });
        $$('[data-download]', list).forEach((btn) => {
          btn.onclick = async () => {
            try {
              await downloadReceipt(await apiGet(`/api/sales/${btn.dataset.download}`));
              toast('Receipt image saved to Downloads', 'ok');
            } catch (err) { toastError(err); }
          };
        });
        $$('[data-void]', list).forEach((btn) => {
          btn.onclick = async () => {
            const reason = await openModal({
              title: 'Void sale',
              submitLabel: 'Void it',
              danger: true,
              body: `<p style="margin:0;color:var(--ink-2)">Voiding keeps the receipt on record but removes it from
                     takings, commissions and loyalty points.</p>
                     <label class="field"><span>Reason</span>
                     <input class="input" name="r" placeholder="Wrong amount, customer cancelled…"></label>`,
              onSubmit(r) {
                const v = $('[name=r]', r).value.trim();
                if (!v) { toast('Give a reason', 'err'); return false; }
                return v;
              },
            });
            if (!reason) return;
            try {
              await api('POST', `/api/sales/${btn.dataset.void}/void`, { reason });
              toast('Sale voided', 'ok');
              ui.refreshShell();
              await draw();
            } catch (err) { toastError(err); }
          };
        });
      };

      try { await draw(); }
      catch (err) { list.innerHTML = emptyState('Could not load sales', err.message); }
    },
  });
}
