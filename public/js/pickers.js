import {
  $, $$, api, apiGet, debounce, esc, fmtDuration, icon, initials, money, openModal, state, toast,
} from './core.js';

/** Search / create a customer. Resolves with the customer row, or null. */
export function pickCustomer({ title = 'Attach customer' } = {}) {
  return openModal({
    title,
    hideSubmit: true,
    cancelLabel: 'Close',
    body: `
      <div class="picker__search">
        ${icon('search')}
        <input class="input" data-q placeholder="Search by name or phone…" autocomplete="off">
      </div>
      <div class="picklist" data-list><div class="empty">Loading…</div></div>
      <button type="button" class="btn btn--brand btn--block" data-new>${icon('plus')} New customer</button>`,
    onMount(root, { close }) {
      const list = $('[data-list]', root);

      const draw = (rows) => {
        list.innerHTML = rows.length
          ? rows.map((c) => `
            <button type="button" class="picklist__item" data-id="${c.id}">
              <span class="avatar">${esc(initials(c.name))}</span>
              <span style="flex:1;min-width:0">
                <strong>${esc(c.name)}</strong>
                <small>${esc(c.phone || 'No phone')} · ${c.visits || 0} visit${c.visits === 1 ? '' : 's'}${
                  c.points ? ` · ${c.points} pts` : ''}</small>
              </span>
              <span class="num" style="color:var(--muted);font-size:12.5px">${money(c.spent || 0)}</span>
            </button>`).join('')
          : '<div class="empty">No customer found. Use “New customer” below.</div>';

        $$('[data-id]', list).forEach((btn) => {
          btn.onclick = () => close(rows.find((c) => c.id === Number(btn.dataset.id)));
        });
      };

      const search = async (q) => {
        try {
          draw(await apiGet(`/api/customers?limit=40&q=${encodeURIComponent(q)}`));
        } catch (err) {
          list.innerHTML = `<div class="empty">${esc(err.message)}</div>`;
        }
      };

      const input = $('[data-q]', root);
      input.addEventListener('input', debounce(() => search(input.value.trim()), 220));
      search('');

      $('[data-new]', root).onclick = async () => {
        const created = await newCustomerDialog(input.value.trim());
        if (created) close(created);
      };
    },
  });
}

/** Create a customer. `prefill` may be a name or a phone number. */
export function newCustomerDialog(prefill = '') {
  const looksLikePhone = /^[\d+][\d\s\-()]{5,}$/.test(prefill);
  return openModal({
    title: 'New customer',
    submitLabel: 'Add customer',
    body: `
      <label class="field"><span>Name</span>
        <input class="input" name="name" value="${esc(looksLikePhone ? '' : prefill)}" placeholder="e.g. Adwoa Mensah"></label>
      <label class="field"><span>Phone <em>optional</em></span>
        <input class="input" name="phone" inputmode="tel" value="${esc(looksLikePhone ? prefill : '')}" placeholder="0554 143 335"></label>
      <label class="field"><span>Notes <em>optional</em></span>
        <textarea class="textarea" name="notes" placeholder="Hair type, allergies, preferred stylist…"></textarea></label>`,
    async onSubmit(root) {
      const name = $('[name=name]', root).value.trim();
      if (!name) { toast('Enter the customer name', 'err'); return false; }
      return api('POST', '/api/customers', {
        name,
        phone: $('[name=phone]', root).value.trim(),
        notes: $('[name=notes]', root).value.trim(),
      });
    },
  });
}

/** Multi-select service chooser. Resolves with an array of service rows. */
export function pickServices({ title = 'Choose services', selected = [] } = {}) {
  const chosen = new Map(selected.map((s) => [s.id, s]));

  return openModal({
    title,
    wide: true,
    submitLabel: 'Add selected',
    body: `
      <div class="picker__search">${icon('search')}
        <input class="input" data-q placeholder="Search services…" autocomplete="off"></div>
      <div class="picklist" data-list style="max-height:min(52dvh,420px)"></div>
      <div data-count style="font-size:13px;color:var(--muted)"></div>`,
    onMount(root) {
      const list = $('[data-list]', root);
      const count = $('[data-count]', root);
      const input = $('[data-q]', root);

      const draw = () => {
        const q = input.value.trim().toLowerCase();
        const rows = state.services.filter(
          (s) => !q || s.name.toLowerCase().includes(q) || s.category.toLowerCase().includes(q),
        );
        list.innerHTML = rows.length
          ? rows.map((s) => `
            <button type="button" class="picklist__item" data-id="${s.id}"
              style="${chosen.has(s.id) ? 'background:var(--brand-soft)' : ''}">
              <span style="flex:1;min-width:0">
                <strong>${esc(s.name)}</strong>
                <small>${esc(s.category)} · ${fmtDuration(s.duration_min)}</small>
              </span>
              <span class="num" style="font-weight:650">${money(s.price)}</span>
              <span style="color:var(--brand);width:20px">${chosen.has(s.id) ? icon('check', 18) : ''}</span>
            </button>`).join('')
          : '<div class="empty">No matching service.</div>';

        $$('[data-id]', list).forEach((btn) => {
          btn.onclick = () => {
            const id = Number(btn.dataset.id);
            if (chosen.has(id)) chosen.delete(id);
            else chosen.set(id, state.services.find((s) => s.id === id));
            draw();
          };
        });
        count.textContent = chosen.size
          ? `${chosen.size} selected · ${money([...chosen.values()].reduce((t, s) => t + s.price, 0))}`
          : 'Nothing selected yet.';
      };

      input.addEventListener('input', draw);
      draw();
    },
    onSubmit() {
      if (!chosen.size) { toast('Pick at least one service', 'err'); return false; }
      return [...chosen.values()];
    },
  });
}
