import {
  $, $$, api, apiGet, barList, emptyState, esc, fmtDate, fmtDateTime, icon, money, openModal,
  paymentLabel, state, statCard, toast, toastError, whatsappLink,
} from './core.js';
import { bindRangeBar, defaultRange, rangeBarHtml, rangeQuery } from './range.js';
import { downloadReceipt, printReceipt } from './receipt.js';

const range = defaultRange('today');
const filters = { q: '', method: '', status: '' };
let ui = null;

export async function render(container, context) {
  ui = context;
  ui.setActions(`
    <a class="btn btn--sm" data-export download>${icon('download', 16)} Sales CSV</a>
    <a class="btn btn--sm" href="/api/backup" download>${icon('download', 16)} Backup</a>`);

  container.innerHTML = `${rangeBarHtml(range)}<div id="rep-body"></div>`;
  bindRangeBar(container, range, draw);
  await draw();
}

async function draw() {
  const link = document.querySelector('[data-export]');
  if (link) link.href = `/api/export/sales.csv?${rangeQuery(range)}`;

  const host = $('#rep-body');
  host.innerHTML = '<div class="empty">Loading…</div>';

  let report;
  try { report = await apiGet(`/api/reports/summary?${rangeQuery(range)}`); }
  catch (err) { host.innerHTML = emptyState('Could not load the report', err.message); return; }

  const h = report.headline;
  const spanLabel = range.from === range.to
    ? fmtDate(range.from, { weekday: true })
    : `${fmtDate(range.from)} → ${fmtDate(range.to)}`;

  host.innerHTML = `
    <div class="stats" style="margin-bottom:14px">
      ${statCard({ label: 'Takings', value: money(h.net), sub: spanLabel, brand: true })}
      ${statCard({ label: 'Sales', value: String(h.sales), sub: `${money(h.avg_ticket)} average` })}
      ${statCard({ label: 'Discounts given', value: money(h.discounts + h.points_discounts) })}
      ${statCard({ label: 'Customers served', value: String(h.customers), sub: `${h.new_customers} new` })}
      ${report.voided.sales ? statCard({ label: 'Voided', value: String(report.voided.sales), sub: money(report.voided.value) }) : ''}
    </div>

    <div class="grid-2" style="margin-bottom:14px">
      <div class="card"><div class="card__head"><h2>How customers paid</h2></div>
        <div class="card__body">${report.byMethod.length
          ? barList(report.byMethod.map((m) => ({
              label: paymentLabel(m.method), value: m.amount, display: money(m.amount),
            })))
          : emptyState('No payments yet')}</div></div>

      <div class="card"><div class="card__head"><h2>Revenue by category</h2></div>
        <div class="card__body">${report.byCategory.length
          ? barList(report.byCategory.map((c) => ({
              label: c.category, value: c.revenue, display: money(c.revenue),
            })), { alt: true })
          : emptyState('No services sold yet')}</div></div>
    </div>

    <div class="grid-2" style="margin-bottom:14px">
      <div class="card"><div class="card__head"><h2>Top services</h2></div>
        <div class="card__body">${report.topServices.length
          ? barList(report.topServices.map((s) => ({
              label: `${s.name} ×${s.qty}`, value: s.revenue, display: money(s.revenue),
            })))
          : emptyState('Nothing sold yet')}</div></div>

      <div class="card"><div class="card__head"><h2>${range.from === range.to ? 'Busiest hours' : 'Day by day'}</h2></div>
        <div class="card__body">${trend(report)}</div></div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card__head"><h2>Team performance</h2></div>
      <div class="card__body card__body--flush">
        ${report.byStaff.length ? `<div class="table-wrap"><table class="table">
          <thead><tr><th>Team member</th><th class="r">Services</th><th class="r">Revenue</th>
            <th class="r">Commission</th><th class="r">Share</th></tr></thead>
          <tbody>${report.byStaff.map((s) => `<tr>
            <td><strong>${esc(s.staff_name)}</strong></td>
            <td class="r num">${s.services}</td>
            <td class="r num">${money(s.revenue)}</td>
            <td class="r num">${money(s.commission)}</td>
            <td class="r num">${h.gross ? Math.round((s.revenue / h.gross) * 100) : 0}%</td>
          </tr>`).join('')}</tbody></table></div>` : emptyState('No sales in this period')}
      </div>
    </div>

    <div class="card">
      <div class="card__head">
        <h2>Sales</h2>
        <span class="spacer"></span>
        <input class="input" data-q placeholder="Receipt or customer…" style="width:180px" value="${esc(filters.q)}">
        <select class="select" data-method style="width:auto">
          <option value="">Any payment</option>
          ${state.paymentMethods.map((m) => `<option value="${m}"${filters.method === m ? ' selected' : ''}>${esc(paymentLabel(m))}</option>`).join('')}
        </select>
        <select class="select" data-status style="width:auto">
          <option value="">All</option>
          <option value="completed"${filters.status === 'completed' ? ' selected' : ''}>Completed</option>
          <option value="voided"${filters.status === 'voided' ? ' selected' : ''}>Voided</option>
        </select>
      </div>
      <div class="card__body card__body--flush" id="sales-list"></div>
    </div>`;

  $('[data-q]', host).onchange = (e) => { filters.q = e.target.value.trim(); drawSales(); };
  $('[data-method]', host).onchange = (e) => { filters.method = e.target.value; drawSales(); };
  $('[data-status]', host).onchange = (e) => { filters.status = e.target.value; drawSales(); };

  await drawSales();
}

function trend(report) {
  const rows = range.from === range.to
    ? report.hourly.map((r) => ({ label: `${String(r.hour).padStart(2, '0')}h`, value: r.net }))
    : report.daily.map((r) => ({ label: fmtDate(r.day).replace(/ \d{4}$/, ''), value: r.net }));

  if (!rows.length) return emptyState('Nothing to chart yet');
  const max = Math.max(...rows.map((r) => r.value), 1);
  return `<div class="spark">${rows.map((r) => `
    <div class="spark__col" title="${esc(r.label)}: ${money(r.value)}">
      <span class="spark__bar" style="height:${Math.max(3, Math.round((r.value / max) * 92))}px"></span>
      <span class="spark__lbl">${esc(r.label)}</span>
    </div>`).join('')}</div>`;
}

async function drawSales() {
  const host = $('#sales-list');
  host.innerHTML = '<div class="empty">Loading…</div>';
  const params = new URLSearchParams({ ...rangeParams(), limit: '200' });
  if (filters.q) params.set('q', filters.q);
  if (filters.method) params.set('method', filters.method);
  if (filters.status) params.set('status', filters.status);

  let data;
  try { data = await apiGet(`/api/sales?${params}`); }
  catch (err) { host.innerHTML = emptyState('Could not load sales', err.message); return; }

  if (!data.sales.length) { host.innerHTML = emptyState('No sales match'); return; }

  host.innerHTML = `<div class="table-wrap"><table class="table">
    <thead><tr><th>Receipt</th><th>When</th><th>Customer</th><th>Paid with</th>
      <th class="r">Total</th><th></th></tr></thead>
    <tbody>${data.sales.map((s) => `
      <tr${s.status === 'voided' ? ' style="opacity:.5"' : ''}>
        <td><strong>${esc(s.receipt_no)}</strong>
          ${s.status === 'voided' ? ' <span class="tag tag--danger">Voided</span>' : ''}
          <div style="font-size:12px;color:var(--muted);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.item_summary || '')}</div></td>
        <td style="white-space:nowrap">${esc(fmtDateTime(s.created_at))}</td>
        <td>${esc(s.customer_name || 'Walk-in')}</td>
        <td>${esc((s.methods || '').split(',').map(paymentLabel).join(', '))}</td>
        <td class="r num"><strong>${money(s.total)}</strong></td>
        <td class="r" style="white-space:nowrap">
          <button class="btn btn--sm" data-view="${s.id}">Open</button>
        </td>
      </tr>`).join('')}</tbody>
  </table></div>
  <div style="padding:11px 14px;border-top:1px solid var(--line-2);font-size:13px;color:var(--muted)">
    Showing ${data.sales.length} of ${data.count} · ${money(data.total)} in completed sales
  </div>`;

  $$('[data-view]', host).forEach((btn) => {
    btn.onclick = () => openSale(Number(btn.dataset.view));
  });
}

function rangeParams() {
  return Object.fromEntries(new URLSearchParams(rangeQuery(range)));
}

async function openSale(id) {
  let sale;
  try { sale = await apiGet(`/api/sales/${id}`); }
  catch (err) { return toastError(err); }

  const action = await openModal({
    title: `Receipt ${sale.receipt_no}`,
    hideSubmit: true,
    cancelLabel: 'Close',
    extraFoot: `
      ${whatsappLink(sale.id)}
      <button type="button" class="btn" data-v="print">${icon('print', 16)} Print</button>
      <button type="button" class="btn" data-v="download">${icon('download', 16)} Download</button>
      ${sale.status === 'completed' ? '<button type="button" class="btn btn--danger" data-v="void">Void</button>' : ''}`,
    body: `
      <div style="font-size:13.5px;color:var(--muted)">${esc(fmtDateTime(sale.created_at))}
        · ${esc(sale.customer_name || 'Walk-in')}
        ${sale.status === 'voided' ? `<div class="tag tag--danger" style="margin-top:6px">Voided — ${esc(sale.void_reason || '')}</div>` : ''}</div>
      <div>${sale.items.map((it) => `
        <div class="tot"><span>${esc(it.name)}${it.qty > 1 ? ` ×${it.qty}` : ''}
          ${it.staff_name ? `<em style="font-style:normal;color:var(--muted)"> · ${esc(it.staff_name)}</em>` : ''}</span>
          <span class="num">${money(it.line_total)}</span></div>`).join('')}</div>
      <div style="border-top:1px solid var(--line-2);padding-top:8px">
        <div class="tot"><span>Subtotal</span><span class="num">${money(sale.subtotal)}</span></div>
        ${sale.discount ? `<div class="tot"><span>Discount ${esc(sale.discount_reason || '')}</span>
          <span class="num">−${money(sale.discount)}</span></div>` : ''}
        ${sale.points_discount ? `<div class="tot tot--credit"><span>Loyalty (${sale.points_redeemed} pts)</span>
          <span class="num">−${money(sale.points_discount)}</span></div>` : ''}
        <div class="tot tot--grand"><span>Total</span><span class="num">${money(sale.total)}</span></div>
        ${sale.payments.map((p) => `<div class="tot"><span>${esc(paymentLabel(p.method))}
          ${p.reference ? `<em style="font-style:normal;color:var(--muted)">· ${esc(p.reference)}</em>` : ''}</span>
          <span class="num">${money(p.amount)}</span></div>`).join('')}
        ${sale.change_due ? `<div class="tot"><span>Change given</span><span class="num">${money(sale.change_due)}</span></div>` : ''}
      </div>
      ${sale.note ? `<div style="font-size:13px;color:var(--muted)">Note: ${esc(sale.note)}</div>` : ''}`,
    onMount(root, { close }) {
      $$('[data-v]', root.closest('.modal')).forEach((b) => { b.onclick = () => close(b.dataset.v); });
    },
  });

  if (action === 'print') return printReceipt(sale);
  if (action === 'download') {
    try {
      await downloadReceipt(sale);
      toast('Receipt image saved to Downloads', 'ok');
    } catch (err) { toastError(err); }
    return;
  }
  if (action !== 'void') return;

  const reason = await openModal({
    title: 'Void sale',
    submitLabel: 'Void it',
    danger: true,
    body: `<p style="margin:0;color:var(--ink-2)">The receipt stays on record but the sale is removed from
      takings, commissions and loyalty points.</p>
      <label class="field"><span>Reason</span><input class="input" name="r"></label>`,
    onSubmit(root) {
      const v = $('[name=r]', root).value.trim();
      if (!v) { toast('Give a reason', 'err'); return false; }
      return v;
    },
  });
  if (!reason) return;
  try {
    await api('POST', `/api/sales/${id}/void`, { reason });
    toast('Sale voided', 'ok');
    ui.refreshShell();
    await draw();
  } catch (err) { toastError(err); }
}
