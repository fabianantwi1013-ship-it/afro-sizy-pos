// Pure receipt-to-message helpers. No database, no Node APIs — the real till
// and the browser demo both build the WhatsApp message from this one file.

export const PAYMENT_LABELS = {
  cash: 'Cash',
  momo: 'Mobile Money',
  card: 'Card',
  bank: 'Bank transfer',
  other: 'Other',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Ghana-first phone normalisation for wa.me links.
 * "024 111 2222" -> "233241112222";  "+44 7700 900123" -> "447700900123".
 * A bare local number starting with 0 gets the Ghana code; anything already
 * carrying a country code is left alone.
 */
export function intlPhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return '';
  if (digits.startsWith('233')) return digits;
  if (digits.startsWith('0')) return `233${digits.slice(1)}`;
  if (digits.length === 9) return `233${digits}`;
  return digits;
}

export function prettyStamp(stamp) {
  const [date, time = ''] = String(stamp).split(' ');
  const [y, m, d] = date.split('-').map(Number);
  if (!time) return `${d} ${MONTHS[m - 1]} ${y}`;
  const [hh, mm] = time.split(':').map(Number);
  const clock = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')}${hh >= 12 ? 'pm' : 'am'}`;
  return `${d} ${MONTHS[m - 1]} ${y}, ${clock}`;
}

/** The message body. WhatsApp renders *text* as bold. */
export function whatsappText(sale, settings, { customerPoints = null } = {}) {
  const symbol = settings.currency_symbol || '₵';
  const cash = (minor) =>
    symbol + (minor / 100).toLocaleString('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const lines = [`*${settings.shop_name || 'Afro & Sizy'}*`];
  if (settings.shop_tagline) lines.push(settings.shop_tagline);
  if (settings.shop_address) lines.push(settings.shop_address);
  if (settings.shop_phone) lines.push(`Tel: ${settings.shop_phone}`);
  lines.push('');

  const firstName = (sale.customer_name || '').trim().split(/\s+/)[0];
  lines.push(firstName
    ? `Hi ${firstName}, thank you for coming in. Here is your receipt.`
    : 'Thank you for your visit. Here is your receipt.');
  lines.push('');

  lines.push(`Receipt *${sale.receipt_no}*`);
  lines.push(prettyStamp(sale.created_at));
  if (sale.status === 'voided') lines.push('*THIS SALE HAS BEEN VOIDED*');
  lines.push('');

  for (const it of sale.items) {
    lines.push(`${it.name}${it.qty > 1 ? ` x${it.qty}` : ''} - ${cash(it.line_total)}`);
  }
  lines.push('');

  if (sale.discount || sale.points_discount) {
    lines.push(`Subtotal: ${cash(sale.subtotal)}`);
    if (sale.discount) {
      lines.push(`Discount${sale.discount_reason ? ` (${sale.discount_reason})` : ''}: -${cash(sale.discount)}`);
    }
    if (sale.points_discount) {
      lines.push(`Loyalty (${sale.points_redeemed} pts): -${cash(sale.points_discount)}`);
    }
  }
  lines.push(`*Total: ${cash(sale.total)}*`);

  const paid = sale.payments.map((p) => `${PAYMENT_LABELS[p.method] || p.method} ${cash(p.amount)}`);
  if (paid.length) lines.push(`Paid by ${paid.join(', ')}`);
  if (sale.change_due) lines.push(`Change: ${cash(sale.change_due)}`);

  if (sale.points_earned) {
    lines.push('');
    lines.push(`You earned ${sale.points_earned} loyalty points${
      customerPoints === null ? '' : ` — balance ${customerPoints}`}.`);
  }

  if (settings.receipt_footer) {
    lines.push('');
    lines.push(settings.receipt_footer);
  }

  return lines.join('\n');
}

export function whatsappUrl(sale, settings, { phone = '', customerPoints = null } = {}) {
  // No saved number: wa.me without one opens WhatsApp's own contact picker.
  return `https://wa.me/${intlPhone(phone)}?text=${
    encodeURIComponent(whatsappText(sale, settings, { customerPoints }))}`;
}

/* ------------------------------------------------------------------- CSV */

export function csvEscape(value) {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers, rows) {
  const lines = [headers.map(csvEscape).join(',')];
  for (const row of rows) lines.push(row.map(csvEscape).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}
