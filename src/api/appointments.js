import { all, get, run, tx, nowLocal, todayLocal } from '../db.js';
import { asInt, asStr, bad, notFound } from '../http.js';
import { upsertCustomer } from './customers.js';

const STATUSES = ['booked', 'arrived', 'completed', 'cancelled', 'no_show'];
const START_RE = /^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/;

function loadAppointment(id) {
  const appt = get(
    `SELECT a.*, s.name AS staff_name
       FROM appointments a
       LEFT JOIN staff s ON s.id = a.staff_id
      WHERE a.id = ?`,
    id,
  );
  if (!appt) notFound('Appointment not found');
  return {
    ...appt,
    items: all('SELECT * FROM appointment_items WHERE appointment_id = ? ORDER BY id', id),
  };
}

function attachItems(rows) {
  if (!rows.length) return rows;
  const items = all(
    `SELECT * FROM appointment_items
      WHERE appointment_id IN (${rows.map(() => '?').join(',')}) ORDER BY id`,
    ...rows.map((r) => r.id),
  );
  const byAppt = new Map();
  for (const it of items) {
    if (!byAppt.has(it.appointment_id)) byAppt.set(it.appointment_id, []);
    byAppt.get(it.appointment_id).push(it);
  }
  return rows.map((r) => ({ ...r, items: byAppt.get(r.id) || [] }));
}

function readItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) bad('Choose at least one service');
  return rawItems.map((raw, i) => {
    const serviceId = raw.serviceId ? asInt(raw.serviceId, `Service ${i + 1}`) : null;
    const service = serviceId ? get('SELECT * FROM services WHERE id = ?', serviceId) : null;
    if (serviceId && !service) bad(`Service ${i + 1} no longer exists`);
    return {
      service_id: service?.id ?? null,
      name: asStr(raw.name ?? service?.name, `Service ${i + 1} name`, { max: 120 }),
      price: asInt(raw.price ?? service?.price ?? 0, `Service ${i + 1} price`, { min: 0 }),
      duration_min: asInt(raw.durationMin ?? service?.duration_min ?? 60, 'Duration', {
        min: 5,
        max: 1440,
      }),
    };
  });
}

function writeAppointment(id, body) {
  const startAt = asStr(body.startAt, 'Start time', { max: 16 });
  if (!START_RE.test(startAt)) bad('Start time must look like 2026-08-16 14:30');

  const items = readItems(body.items);
  const duration = body.durationMin
    ? asInt(body.durationMin, 'Duration', { min: 5, max: 1440 })
    : items.reduce((sum, it) => sum + it.duration_min, 0);

  const staffId = body.staffId ? asInt(body.staffId, 'Staff') : null;
  if (staffId && !get('SELECT id FROM staff WHERE id = ?', staffId)) bad('Unknown staff member');

  const status = body.status ? asStr(body.status, 'Status', { max: 20 }) : 'booked';
  if (!STATUSES.includes(status)) bad(`Unknown status "${status}"`);

  return tx(() => {
    let customer = null;
    if (body.customerId) customer = upsertCustomer({ id: body.customerId });
    else if (body.saveCustomer && body.customerName) {
      customer = upsertCustomer({ name: body.customerName, phone: body.customerPhone });
    }

    const fields = [
      customer?.id ?? null,
      customer?.name ?? asStr(body.customerName, 'Customer name', { max: 80 }),
      customer?.phone ?? asStr(body.customerPhone, 'Phone', { max: 30, optional: true }),
      staffId,
      startAt,
      duration,
      status,
      asStr(body.note, 'Note', { max: 300, optional: true }),
    ];

    let apptId = id;
    if (id) {
      run(
        `UPDATE appointments SET customer_id = ?, customer_name = ?, customer_phone = ?,
             staff_id = ?, start_at = ?, duration_min = ?, status = ?, note = ?
           WHERE id = ?`,
        ...fields, id,
      );
      run('DELETE FROM appointment_items WHERE appointment_id = ?', id);
    } else {
      apptId = run(
        `INSERT INTO appointments
           (customer_id, customer_name, customer_phone, staff_id, start_at, duration_min,
            status, note, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ...fields, nowLocal(),
      ).id;
    }

    for (const it of items) {
      run(
        `INSERT INTO appointment_items (appointment_id, service_id, name, price, duration_min)
         VALUES (?, ?, ?, ?, ?)`,
        apptId, it.service_id, it.name, it.price, it.duration_min,
      );
    }
    return loadAppointment(apptId);
  });
}

export const routes = [
  ['GET', '/api/appointments', ({ query }) => {
    const where = [];
    const args = [];
    const date = query.get('date');
    if (date) {
      where.push('a.start_at >= ? AND a.start_at <= ?');
      args.push(`${date} 00:00`, `${date} 23:59`);
    } else {
      const from = query.get('from') || todayLocal();
      const to = query.get('to');
      where.push('a.start_at >= ?');
      args.push(`${from} 00:00`);
      if (to) { where.push('a.start_at <= ?'); args.push(`${to} 23:59`); }
    }
    if (query.get('staffId')) { where.push('a.staff_id = ?'); args.push(Number(query.get('staffId'))); }
    if (query.get('status')) { where.push('a.status = ?'); args.push(query.get('status')); }

    const rows = all(
      `SELECT a.*, s.name AS staff_name
         FROM appointments a
         LEFT JOIN staff s ON s.id = a.staff_id
        WHERE ${where.join(' AND ')}
        ORDER BY a.start_at
        LIMIT 400`,
      ...args,
    );
    return attachItems(rows);
  }],

  ['GET', '/api/appointments/:id', ({ params }) => loadAppointment(asInt(params.id, 'Appointment'))],

  ['POST', '/api/appointments', ({ body }) => writeAppointment(null, body)],

  ['PUT', '/api/appointments/:id', ({ params, body }) => {
    const id = asInt(params.id, 'Appointment');
    if (!get('SELECT id FROM appointments WHERE id = ?', id)) notFound('Appointment not found');
    return writeAppointment(id, body);
  }],

  ['PATCH', '/api/appointments/:id/status', ({ params, body }) => {
    const id = asInt(params.id, 'Appointment');
    const status = asStr(body.status, 'Status', { max: 20 });
    if (!STATUSES.includes(status)) bad(`Unknown status "${status}"`);
    const appt = get('SELECT * FROM appointments WHERE id = ?', id);
    if (!appt) notFound('Appointment not found');
    if (appt.sale_id && status !== 'completed') {
      bad('This booking is already paid for — void the sale first');
    }
    run('UPDATE appointments SET status = ? WHERE id = ?', status, id);
    return loadAppointment(id);
  }],

  ['DELETE', '/api/appointments/:id', ({ params }) => {
    const id = asInt(params.id, 'Appointment');
    const appt = get('SELECT sale_id FROM appointments WHERE id = ?', id);
    if (!appt) notFound('Appointment not found');
    if (appt.sale_id) bad('This booking has a sale attached — void the sale first');
    run('DELETE FROM appointments WHERE id = ?', id);
    return { ok: true };
  }],
];
