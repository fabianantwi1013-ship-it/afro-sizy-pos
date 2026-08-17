import {
  $, $$, api, apiGet, confirmBox, emptyState, esc, fmtDateTime, icon, initials, loadBootstrap,
  money, openModal, state, toast, toastError,
} from './core.js';
import { bindRangeBar, defaultRange, rangeBarHtml, rangeQuery } from './range.js';

const range = defaultRange('week');
let ui = null;

export async function render(container, context) {
  ui = context;
  ui.setActions(`
    <a class="btn btn--sm" data-export download>${icon('download', 16)} Export</a>
    <button class="btn btn--brand btn--sm" data-new>${icon('plus', 16)} Add team member</button>`);
  document.querySelector('#view-actions').onclick = (e) => {
    if (e.target.closest('[data-new]')) staffDialog();
  };

  container.innerHTML = `${rangeBarHtml(range)}<div id="team-body"></div>`;
  bindRangeBar(container, range, draw);
  container.onclick = onClick;
  await draw();
}

function syncExport() {
  const link = document.querySelector('[data-export]');
  if (link) link.href = `/api/export/commissions.csv?${rangeQuery(range)}`;
}

async function draw() {
  syncExport();
  const host = $('#team-body');
  host.innerHTML = '<div class="empty">Loading…</div>';

  let report;
  try { report = await apiGet(`/api/reports/commissions?${rangeQuery(range)}`); }
  catch (err) { host.innerHTML = emptyState('Could not load commissions', err.message); return; }

  const byId = new Map(report.staff.map((s) => [s.staff_id, s]));
  const team = await apiGet('/api/staff?all=1');

  if (!team.length) {
    host.innerHTML = emptyState(
      'No team members yet',
      'Add your stylists and barbers so every sale can be credited and commission worked out.',
    );
    return;
  }

  const totals = report.staff.reduce(
    (acc, s) => ({ revenue: acc.revenue + s.revenue, commission: acc.commission + s.commission }),
    { revenue: 0, commission: 0 },
  );

  host.innerHTML = `
    <div class="stats" style="margin-bottom:14px">
      <div class="stat"><div class="stat__label">Team members</div>
        <div class="stat__value num">${team.filter((s) => s.active).length}</div></div>
      <div class="stat stat--brand"><div class="stat__label">Service revenue</div>
        <div class="stat__value num">${money(totals.revenue)}</div>
        <div class="stat__sub">${esc(range.from)} → ${esc(range.to)}</div></div>
      <div class="stat"><div class="stat__label">Commission owed</div>
        <div class="stat__value num">${money(totals.commission)}</div></div>
    </div>

    <div class="card"><div class="card__body card__body--flush"><div class="table-wrap">
      <table class="table">
        <thead><tr>
          <th>Team member</th><th>Rate</th><th class="r">Services</th>
          <th class="r">Revenue</th><th class="r">Commission</th><th></th>
        </tr></thead>
        <tbody>${team.map((s) => {
          const stats = byId.get(s.id) || { services: 0, revenue: 0, commission: 0 };
          return `<tr class="is-clickable" data-open="${s.id}"${s.active ? '' : ' style="opacity:.5"'}>
            <td><div style="display:flex;align-items:center;gap:9px">
              <span class="avatar">${esc(initials(s.name))}</span>
              <span><strong>${esc(s.name)}</strong>
                <div style="font-size:12px;color:var(--muted)">${esc(s.role || 'Stylist')}${s.active ? '' : ' · inactive'}</div>
              </span></div></td>
            <td class="num">${s.commission_rate}%</td>
            <td class="r num">${stats.services}</td>
            <td class="r num">${money(stats.revenue)}</td>
            <td class="r num"><strong>${money(stats.commission)}</strong></td>
            <td class="r"><button class="btn btn--sm" data-edit="${s.id}">${icon('edit', 15)}</button></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div></div></div>`;

  host.__report = report;
}

function onClick(e) {
  const edit = e.target.closest('[data-edit]');
  if (edit) {
    e.stopPropagation();
    const member = state.staff.find((s) => s.id === Number(edit.dataset.edit));
    return apiGet(`/api/staff?all=1`).then((rows) =>
      staffDialog(rows.find((s) => s.id === Number(edit.dataset.edit)) || member));
  }
  const open = e.target.closest('[data-open]');
  if (open) return staffDetail(Number(open.dataset.open));
}

async function staffDetail(id) {
  const report = $('#team-body').__report;
  const entry = report?.staff.find((s) => s.staff_id === id);
  const member = (await apiGet('/api/staff?all=1')).find((s) => s.id === id);
  if (!member) return;

  await openModal({
    title: member.name,
    wide: true,
    hideSubmit: true,
    cancelLabel: 'Close',
    body: `
      <div class="stats">
        <div class="stat"><div class="stat__label">Commission rate</div>
          <div class="stat__value num">${member.commission_rate}%</div></div>
        <div class="stat stat--brand"><div class="stat__label">Revenue</div>
          <div class="stat__value num">${money(entry?.revenue || 0)}</div></div>
        <div class="stat"><div class="stat__label">Commission</div>
          <div class="stat__value num">${money(entry?.commission || 0)}</div></div>
      </div>
      <div style="font-size:13px;color:var(--muted)">${esc(range.from)} → ${esc(range.to)}
        ${member.phone ? ` · ${esc(member.phone)}` : ''}</div>
      ${entry?.lines?.length ? `<div class="table-wrap"><table class="table">
        <thead><tr><th>When</th><th>Service</th><th class="r">Revenue</th><th class="r">Commission</th></tr></thead>
        <tbody>${entry.lines.map((l) => `<tr>
          <td style="white-space:nowrap">${esc(fmtDateTime(l.created_at))}</td>
          <td>${esc(l.service)}${l.qty > 1 ? ` ×${l.qty}` : ''}</td>
          <td class="r num">${money(l.line_total)}</td>
          <td class="r num">${money(l.commission_amount)}</td>
        </tr>`).join('')}</tbody></table></div>`
        : emptyState('No services in this period')}`,
  });
}

async function staffDialog(existing = null) {
  const saved = await openModal({
    title: existing ? 'Edit team member' : 'Add team member',
    submitLabel: existing ? 'Save' : 'Add',
    extraFoot: existing?.active
      ? '<button type="button" class="btn btn--danger" data-off>Mark inactive</button>' : '',
    body: `
      <label class="field"><span>Name</span>
        <input class="input" name="name" value="${esc(existing?.name || '')}" placeholder="e.g. Ama Mensah"></label>
      <div class="grid-2">
        <label class="field"><span>Role <em>optional</em></span>
          <input class="input" name="role" value="${esc(existing?.role || '')}" placeholder="Braider, Barber, Nail tech…"></label>
        <label class="field"><span>Phone <em>optional</em></span>
          <input class="input" name="phone" inputmode="tel" value="${esc(existing?.phone || '')}"></label>
      </div>
      <label class="field"><span>Commission rate <em>% of the services they perform</em></span>
        <input class="input num" name="rate" inputmode="decimal"
               value="${existing ? existing.commission_rate : state.settings.default_commission}"></label>
      ${existing && !existing.active
        ? '<label class="row" style="gap:8px"><input type="checkbox" name="reactivate"> <span>Make active again</span></label>' : ''}
      <p style="margin:0;font-size:12.5px;color:var(--muted)">Commission is worked out on each service line
        before any discount, using the rate at the time of the sale.</p>`,
    onMount(root, { close }) {
      const off = root.closest('.modal').querySelector('[data-off]');
      if (off) off.onclick = () => close('deactivate');
    },
    onSubmit(root) {
      const name = $('[name=name]', root).value.trim();
      if (!name) { toast('Name is required', 'err'); return false; }
      const rate = Number($('[name=rate]', root).value);
      if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
        toast('Commission must be between 0 and 100', 'err');
        return false;
      }
      const payload = {
        name,
        role: $('[name=role]', root).value.trim(),
        phone: $('[name=phone]', root).value.trim(),
        commissionRate: rate,
        active: existing ? (existing.active ? true : $('[name=reactivate]', root)?.checked) : true,
      };
      return existing
        ? api('PUT', `/api/staff/${existing.id}`, payload)
        : api('POST', '/api/staff', payload);
    },
  });

  if (!saved) return;

  if (saved === 'deactivate') {
    if (!(await confirmBox(
      `${existing.name} will no longer appear on the till. Past sales and commissions are kept.`,
      { title: 'Mark inactive', submitLabel: 'Mark inactive' },
    ))) return;
    try { await api('DELETE', `/api/staff/${existing.id}`); toast('Marked inactive', 'ok'); }
    catch (err) { return toastError(err); }
  } else {
    toast(existing ? 'Team member updated' : 'Team member added', 'ok');
  }

  await loadBootstrap();
  await draw();
}
