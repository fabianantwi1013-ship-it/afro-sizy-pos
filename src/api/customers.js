import { all, get, run, nowLocal } from '../db.js';
import { asInt, asStr, bad, notFound } from '../http.js';

export const normalisePhone = (raw) => {
  const s = asStr(raw, 'Phone', { max: 30, optional: true });
  return s ? s.replace(/[\s\-()]/g, '') : null;
};

export function customerStats(id) {
  return get(
    `SELECT COUNT(*) AS visits,
            COALESCE(SUM(total), 0) AS spent,
            MAX(created_at) AS last_visit
       FROM sales
      WHERE customer_id = ? AND status = 'completed'`,
    id,
  );
}

/** Used by the sale endpoint so a walk-in can be saved as a customer in one step. */
export function upsertCustomer({ id, name, phone, notes }) {
  if (id) {
    const existing = get('SELECT * FROM customers WHERE id = ?', asInt(id, 'Customer'));
    if (!existing) notFound('Customer not found');
    return existing;
  }
  const cleanPhone = normalisePhone(phone);
  if (cleanPhone) {
    const match = get('SELECT * FROM customers WHERE phone = ?', cleanPhone);
    if (match) return match;
  }
  const created = run(
    'INSERT INTO customers (name, phone, notes, points, created_at) VALUES (?, ?, ?, 0, ?)',
    asStr(name, 'Customer name', { max: 80 }),
    cleanPhone,
    asStr(notes, 'Notes', { max: 500, optional: true }),
    nowLocal(),
  );
  return get('SELECT * FROM customers WHERE id = ?', created.id);
}

function withStats(rows) {
  return rows.map((c) => ({ ...c, ...customerStats(c.id) }));
}

export const routes = [
  ['GET', '/api/customers', ({ query }) => {
    const q = (query.get('q') || '').trim();
    const limit = Math.min(Number(query.get('limit')) || 200, 500);
    const rows = q
      ? all(
          `SELECT * FROM customers
            WHERE name LIKE ? OR phone LIKE ?
            ORDER BY name LIMIT ?`,
          `%${q}%`,
          `%${q}%`,
          limit,
        )
      : all('SELECT * FROM customers ORDER BY created_at DESC LIMIT ?', limit);
    return withStats(rows);
  }],

  ['GET', '/api/customers/:id', ({ params }) => {
    const id = asInt(params.id, 'Customer');
    const customer = get('SELECT * FROM customers WHERE id = ?', id);
    if (!customer) notFound('Customer not found');
    const sales = all(
      `SELECT id, receipt_no, total, status, created_at, points_earned
         FROM sales WHERE customer_id = ? ORDER BY created_at DESC LIMIT 100`,
      id,
    );
    const favourites = all(
      `SELECT si.name, COUNT(*) AS times, SUM(si.line_total) AS spent
         FROM sale_items si
         JOIN sales s ON s.id = si.sale_id
        WHERE s.customer_id = ? AND s.status = 'completed'
        GROUP BY si.name ORDER BY times DESC, spent DESC LIMIT 5`,
      id,
    );
    const upcoming = all(
      `SELECT id, start_at, status, staff_id FROM appointments
        WHERE customer_id = ? AND status IN ('booked','arrived')
        ORDER BY start_at LIMIT 10`,
      id,
    );
    return { ...customer, ...customerStats(id), sales, favourites, upcoming };
  }],

  ['POST', '/api/customers', ({ body }) => {
    const phone = normalisePhone(body.phone);
    if (phone && get('SELECT id FROM customers WHERE phone = ?', phone)) {
      bad('A customer with that phone number already exists');
    }
    const { id } = run(
      'INSERT INTO customers (name, phone, notes, points, created_at) VALUES (?, ?, ?, ?, ?)',
      asStr(body.name, 'Customer name', { max: 80 }),
      phone,
      asStr(body.notes, 'Notes', { max: 500, optional: true }),
      asInt(body.points ?? 0, 'Points', { min: 0 }),
      nowLocal(),
    );
    return { ...get('SELECT * FROM customers WHERE id = ?', id), ...customerStats(id) };
  }],

  ['PUT', '/api/customers/:id', ({ params, body }) => {
    const id = asInt(params.id, 'Customer');
    if (!get('SELECT id FROM customers WHERE id = ?', id)) notFound('Customer not found');
    const phone = normalisePhone(body.phone);
    if (phone && get('SELECT id FROM customers WHERE phone = ? AND id <> ?', phone, id)) {
      bad('Another customer already uses that phone number');
    }
    run(
      'UPDATE customers SET name = ?, phone = ?, notes = ?, points = ? WHERE id = ?',
      asStr(body.name, 'Customer name', { max: 80 }),
      phone,
      asStr(body.notes, 'Notes', { max: 500, optional: true }),
      asInt(body.points ?? 0, 'Points', { min: 0 }),
      id,
    );
    return { ...get('SELECT * FROM customers WHERE id = ?', id), ...customerStats(id) };
  }],

  ['DELETE', '/api/customers/:id', ({ params }) => {
    const id = asInt(params.id, 'Customer');
    const { n } = get('SELECT COUNT(*) AS n FROM sales WHERE customer_id = ?', id);
    if (n > 0) bad(`This customer has ${n} sale(s) on record and cannot be deleted`);
    run('UPDATE appointments SET customer_id = NULL WHERE customer_id = ?', id);
    run('DELETE FROM customers WHERE id = ?', id);
    return { ok: true };
  }],
];
