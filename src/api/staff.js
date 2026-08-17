import { all, get, run, readSettings } from '../db.js';
import { asInt, asStr, bad, notFound } from '../http.js';

export function listStaff({ includeInactive = false } = {}) {
  return all(`
    SELECT id, name, phone, role, commission_rate, active
      FROM staff
     ${includeInactive ? '' : 'WHERE active = 1'}
     ORDER BY active DESC, name
  `);
}

function rateOf(value, fallback) {
  const raw = value === undefined || value === null || value === '' ? fallback : value;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 100) bad('Commission rate must be between 0 and 100');
  return Math.round(n * 100) / 100;
}

export const routes = [
  ['GET', '/api/staff', ({ query }) => listStaff({ includeInactive: query.get('all') === '1' })],

  ['POST', '/api/staff', ({ body }) => {
    const settings = readSettings();
    const { id } = run(
      'INSERT INTO staff (name, phone, role, commission_rate, active) VALUES (?, ?, ?, ?, 1)',
      asStr(body.name, 'Name', { max: 80 }),
      asStr(body.phone, 'Phone', { max: 30, optional: true }),
      asStr(body.role, 'Role', { max: 60, optional: true }),
      rateOf(body.commissionRate, settings.default_commission),
    );
    return get('SELECT * FROM staff WHERE id = ?', id);
  }],

  ['PUT', '/api/staff/:id', ({ params, body }) => {
    const id = asInt(params.id, 'Staff');
    if (!get('SELECT id FROM staff WHERE id = ?', id)) notFound('Staff member not found');
    run(
      'UPDATE staff SET name = ?, phone = ?, role = ?, commission_rate = ?, active = ? WHERE id = ?',
      asStr(body.name, 'Name', { max: 80 }),
      asStr(body.phone, 'Phone', { max: 30, optional: true }),
      asStr(body.role, 'Role', { max: 60, optional: true }),
      rateOf(body.commissionRate, 0),
      body.active === false || body.active === 0 ? 0 : 1,
      id,
    );
    return get('SELECT * FROM staff WHERE id = ?', id);
  }],

  ['DELETE', '/api/staff/:id', ({ params }) => {
    run('UPDATE staff SET active = 0 WHERE id = ?', asInt(params.id, 'Staff'));
    return { ok: true };
  }],
];
