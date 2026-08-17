import { $, esc, money, paymentLabel, state } from './core.js';

const brand = () => state.settings.brand_color || '#b8283f';

/** "Afro & Sizy" -> "A&S";  "Glow Studio" -> "GS" */
export function monogram(name) {
  const words = String(name || 'Salon').split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
  const letters = words.slice(0, 3).map((w) => w[0].toUpperCase());
  return String(name).includes('&') && letters.length === 2 ? letters.join('&') : letters.join('') || 'S';
}

function stamp(value) {
  const [date, time = ''] = String(value).split(' ');
  const [y, m, d] = date.split('-').map(Number);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  if (!time) return `${d} ${months[m - 1]} ${y}`;
  const [hh, mm] = time.split(':').map(Number);
  return `${d} ${months[m - 1]} ${y} · ${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')}${hh >= 12 ? 'pm' : 'am'}`;
}

/* ------------------------------------------------------------ printable */

export function receiptHtml(sale) {
  const s = state.settings;
  const crest = s.logo_data
    ? `<img class="receipt__logo" src="${esc(s.logo_data)}" alt="">`
    : `<div class="receipt__badge">${esc(monogram(s.shop_name))}</div>`;

  const items = sale.items.map((it) => `
    <div class="receipt__item">
      <span>${esc(it.name)}${it.qty > 1 ? ` <b>×${it.qty}</b>` : ''}</span>
      <span class="receipt__dots"></span>
      <span class="receipt__amt">${esc(money(it.line_total))}</span>
    </div>
    ${it.staff_name ? `<div class="receipt__by">by ${esc(it.staff_name)}</div>` : ''}`).join('');

  const row = (label, value, cls = '') =>
    `<div class="receipt__row ${cls}"><span>${esc(label)}</span><span>${esc(value)}</span></div>`;

  return `
  <div class="receipt" style="--rb:${esc(brand())}">
    <div class="receipt__center">
      ${crest}
      <div class="receipt__shop">${esc(s.shop_name || 'Afro & Sizy')}</div>
      ${s.shop_tagline ? `<div class="receipt__sub">${esc(s.shop_tagline)}</div>` : ''}
      ${s.shop_address ? `<div class="receipt__sub">${esc(s.shop_address)}</div>` : ''}
      ${s.shop_phone ? `<div class="receipt__sub">Tel: ${esc(s.shop_phone)}</div>` : ''}
    </div>

    <div class="receipt__rule">◆</div>

    ${sale.status === 'voided' ? '<div class="receipt__void">VOIDED</div>' : ''}

    ${row('Receipt', sale.receipt_no, 'receipt__row--key')}
    ${row('Date', stamp(sale.created_at))}
    ${sale.customer_name ? row('Customer', sale.customer_name) : ''}

    <div class="receipt__label">Services</div>
    ${items}

    <div class="receipt__hr"></div>
    ${row('Subtotal', money(sale.subtotal))}
    ${sale.discount ? row(`Discount${sale.discount_reason ? ` · ${sale.discount_reason}` : ''}`, `−${money(sale.discount)}`) : ''}
    ${sale.points_discount ? row(`Loyalty · ${sale.points_redeemed} pts`, `−${money(sale.points_discount)}`) : ''}

    <div class="receipt__total"><span>TOTAL</span><span>${esc(money(sale.total))}</span></div>

    <div class="receipt__label">Payment</div>
    ${sale.payments.map((p) => row(
      paymentLabel(p.method) + (p.reference ? ` · ${p.reference}` : ''), money(p.amount))).join('')}
    ${sale.change_due ? row('Change', money(sale.change_due), 'receipt__row--key') : ''}

    ${sale.points_earned ? `<div class="receipt__pill">You earned ${sale.points_earned} loyalty points</div>` : ''}
    ${sale.note ? `<div class="receipt__by" style="padding:0;margin-top:5px">Note: ${esc(sale.note)}</div>` : ''}

    <div class="receipt__rule">◆</div>

    <div class="receipt__foot">
      ${s.receipt_footer ? `<div class="receipt__thanks">${esc(s.receipt_footer)}</div>` : ''}
      <div>Amounts in ${esc(s.currency_symbol || '₵')} (Ghana Cedi)</div>
      <div class="receipt__no">${esc(sale.receipt_no)}</div>
    </div>
  </div>`;
}

/** Renders into the hidden print slot and opens the browser print dialog. */
export async function printReceipt(sale) {
  const slot = $('#receipt-slot');
  slot.innerHTML = receiptHtml(sale);

  // The logo must be loaded before the print dialog opens or it prints blank.
  await Promise.all([...slot.querySelectorAll('img')].map((img) => img.complete
    ? null
    : new Promise((done) => {
      const timer = setTimeout(done, 3000);
      img.onload = img.onerror = () => { clearTimeout(timer); done(); };
    })));

  const cleanup = () => {
    window.removeEventListener('afterprint', cleanup);
    setTimeout(() => { slot.innerHTML = ''; }, 300);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
}

/* ------------------------------------------------------- receipt as image */

// 576 px is the dot width of an 80 mm thermal head, so the image matches the
// printed slip and still looks sharp when sent to a customer on WhatsApp.
const WIDTH = 576;
const PAD = 30;
const INK = '#141414';
const MUTED = '#767676';
const HAIR = '#c9c9c9';

const FONT = {
  shop: '800 36px "Segoe UI", Arial, sans-serif',
  badge: '800 34px "Segoe UI", Arial, sans-serif',
  body: '400 22px "Segoe UI", Arial, sans-serif',
  bold: '700 22px "Segoe UI", Arial, sans-serif',
  total: '800 30px "Segoe UI", Arial, sans-serif',
  label: '700 15px "Segoe UI", Arial, sans-serif',
  small: '400 19px "Segoe UI", Arial, sans-serif',
  mono: '400 17px Consolas, "Courier New", monospace',
};

function wrap(ctx, text, font, maxWidth) {
  ctx.font = font;
  const lines = [];
  let current = '';
  for (const word of String(text).split(/\s+/)) {
    const next = current ? `${current} ${word}` : word;
    if (ctx.measureText(next).width <= maxWidth || !current) current = next;
    else { lines.push(current); current = word; }
  }
  if (current) lines.push(current);
  return lines;
}

/**
 * Load events rather than decode(): a browser tab that is not painting can
 * defer decoding indefinitely, and a receipt must never hang on its logo.
 */
function loadLogo() {
  const src = state.settings.logo_data;
  if (!src) return Promise.resolve(null);
  return new Promise((resolve) => {
    const img = new Image();
    const timer = setTimeout(() => resolve(null), 3000);
    const settle = (value) => { clearTimeout(timer); resolve(value); };
    img.onload = () => settle(img.naturalWidth ? img : null);
    img.onerror = () => settle(null);
    img.src = src;
  });
}

/** Builds the draw list and the height it needs, without painting anything. */
function layout(sale, ctx, logo) {
  const s = state.settings;
  const inner = WIDTH - PAD * 2;
  const ops = [];
  let y = PAD;

  const text = (value, font, { align = 'left', lh = 28, colour = INK, spacing = '0px', indent = 0 } = {}) => {
    ops.push({ text: value, font, align, y, colour, spacing, indent });
    y += lh;
  };
  const row = (left, right, { font = FONT.body, lh = 28, colour = INK, rightFont } = {}) => {
    ops.push({ text: left, font, align: 'left', y, colour });
    ops.push({ text: right, font: rightFont || font, align: 'right', y, colour: INK });
    y += lh;
  };
  const hr = (gap = 12) => { y += gap; ops.push({ hr: true, y }); y += gap; };
  const flourish = (gap = 16) => { y += gap; ops.push({ flourish: true, y }); y += gap + 8; };
  const label = (value) => {
    y += 12;
    ops.push({ text: value.toUpperCase(), font: FONT.label, align: 'left', y, colour: MUTED, spacing: '2.5px' });
    y += 22;
    ops.push({ hr: true, y, faint: true });
    y += 12;
  };

  /* crest ---------------------------------------------------------------- */
  if (logo) {
    const scale = Math.min(240 / logo.naturalWidth, 132 / logo.naturalHeight, 1);
    const w = Math.round(logo.naturalWidth * scale);
    const h = Math.round(logo.naturalHeight * scale);
    ops.push({ image: logo, x: (WIDTH - w) / 2, y, w, h });
    y += h + 14;
  } else {
    const size = 96;
    ops.push({ badge: monogram(s.shop_name), x: (WIDTH - size) / 2, y, size });
    y += size + 14;
  }

  text(s.shop_name || 'Afro & Sizy', FONT.shop, { align: 'center', lh: 46, colour: brand(), spacing: '3px' });
  for (const detail of [s.shop_tagline, s.shop_address, s.shop_phone ? `Tel: ${s.shop_phone}` : '']) {
    if (detail) text(detail, FONT.small, { align: 'center', lh: 25, colour: MUTED });
  }

  flourish();

  if (sale.status === 'voided') {
    ops.push({ voided: true, y });
    y += 62;
  }

  /* meta ----------------------------------------------------------------- */
  row('Receipt', sale.receipt_no, { rightFont: FONT.bold });
  row('Date', stamp(sale.created_at), { colour: MUTED });
  if (sale.customer_name) row('Customer', sale.customer_name, { colour: MUTED });

  /* services ------------------------------------------------------------- */
  label('Services');
  for (const it of sale.items) {
    const amount = money(it.line_total);
    ctx.font = FONT.body;
    const amountWidth = ctx.measureText(amount).width;
    const name = it.qty > 1 ? `${it.name} ×${it.qty}` : it.name;
    const lines = wrap(ctx, name, FONT.body, inner - amountWidth - 40);

    lines.forEach((part, i) => {
      ops.push({ text: part, font: FONT.body, align: 'left', y });
      if (i === lines.length - 1) {
        ctx.font = FONT.body;
        ops.push({ leader: true, y: y + 15, from: PAD + ctx.measureText(part).width + 8, to: WIDTH - PAD - amountWidth - 8 });
        ops.push({ text: amount, font: FONT.body, align: 'right', y });
      }
      y += 28;
    });
    if (it.staff_name) text(`by ${it.staff_name}`, FONT.small, { lh: 24, colour: MUTED, indent: 16 });
  }

  /* totals --------------------------------------------------------------- */
  hr();
  row('Subtotal', money(sale.subtotal), { colour: MUTED });
  if (sale.discount) {
    row(`Discount${sale.discount_reason ? ` · ${sale.discount_reason}` : ''}`,
      `−${money(sale.discount)}`, { colour: MUTED });
  }
  if (sale.points_discount) {
    row(`Loyalty · ${sale.points_redeemed} pts`, `−${money(sale.points_discount)}`, { colour: MUTED });
  }

  y += 10;
  ops.push({ band: { label: 'TOTAL', amount: money(sale.total) }, y });
  y += 68;

  /* payment -------------------------------------------------------------- */
  label('Payment');
  for (const p of sale.payments) {
    row(paymentLabel(p.method) + (p.reference ? ` · ${p.reference}` : ''), money(p.amount), { colour: MUTED });
  }
  if (sale.change_due) row('Change', money(sale.change_due), { font: FONT.bold });

  if (sale.points_earned) {
    y += 12;
    ops.push({ pill: `You earned ${sale.points_earned} loyalty points`, y });
    y += 50;
  }
  if (sale.note) {
    y += 6;
    for (const part of wrap(ctx, `Note: ${sale.note}`, FONT.small, inner)) {
      text(part, FONT.small, { lh: 24, colour: MUTED });
    }
  }

  flourish();

  if (s.receipt_footer) {
    for (const part of wrap(ctx, s.receipt_footer, FONT.body, inner)) {
      text(part, FONT.body, { align: 'center', lh: 28, colour: brand() });
    }
  }
  text(`Amounts in ${s.currency_symbol || '₵'} (Ghana Cedi)`, FONT.small, { align: 'center', lh: 26, colour: MUTED });
  text(sale.receipt_no, FONT.mono, { align: 'center', lh: 24, colour: HAIR, spacing: '3px' });

  return { ops, height: y + PAD };
}

function paint(ctx, op) {
  if (op.hr) {
    ctx.strokeStyle = op.faint ? '#e2e2e2' : HAIR;
    ctx.lineWidth = 1;
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(PAD, op.y + 0.5);
    ctx.lineTo(WIDTH - PAD, op.y + 0.5);
    ctx.stroke();
    return;
  }

  if (op.flourish) {
    const mid = WIDTH / 2;
    ctx.strokeStyle = brand();
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD, op.y + 0.5); ctx.lineTo(mid - 16, op.y + 0.5);
    ctx.moveTo(mid + 16, op.y + 0.5); ctx.lineTo(WIDTH - PAD, op.y + 0.5);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = brand();
    ctx.beginPath();
    ctx.moveTo(mid, op.y - 5); ctx.lineTo(mid + 5, op.y);
    ctx.lineTo(mid, op.y + 5); ctx.lineTo(mid - 5, op.y);
    ctx.closePath();
    ctx.fill();
    return;
  }

  if (op.leader) {
    ctx.fillStyle = '#d2d2d2';
    for (let x = op.from; x < op.to; x += 6) ctx.fillRect(x, op.y, 2, 2);
    return;
  }

  if (op.image) {
    ctx.drawImage(op.image, op.x, op.y, op.w, op.h);
    return;
  }

  if (op.badge) {
    ctx.fillStyle = brand();
    ctx.beginPath();
    ctx.roundRect(op.x, op.y, op.size, op.size, 26);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = FONT.badge;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(op.badge, op.x + op.size / 2, op.y + op.size / 2 + 2);
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';
    return;
  }

  if (op.band) {
    ctx.fillStyle = brand();
    ctx.beginPath();
    ctx.roundRect(PAD, op.y, WIDTH - PAD * 2, 56, 10);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.font = FONT.total;
    ctx.letterSpacing = '3px';
    ctx.textAlign = 'left';
    ctx.fillText(op.band.label, PAD + 20, op.y + 14);
    ctx.letterSpacing = '0px';
    ctx.textAlign = 'right';
    ctx.fillText(op.band.amount, WIDTH - PAD - 20, op.y + 14);
    ctx.textAlign = 'left';
    return;
  }

  if (op.pill) {
    ctx.strokeStyle = brand();
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.roundRect(PAD + 0.5, op.y + 0.5, WIDTH - PAD * 2 - 1, 40, 20);
    ctx.stroke();
    ctx.fillStyle = brand();
    ctx.font = FONT.small;
    ctx.textAlign = 'center';
    ctx.fillText(op.pill, WIDTH / 2, op.y + 10);
    ctx.textAlign = 'left';
    return;
  }

  if (op.voided) {
    ctx.strokeStyle = brand();
    ctx.lineWidth = 2.5;
    ctx.strokeRect(PAD + 1, op.y + 1, WIDTH - PAD * 2 - 2, 46);
    ctx.fillStyle = brand();
    ctx.font = FONT.bold;
    ctx.letterSpacing = '6px';
    ctx.textAlign = 'center';
    ctx.fillText('VOIDED', WIDTH / 2, op.y + 13);
    ctx.letterSpacing = '0px';
    ctx.textAlign = 'left';
    return;
  }

  ctx.font = op.font;
  ctx.letterSpacing = op.spacing || '0px';
  ctx.fillStyle = op.colour || INK;
  ctx.textAlign = op.align === 'center' ? 'center' : op.align;
  const x = op.align === 'center' ? WIDTH / 2
    : op.align === 'right' ? WIDTH - PAD
    : PAD + (op.indent || 0);
  ctx.fillText(op.text, x, op.y);
  ctx.letterSpacing = '0px';
  ctx.textAlign = 'left';
}

/** Paints the receipt onto a canvas sized to its content. */
export async function receiptCanvas(sale) {
  const logo = await loadLogo();
  const measure = document.createElement('canvas').getContext('2d');
  const { ops, height } = layout(sale, measure, logo);

  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, WIDTH, height);
  // A thin brand rule down the left edge, the way the salon sign is framed.
  ctx.fillStyle = brand();
  ctx.fillRect(0, 0, 8, height);
  ctx.textBaseline = 'top';

  for (const op of ops) paint(ctx, op);
  return canvas;
}

const slug = (value) =>
  String(value || 'receipt').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/** Saves the receipt as a PNG the salon can send to the customer. */
export async function downloadReceipt(sale) {
  const canvas = await receiptCanvas(sale);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('Could not create the receipt image');

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${slug(state.settings.shop_name)}-receipt-${sale.receipt_no}.png`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
