import {
  $, $$, api, apiGet, confirmBox, emptyState, esc, fmtDuration, icon, loadBootstrap, money,
  openModal, parseMoney, state, toast, toastError,
} from './core.js';
import { monogram, receiptCanvas } from './receipt.js';

let ui = null;
let catFilter = 'all';

export async function render(container, context) {
  ui = context;
  ui.setActions('');

  container.innerHTML = `
    <div class="grid-2" style="align-items:start;margin-bottom:14px">
      <div class="card"><div class="card__head"><h2>Salon details</h2></div>
        <div class="card__body" id="shop-form"></div></div>
      <div style="display:flex;flex-direction:column;gap:14px">
        <div class="card"><div class="card__head"><h2>Loyalty &amp; commission</h2></div>
          <div class="card__body" id="loyalty-form"></div></div>
        <div class="card"><div class="card__head"><h2>Till lock</h2></div>
          <div class="card__body" id="pin-form"></div></div>
      </div>
    </div>

    <div class="card" style="margin-bottom:14px">
      <div class="card__head">
        <h2>Service menu</h2>
        <span class="spacer"></span>
        <button class="btn btn--sm" data-reprice>Adjust prices</button>
        <button class="btn btn--sm" data-newcat>${icon('plus', 15)} Category</button>
        <button class="btn btn--brand btn--sm" data-newsvc>${icon('plus', 15)} Service</button>
      </div>
      <div class="card__body" style="padding-bottom:0">
        <div class="picker__cats" id="setup-cats"></div>
      </div>
      <div class="card__body card__body--flush" id="svc-table"></div>
    </div>

    <div class="card"><div class="card__head"><h2>Your data</h2></div>
      <div class="card__body" style="display:flex;flex-direction:column;gap:12px">
        <p style="margin:0;color:var(--ink-2);font-size:14px">
          Everything is stored in a single file on this computer — no internet needed. Download a backup
          regularly and keep a copy somewhere safe (a USB stick or a phone).</p>
        <div class="row">
          <a class="btn btn--brand" href="/api/backup" download>${icon('download', 16)} Download backup</a>
          <a class="btn" href="/api/export/sales.csv?from=2000-01-01&to=2099-12-31" download>${icon('download', 16)} All sales (CSV)</a>
          <a class="btn" href="/api/export/commissions.csv?from=2000-01-01&to=2099-12-31" download>${icon('download', 16)} All commissions (CSV)</a>
        </div>
      </div></div>`;

  container.onclick = onClick;
  drawShopForm();
  drawLoyaltyForm();
  drawPinForm();
  await drawCatalogue();
}

/* ------------------------------------------------------------- settings */

function field(name, label, value, { type = 'text', hint = '', mode = '' } = {}) {
  return `<label class="field"><span>${esc(label)}${hint ? ` <em>${esc(hint)}</em>` : ''}</span>
    <input class="input" name="${name}" type="${type}" ${mode ? `inputmode="${mode}"` : ''}
      value="${esc(value ?? '')}"></label>`;
}

function drawShopForm() {
  const s = state.settings;
  $('#shop-form').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px">
      ${field('shop_name', 'Salon name', s.shop_name)}
      ${field('shop_tagline', 'Tagline', s.shop_tagline, { hint: 'shown on receipts' })}
      <div class="grid-2">
        ${field('shop_phone', 'Phone', s.shop_phone, { mode: 'tel' })}
        ${field('currency_symbol', 'Currency symbol', s.currency_symbol)}
      </div>
      ${field('shop_address', 'Address', s.shop_address, { hint: 'optional' })}
      ${field('receipt_footer', 'Receipt footer', s.receipt_footer)}

      <div class="field"><span>Receipt look <em>logo and colour</em></span>
        <div class="brandbar">
          <div class="brandbar__crest">
            ${s.logo_data
              ? `<img src="${esc(s.logo_data)}" alt="Salon logo">`
              : `<span class="brandbar__mono" style="background:${esc(s.brand_color || '#b8283f')}">${esc(monogram(s.shop_name))}</span>`}
          </div>
          <div class="brandbar__side">
            <input type="file" accept="image/png,image/jpeg,image/webp" hidden data-logo-file>
            <div class="row row--tight">
              <button type="button" class="btn btn--sm" data-logo-pick>
                ${icon('plus', 15)} ${s.logo_data ? 'Replace logo' : 'Upload logo'}</button>
              ${s.logo_data ? '<button type="button" class="btn btn--sm" data-logo-clear>Remove</button>' : ''}
            </div>
            <label class="row row--tight" style="margin-top:8px">
              <input class="swatch" type="color" name="brand_color" value="${esc(s.brand_color || '#b8283f')}">
              <span style="font-size:12.5px;color:var(--muted)">Receipt colour</span>
            </label>
            <p style="margin:8px 0 0;font-size:12px;color:var(--muted)">
              No logo? The salon initials are used instead. Thermal printers print in black,
              so colour shows on the downloaded image and on A4.</p>
          </div>
        </div>
      </div>

      <div class="grid-2">
        ${field('open_hour', 'Opens at (24h)', s.open_hour, { mode: 'numeric' })}
        ${field('close_hour', 'Closes at (24h)', s.close_hour, { mode: 'numeric' })}
      </div>
      <div class="row">
        <button class="btn btn--brand" data-save="shop">Save salon details</button>
        <button class="btn" data-preview-receipt>${icon('print', 16)} Preview receipt</button>
      </div>
    </div>`;

  $('[data-logo-pick]').onclick = () => $('[data-logo-file]').click();
  $('[data-logo-file]').onchange = (e) => useLogo(e.target.files[0]);
  const clear = $('[data-logo-clear]');
  if (clear) clear.onclick = () => removeLogo();
}

/** Shrinks whatever they picked to something a receipt can carry. */
function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not an image'));
      img.onload = () => {
        const scale = Math.min(480 / img.width, 240 / img.height, 1);
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);

        // Flat logos stay PNG so transparency survives; the threshold is low
        // enough that a photo of the signboard falls through to JPEG.
        const png = canvas.toDataURL('image/png');
        if (png.length <= 90_000) return resolve(png);
        // Photographs (a picture of the signboard) compress far better as JPEG.
        const flat = document.createElement('canvas');
        flat.width = canvas.width;
        flat.height = canvas.height;
        const ctx = flat.getContext('2d');
        ctx.fillStyle = '#fff';
        ctx.fillRect(0, 0, flat.width, flat.height);
        ctx.drawImage(canvas, 0, 0);
        resolve(flat.toDataURL('image/jpeg', 0.85));
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

async function useLogo(file) {
  if (!file) return;
  if (file.size > 8_000_000) return toast('That image is too big — keep it under 8 MB', 'err');
  try {
    const dataUrl = await shrinkImage(file);
    if (await saveSettings({ logo_data: dataUrl }, 'Logo saved')) drawShopForm();
  } catch (err) {
    toastError(err);
  }
}

async function removeLogo() {
  if (!(await confirmBox('The salon initials will be shown on receipts instead.',
    { title: 'Remove the logo?', submitLabel: 'Remove' }))) return;
  if (await saveSettings({ logo_data: '' }, 'Logo removed')) drawShopForm();
}

/** Renders a made-up sale so they can see the styling before printing anything. */
async function previewReceipt() {
  const sample = {
    id: 0,
    receipt_no: '20260816-001',
    created_at: '2026-08-16 14:30:00',
    customer_name: 'Adwoa Serwaa Boateng',
    status: 'completed',
    subtotal: 46000, discount: 5000, discount_reason: 'Regular client',
    points_redeemed: 300, points_discount: 1500, total: 39500,
    change_due: 500, points_earned: 395, note: null,
    items: [
      { name: 'Knotless Braids (Medium)', qty: 1, line_total: 30000, staff_name: 'Ama Mensah' },
      { name: 'Gel Polish (Hands)', qty: 2, line_total: 16000, staff_name: 'Efua Danso' },
    ],
    payments: [
      { method: 'momo', amount: 30000, reference: 'MP2608.4471' },
      { method: 'cash', amount: 10000, reference: null },
    ],
  };

  await openModal({
    title: 'Receipt preview',
    hideSubmit: true,
    cancelLabel: 'Close',
    body: '<div data-shot style="display:flex;justify-content:center;background:#e9e5e6;padding:16px;border-radius:12px">Rendering…</div>',
    async onMount(root) {
      try {
        const canvas = await receiptCanvas(sample);
        canvas.style.cssText = 'width:100%;max-width:320px;height:auto;box-shadow:0 6px 24px -8px rgba(0,0,0,.4)';
        const host = $('[data-shot]', root);
        host.textContent = '';
        host.append(canvas);
      } catch (err) {
        $('[data-shot]', root).textContent = err.message;
      }
    },
  });
}

function drawLoyaltyForm() {
  const s = state.settings;
  const on = s.loyalty_enabled === '1';
  $('#loyalty-form').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px">
      <label class="row" style="gap:9px;cursor:pointer">
        <input type="checkbox" name="loyalty_enabled" ${on ? 'checked' : ''} style="width:18px;height:18px">
        <span style="font-weight:600">Collect loyalty points</span>
      </label>
      <div class="grid-2">
        ${field('points_per_cedi', 'Points earned', s.points_per_cedi, { mode: 'decimal', hint: `per ${s.currency_symbol}1 spent` })}
        ${field('points_per_cedi_redeem', 'Points needed', s.points_per_cedi_redeem, { mode: 'numeric', hint: `for ${s.currency_symbol}1 off` })}
      </div>
      <p style="margin:0;font-size:12.5px;color:var(--muted)" data-loyalty-hint></p>
      ${field('default_commission', 'Default commission rate (%)', s.default_commission, { mode: 'decimal', hint: 'for new team members' })}
      <button class="btn btn--brand" data-save="loyalty">Save loyalty settings</button>
    </div>`;
  updateLoyaltyHint();
  $$('#loyalty-form input').forEach((el) => el.addEventListener('input', updateLoyaltyHint));
}

function updateLoyaltyHint() {
  const earn = Number($('[name=points_per_cedi]').value) || 0;
  const redeem = Math.max(1, Number($('[name=points_per_cedi_redeem]').value) || 1);
  const back = (earn / redeem) * 100;
  $('[data-loyalty-hint]').textContent =
    `A ${state.settings.currency_symbol}100 sale earns ${Math.floor(100 * earn)} points, worth ` +
    `${state.settings.currency_symbol}${(Math.floor(100 * earn) / redeem).toFixed(2)} — about ${back.toFixed(1)}% back.`;
}

function drawPinForm() {
  const hasPin = state.settings.has_pin;
  $('#pin-form').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:12px">
      <p style="margin:0;color:var(--ink-2);font-size:14px">
        ${hasPin
          ? 'A PIN is set. Staff must enter it before taking payments or changing anything.'
          : 'Set a PIN so people on the salon WiFi cannot ring up sales on your till.'}</p>
      ${field('app_pin', hasPin ? 'New PIN' : 'PIN', '', { type: 'password', mode: 'numeric', hint: '4–8 digits' })}
      <div class="row">
        <button class="btn btn--brand" data-save="pin">${hasPin ? 'Change PIN' : 'Set PIN'}</button>
        ${hasPin ? '<button class="btn" data-save="pin-off">Turn lock off</button>' : ''}
      </div>
      <p style="margin:0;font-size:12.5px;color:var(--muted)">This is a simple staff lock for the salon network,
        not bank-grade security. Keep the computer itself protected too.</p>
    </div>`;
}

async function saveSettings(payload, message) {
  try {
    await api('PUT', '/api/settings', payload);
    await loadBootstrap();
    toast(message, 'ok');
    return true;
  } catch (err) {
    toastError(err);
    return false;
  }
}

/* ------------------------------------------------------------ catalogue */

async function drawCatalogue() {
  $('#setup-cats').innerHTML = [
    `<button class="chip${catFilter === 'all' ? ' is-active' : ''}" data-cat="all">All</button>`,
    ...state.categories.map((c) => `<button class="chip${catFilter === c.name ? ' is-active' : ''}"
      data-cat="${esc(c.name)}">${esc(c.name)}</button>`),
  ].join('');

  let services;
  try { services = await apiGet('/api/services?all=1'); }
  catch (err) { $('#svc-table').innerHTML = emptyState('Could not load services', err.message); return; }

  const rows = services.filter((s) => catFilter === 'all' || s.category === catFilter);
  $('#svc-table').innerHTML = rows.length ? `
    <div class="table-wrap"><table class="table">
      <thead><tr><th>Service</th><th>Category</th><th class="r">Price</th>
        <th class="r">Time</th><th></th></tr></thead>
      <tbody>${rows.map((s) => `
        <tr${s.active ? '' : ' style="opacity:.45"'}>
          <td><strong>${esc(s.name)}</strong>${s.active ? '' : ' <span class="tag">hidden</span>'}</td>
          <td style="color:var(--muted)">${esc(s.category)}</td>
          <td class="r num">${money(s.price)}</td>
          <td class="r num">${fmtDuration(s.duration_min)}</td>
          <td class="r"><button class="btn btn--sm" data-editsvc="${s.id}">${icon('edit', 15)}</button></td>
        </tr>`).join('')}</tbody>
    </table></div>` : emptyState('No services in this category');

  $('#svc-table').__services = services;
}

/* ---------------------------------------------------------------- events */

async function onClick(e) {
  const save = e.target.closest('[data-save]');
  if (save) return onSave(save.dataset.save);

  const cat = e.target.closest('[data-cat]');
  if (cat) { catFilter = cat.dataset.cat; return drawCatalogue(); }

  if (e.target.closest('[data-preview-receipt]')) return previewReceipt();
  if (e.target.closest('[data-newsvc]')) return serviceDialog();
  if (e.target.closest('[data-newcat]')) return categoryDialog();
  if (e.target.closest('[data-reprice]')) return repriceDialog();

  const edit = e.target.closest('[data-editsvc]');
  if (edit) {
    const svc = $('#svc-table').__services.find((s) => s.id === Number(edit.dataset.editsvc));
    if (svc) return serviceDialog(svc);
  }
}

async function onSave(which) {
  if (which === 'shop') {
    const payload = {};
    for (const name of ['shop_name', 'shop_tagline', 'shop_phone', 'currency_symbol',
      'shop_address', 'receipt_footer', 'open_hour', 'close_hour', 'brand_color']) {
      payload[name] = $(`[name=${name}]`).value.trim();
    }
    if (!payload.shop_name) return toast('The salon needs a name', 'err');
    if (await saveSettings(payload, 'Salon details saved')) {
      document.querySelector('#brand-name').textContent = payload.shop_name;
      document.querySelector('#brand-sub').textContent = payload.shop_tagline || 'Point of Sale';
      drawShopForm();
      drawLoyaltyForm();
    }
    return;
  }

  if (which === 'loyalty') {
    const payload = {
      loyalty_enabled: $('[name=loyalty_enabled]').checked ? '1' : '0',
      points_per_cedi: $('[name=points_per_cedi]').value.trim(),
      points_per_cedi_redeem: $('[name=points_per_cedi_redeem]').value.trim(),
      default_commission: $('[name=default_commission]').value.trim(),
    };
    if (await saveSettings(payload, 'Loyalty settings saved')) drawLoyaltyForm();
    return;
  }

  if (which === 'pin') {
    const pin = $('[name=app_pin]').value.trim();
    if (!/^\d{4,8}$/.test(pin)) return toast('Use 4 to 8 digits', 'err');
    if (await saveSettings({ app_pin: pin }, 'PIN saved — it will be asked for next time')) {
      sessionStorage.setItem('afro-sizy-pin', pin);
      drawPinForm();
    }
    return;
  }

  if (which === 'pin-off') {
    if (!(await confirmBox('Anyone on the salon network will be able to use the till.',
      { title: 'Turn the lock off?', submitLabel: 'Turn it off' }))) return;
    if (await saveSettings({ app_pin: '' }, 'Till lock turned off')) {
      sessionStorage.removeItem('afro-sizy-pin');
      drawPinForm();
    }
  }
}

/* --------------------------------------------------------------- dialogs */

async function serviceDialog(existing = null) {
  const saved = await openModal({
    title: existing ? 'Edit service' : 'New service',
    submitLabel: existing ? 'Save' : 'Add service',
    extraFoot: existing?.active
      ? '<button type="button" class="btn btn--danger" data-hide>Hide from till</button>' : '',
    body: `
      <label class="field"><span>Name</span>
        <input class="input" name="name" value="${esc(existing?.name || '')}" placeholder="e.g. Knotless Braids (Small)"></label>
      <label class="field"><span>Category</span>
        <select class="select" name="category">
          ${state.categories.map((c) => `<option value="${c.id}"${c.id === existing?.category_id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></label>
      <div class="grid-2">
        <label class="field"><span>Price</span>
          <input class="input num" name="price" inputmode="decimal"
                 value="${existing ? (existing.price / 100).toFixed(2) : ''}" placeholder="0.00"></label>
        <label class="field"><span>Time needed <em>minutes</em></span>
          <input class="input num" name="duration" inputmode="numeric" value="${existing?.duration_min ?? 60}"></label>
      </div>
      ${existing && !existing.active
        ? '<label class="row" style="gap:8px"><input type="checkbox" name="show" checked> <span>Show on the till again</span></label>' : ''}`,
    onMount(root, { close }) {
      const hide = root.closest('.modal').querySelector('[data-hide]');
      if (hide) hide.onclick = () => close('hide');
    },
    onSubmit(root) {
      const name = $('[name=name]', root).value.trim();
      const price = parseMoney($('[name=price]', root).value);
      if (!name) { toast('Give the service a name', 'err'); return false; }
      if (price === null) { toast('Enter a valid price', 'err'); return false; }
      const payload = {
        name,
        categoryId: Number($('[name=category]', root).value),
        price,
        durationMin: Number($('[name=duration]', root).value) || 60,
        active: existing ? (existing.active ? true : $('[name=show]', root)?.checked ?? true) : true,
      };
      return existing
        ? api('PUT', `/api/services/${existing.id}`, payload)
        : api('POST', '/api/services', payload);
    },
  });

  if (!saved) return;
  if (saved === 'hide') {
    try { await api('DELETE', `/api/services/${existing.id}`); toast('Hidden from the till', 'ok'); }
    catch (err) { return toastError(err); }
  } else {
    toast(existing ? 'Service updated' : 'Service added', 'ok');
  }
  await loadBootstrap();
  await drawCatalogue();
}

async function categoryDialog() {
  const saved = await openModal({
    title: 'New category',
    submitLabel: 'Add category',
    body: `<label class="field"><span>Name</span>
      <input class="input" name="name" placeholder="e.g. Kids"></label>`,
    onSubmit(root) {
      const name = $('[name=name]', root).value.trim();
      if (!name) { toast('Give the category a name', 'err'); return false; }
      return api('POST', '/api/categories', { name });
    },
  });
  if (!saved) return;
  toast('Category added', 'ok');
  await loadBootstrap();
  await drawCatalogue();
}

async function repriceDialog() {
  const result = await openModal({
    title: 'Adjust prices',
    submitLabel: 'Apply',
    body: `
      <p style="margin:0;color:var(--ink-2)">Raise or lower every price at once. Use a negative number to cut prices.</p>
      <div class="grid-2">
        <label class="field"><span>Change by (%)</span>
          <input class="input num" name="percent" inputmode="decimal" placeholder="e.g. 10"></label>
        <label class="field"><span>Apply to</span>
          <select class="select" name="cat">
            <option value="">Every service</option>
            ${state.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
          </select></label>
      </div>
      <p style="margin:0;font-size:12.5px;color:var(--muted)">Past sales keep the price they were sold at.</p>`,
    onSubmit(root) {
      const percent = Number($('[name=percent]', root).value);
      if (!Number.isFinite(percent) || percent === 0) { toast('Enter a percentage', 'err'); return false; }
      return api('POST', '/api/services/reprice', {
        percent,
        categoryId: $('[name=cat]', root).value || null,
      });
    },
  });
  if (!result) return;
  toast(`${result.updated} price${result.updated === 1 ? '' : 's'} updated`, 'ok');
  await loadBootstrap();
  await drawCatalogue();
}
