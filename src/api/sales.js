import { all, get, run, tx, nowLocal, readSettings } from '../db.js';
import { asInt, asStr, bad, notFound } from '../http.js';
import { upsertCustomer } from './customers.js';

export const PAYMENT_METHODS = ['cash', 'momo', 'card', 'bank', 'other'];

export function loadSale(id) {
  const sale = get('SELECT * FROM sales WHERE id = ?', id);
  if (!sale) notFound('Sale not found');
  return {
    ...sale,
    items: all('SELECT * FROM sale_items WHERE sale_id = ? ORDER BY id', id),
    payments: all('SELECT * FROM sale_payments WHERE sale_id = ? ORDER BY id', id),
  };
}

function nextReceiptNo() {
  const stamp = nowLocal().slice(0, 10).replace(/-/g, '');
  const { n } = get(
    "SELECT COUNT(*) AS n FROM sales WHERE receipt_no LIKE ?",
    `${stamp}-%`,
  );
  let seq = n + 1;
  let candidate = `${stamp}-${String(seq).padStart(3, '0')}`;
  while (get('SELECT id FROM sales WHERE receipt_no = ?', candidate)) {
    seq += 1;
    candidate = `${stamp}-${String(seq).padStart(3, '0')}`;
  }
  return candidate;
}

function buildItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) bad('Add at least one service to the sale');
  if (rawItems.length > 60) bad('Too many lines on one sale');

  return rawItems.map((raw, i) => {
    const label = `Line ${i + 1}`;
    const serviceId = raw.serviceId ? asInt(raw.serviceId, `${label} service`) : null;
    const service = serviceId
      ? get(
          `SELECT s.*, c.name AS category FROM services s
             JOIN categories c ON c.id = s.category_id WHERE s.id = ?`,
          serviceId,
        )
      : null;

    const name = asStr(raw.name ?? service?.name, `${label} name`, { max: 120 });
    const unitPrice = asInt(raw.unitPrice ?? service?.price, `${label} price`, {
      min: 0,
      max: 100_000_000,
    });
    const qty = asInt(raw.qty ?? 1, `${label} quantity`, { min: 1, max: 99 });

    const staffId = raw.staffId ? asInt(raw.staffId, `${label} staff`) : null;
    const staff = staffId ? get('SELECT * FROM staff WHERE id = ?', staffId) : null;
    if (staffId && !staff) bad(`${label}: unknown staff member`);

    const lineTotal = unitPrice * qty;
    const rate = staff ? Number(staff.commission_rate) : 0;
    return {
      service_id: service?.id ?? null,
      name,
      category: raw.category ?? service?.category ?? null,
      unit_price: unitPrice,
      qty,
      line_total: lineTotal,
      staff_id: staff?.id ?? null,
      staff_name: staff?.name ?? null,
      commission_rate: rate,
      commission_amount: Math.round((lineTotal * rate) / 100),
    };
  });
}

function buildPayments(rawPayments, total) {
  if (total === 0 && (!Array.isArray(rawPayments) || rawPayments.length === 0)) return [];
  if (!Array.isArray(rawPayments) || rawPayments.length === 0) bad('Record how the customer paid');
  if (rawPayments.length > 4) bad('At most 4 payment methods per sale');

  return rawPayments.map((p, i) => {
    const method = asStr(p.method, `Payment ${i + 1} method`, { max: 20 }).toLowerCase();
    if (!PAYMENT_METHODS.includes(method)) bad(`Unknown payment method "${method}"`);
    return {
      method,
      amount: asInt(p.amount, `Payment ${i + 1} amount`, { min: 0, max: 1_000_000_000 }),
      reference: asStr(p.reference, `Payment ${i + 1} reference`, { max: 60, optional: true }),
    };
  });
}

export function createSale(body) {
  const settings = readSettings();
  const loyaltyOn = settings.loyalty_enabled === '1';
  const earnRate = Number(settings.points_per_cedi) || 0;
  const redeemRate = Math.max(1, Number(settings.points_per_cedi_redeem) || 20);

  const items = buildItems(body.items);
  const subtotal = items.reduce((sum, it) => sum + it.line_total, 0);

  return tx(() => {
    let customer = null;
    if (body.customerId) {
      customer = upsertCustomer({ id: body.customerId });
    } else if (body.newCustomer?.name) {
      customer = upsertCustomer(body.newCustomer);
    }

    let discount = asInt(body.discount ?? 0, 'Discount', { min: 0, max: 1_000_000_000 });
    if (discount > subtotal) discount = subtotal;

    let pointsRedeemed = 0;
    let pointsDiscount = 0;
    if (loyaltyOn && customer && body.pointsToRedeem) {
      const asked = asInt(body.pointsToRedeem, 'Points to redeem', { min: 0 });
      pointsRedeemed = Math.min(asked, customer.points);
      const redeemable = subtotal - discount;
      pointsDiscount = Math.floor(pointsRedeemed / redeemRate) * 100;
      if (pointsDiscount > redeemable) pointsDiscount = Math.floor(redeemable / 100) * 100;
      // Points are spent in whole redeem-blocks only; the remainder stays on the card.
      pointsRedeemed = (pointsDiscount / 100) * redeemRate;
    }

    const total = subtotal - discount - pointsDiscount;
    const payments = buildPayments(body.payments, total);
    const paid = payments.reduce((sum, p) => sum + p.amount, 0);
    if (paid < total) bad('Amount paid is less than the total due');

    const nonCash = payments.filter((p) => p.method !== 'cash').reduce((s, p) => s + p.amount, 0);
    if (nonCash > total) bad('Non-cash payments cannot exceed the total — change can only be given in cash');

    const pointsEarned =
      loyaltyOn && customer ? Math.floor((total / 100) * earnRate) : 0;

    const receiptNo = nextReceiptNo();
    const createdAt = nowLocal();

    const { id: saleId } = run(
      `INSERT INTO sales
         (receipt_no, customer_id, customer_name, subtotal, discount, discount_reason,
          points_redeemed, points_discount, total, paid, change_due, points_earned,
          note, status, appointment_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?)`,
      receiptNo,
      customer?.id ?? null,
      customer?.name ?? asStr(body.walkInName, 'Name', { max: 80, optional: true }),
      subtotal,
      discount,
      asStr(body.discountReason, 'Discount reason', { max: 120, optional: true }),
      pointsRedeemed,
      pointsDiscount,
      total,
      paid,
      paid - total,
      pointsEarned,
      asStr(body.note, 'Note', { max: 300, optional: true }),
      body.appointmentId ? asInt(body.appointmentId, 'Appointment') : null,
      createdAt,
    );

    for (const it of items) {
      run(
        `INSERT INTO sale_items
           (sale_id, service_id, name, category, unit_price, qty, line_total,
            staff_id, staff_name, commission_rate, commission_amount)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        saleId, it.service_id, it.name, it.category, it.unit_price, it.qty, it.line_total,
        it.staff_id, it.staff_name, it.commission_rate, it.commission_amount,
      );
    }

    for (const p of payments) {
      run(
        'INSERT INTO sale_payments (sale_id, method, amount, reference) VALUES (?, ?, ?, ?)',
        saleId, p.method, p.amount, p.reference,
      );
    }

    if (customer) {
      run(
        'UPDATE customers SET points = MAX(0, points - ? + ?) WHERE id = ?',
        pointsRedeemed, pointsEarned, customer.id,
      );
    }

    if (body.appointmentId) {
      run(
        "UPDATE appointments SET status = 'completed', sale_id = ? WHERE id = ?",
        saleId, asInt(body.appointmentId, 'Appointment'),
      );
    }

    return loadSale(saleId);
  });
}

function voidSale(id, reason) {
  return tx(() => {
    const sale = get('SELECT * FROM sales WHERE id = ?', id);
    if (!sale) notFound('Sale not found');
    if (sale.status === 'voided') bad('This sale is already voided');

    run(
      "UPDATE sales SET status = 'voided', void_reason = ?, voided_at = ? WHERE id = ?",
      reason, nowLocal(), id,
    );
    if (sale.customer_id) {
      run(
        'UPDATE customers SET points = MAX(0, points - ? + ?) WHERE id = ?',
        sale.points_earned, sale.points_redeemed, sale.customer_id,
      );
    }
    if (sale.appointment_id) {
      run("UPDATE appointments SET status = 'booked', sale_id = NULL WHERE id = ?", sale.appointment_id);
    }
    return loadSale(id);
  });
}

export const routes = [
  ['GET', '/api/sales', ({ query }) => {
    const where = ["1 = 1"];
    const args = [];
    const from = query.get('from');
    const to = query.get('to');
    if (from) { where.push('s.created_at >= ?'); args.push(`${from} 00:00:00`); }
    if (to) { where.push('s.created_at <= ?'); args.push(`${to} 23:59:59`); }
    if (query.get('status')) { where.push('s.status = ?'); args.push(query.get('status')); }
    if (query.get('customerId')) { where.push('s.customer_id = ?'); args.push(Number(query.get('customerId'))); }
    if (query.get('staffId')) {
      where.push('EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.staff_id = ?)');
      args.push(Number(query.get('staffId')));
    }
    if (query.get('method')) {
      where.push('EXISTS (SELECT 1 FROM sale_payments sp WHERE sp.sale_id = s.id AND sp.method = ?)');
      args.push(query.get('method'));
    }
    const q = (query.get('q') || '').trim();
    if (q) {
      where.push('(s.receipt_no LIKE ? OR s.customer_name LIKE ?)');
      args.push(`%${q}%`, `%${q}%`);
    }
    const limit = Math.min(Number(query.get('limit')) || 100, 500);
    const offset = Math.max(Number(query.get('offset')) || 0, 0);

    const rows = all(
      `SELECT s.*,
              (SELECT GROUP_CONCAT(si.name, ', ') FROM sale_items si WHERE si.sale_id = s.id) AS item_summary,
              (SELECT GROUP_CONCAT(DISTINCT sp.method) FROM sale_payments sp WHERE sp.sale_id = s.id) AS methods
         FROM sales s
        WHERE ${where.join(' AND ')}
        ORDER BY s.created_at DESC, s.id DESC
        LIMIT ? OFFSET ?`,
      ...args, limit, offset,
    );
    const totals = get(
      `SELECT COUNT(*) AS count, COALESCE(SUM(CASE WHEN s.status = 'completed' THEN s.total ELSE 0 END), 0) AS total
         FROM sales s WHERE ${where.join(' AND ')}`,
      ...args,
    );
    return { sales: rows, ...totals, limit, offset };
  }],

  ['GET', '/api/sales/:id', ({ params }) => loadSale(asInt(params.id, 'Sale'))],

  ['POST', '/api/sales', ({ body }) => createSale(body)],

  ['POST', '/api/sales/:id/void', ({ params, body }) =>
    voidSale(asInt(params.id, 'Sale'), asStr(body.reason, 'Reason', { max: 200 }))],
];
