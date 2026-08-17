import { get, readSettings } from '../db.js';
import { asInt } from '../http.js';
import { loadSale } from './sales.js';

const PAYMENT_LABELS = {
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

function prettyStamp(stamp) {
  const [date, time = ''] = String(stamp).split(' ');
  const [y, m, d] = date.split('-').map(Number);
  if (!time) return `${d} ${MONTHS[m - 1]} ${y}`;
  const [hh, mm] = time.split(':').map(Number);
  const clock = `${((hh + 11) % 12) + 1}:${String(mm).padStart(2, '0')}${hh >= 12 ? 'pm' : 'am'}`;
  return `${d} ${MONTHS[m - 1]} ${y}, ${clock}`;
}

/** The message body. WhatsApp renders *text* as bold. */
export function whatsappText(sale) {
  const s = readSettings();
  const symbol = s.currency_symbol || '₵';
  const cash = (minor) =>
    symbol + (minor / 100).toLocaleString('en-GB', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const lines = [`*${s.shop_name || 'Afro & Sizy'}*`];
  if (s.shop_tagline) lines.push(s.shop_tagline);
  if (s.shop_address) lines.push(s.shop_address);
  if (s.shop_phone) lines.push(`Tel: ${s.shop_phone}`);
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
    const customer = sale.customer_id
      ? get('SELECT points FROM customers WHERE id = ?', sale.customer_id)
      : null;
    lines.push('');
    lines.push(`You earned ${sale.points_earned} loyalty points${
      customer ? ` — balance ${customer.points}` : ''}.`);
  }

  if (s.receipt_footer) {
    lines.push('');
    lines.push(s.receipt_footer);
  }

  return lines.join('\n');
}

export function whatsappUrl(sale) {
  const customer = sale.customer_id
    ? get('SELECT phone FROM customers WHERE id = ?', sale.customer_id)
    : null;
  const phone = intlPhone(customer?.phone);
  // No saved number: wa.me without one opens WhatsApp's own contact picker.
  return `https://wa.me/${phone}?text=${encodeURIComponent(whatsappText(sale))}`;
}

export const routes = [
  // Redirects rather than returning JSON so the till can use a plain link —
  // no popup blocker, works the same from a table row or a dialog.
  ['GET', '/api/sales/:id/whatsapp', ({ params, res }) => {
    const sale = loadSale(asInt(params.id, 'Sale'));
    res.writeHead(302, { location: whatsappUrl(sale), 'cache-control': 'no-store' });
    res.end();
  }],

  // Lets the till preview the exact message before sending.
  ['GET', '/api/sales/:id/whatsapp.json', ({ params }) => {
    const sale = loadSale(asInt(params.id, 'Sale'));
    return { text: whatsappText(sale), url: whatsappUrl(sale) };
  }],
];
