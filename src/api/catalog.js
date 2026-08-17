import { all, get, run, tx } from '../db.js';
import { asInt, asStr, bad, notFound } from '../http.js';

export function listCategories() {
  return all('SELECT id, name, sort FROM categories ORDER BY sort, name');
}

export function listServices({ includeInactive = false } = {}) {
  return all(`
    SELECT s.id, s.category_id, c.name AS category, s.name, s.price,
           s.duration_min, s.active, s.sort
      FROM services s
      JOIN categories c ON c.id = s.category_id
     ${includeInactive ? '' : 'WHERE s.active = 1'}
     ORDER BY c.sort, c.name, s.sort, s.name
  `);
}

const priceOf = (v) => asInt(v, 'Price', { min: 0, max: 100_000_000 });

export const routes = [
  ['GET', '/api/categories', () => listCategories()],

  ['POST', '/api/categories', ({ body }) => {
    const name = asStr(body.name, 'Category name', { max: 60 });
    if (get('SELECT id FROM categories WHERE name = ?', name)) bad('That category already exists');
    const sort = get('SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM categories').n;
    const { id } = run('INSERT INTO categories (name, sort) VALUES (?, ?)', name, sort);
    return get('SELECT id, name, sort FROM categories WHERE id = ?', id);
  }],

  ['PUT', '/api/categories/:id', ({ params, body }) => {
    const id = asInt(params.id, 'Category');
    if (!get('SELECT id FROM categories WHERE id = ?', id)) notFound('Category not found');
    const name = asStr(body.name, 'Category name', { max: 60 });
    const clash = get('SELECT id FROM categories WHERE name = ? AND id <> ?', name, id);
    if (clash) bad('Another category already uses that name');
    run('UPDATE categories SET name = ?, sort = ? WHERE id = ?', name, asInt(body.sort ?? 0, 'Sort'), id);
    return get('SELECT id, name, sort FROM categories WHERE id = ?', id);
  }],

  ['DELETE', '/api/categories/:id', ({ params }) => {
    const id = asInt(params.id, 'Category');
    const { n } = get('SELECT COUNT(*) AS n FROM services WHERE category_id = ?', id);
    if (n > 0) bad(`Move or delete the ${n} service(s) in this category first`);
    run('DELETE FROM categories WHERE id = ?', id);
    return { ok: true };
  }],

  ['GET', '/api/services', ({ query }) =>
    listServices({ includeInactive: query.get('all') === '1' })],

  ['POST', '/api/services', ({ body }) => {
    const categoryId = asInt(body.categoryId, 'Category');
    if (!get('SELECT id FROM categories WHERE id = ?', categoryId)) bad('Unknown category');
    const sort = get(
      'SELECT COALESCE(MAX(sort), 0) + 1 AS n FROM services WHERE category_id = ?',
      categoryId,
    ).n;
    const { id } = run(
      'INSERT INTO services (category_id, name, price, duration_min, active, sort) VALUES (?, ?, ?, ?, 1, ?)',
      categoryId,
      asStr(body.name, 'Service name', { max: 80 }),
      priceOf(body.price),
      asInt(body.durationMin ?? 60, 'Duration', { min: 5, max: 1440 }),
      sort,
    );
    return get('SELECT * FROM services WHERE id = ?', id);
  }],

  ['PUT', '/api/services/:id', ({ params, body }) => {
    const id = asInt(params.id, 'Service');
    if (!get('SELECT id FROM services WHERE id = ?', id)) notFound('Service not found');
    const categoryId = asInt(body.categoryId, 'Category');
    if (!get('SELECT id FROM categories WHERE id = ?', categoryId)) bad('Unknown category');
    run(
      `UPDATE services SET category_id = ?, name = ?, price = ?, duration_min = ?, active = ?
        WHERE id = ?`,
      categoryId,
      asStr(body.name, 'Service name', { max: 80 }),
      priceOf(body.price),
      asInt(body.durationMin ?? 60, 'Duration', { min: 5, max: 1440 }),
      body.active === false || body.active === 0 ? 0 : 1,
      id,
    );
    return get('SELECT * FROM services WHERE id = ?', id);
  }],

  // Services are never hard-deleted: past receipts and reports reference them.
  ['DELETE', '/api/services/:id', ({ params }) => {
    const id = asInt(params.id, 'Service');
    run('UPDATE services SET active = 0 WHERE id = ?', id);
    return { ok: true };
  }],

  ['POST', '/api/services/reprice', ({ body }) => {
    const percent = Number(body.percent);
    if (!Number.isFinite(percent) || percent < -90 || percent > 500) {
      bad('Percent must be between -90 and 500');
    }
    const categoryId = body.categoryId ? asInt(body.categoryId, 'Category') : null;
    const rows = categoryId
      ? all('SELECT id, price FROM services WHERE active = 1 AND category_id = ?', categoryId)
      : all('SELECT id, price FROM services WHERE active = 1');
    tx(() => {
      for (const s of rows) {
        const next = Math.max(0, Math.round((s.price * (100 + percent)) / 100));
        run('UPDATE services SET price = ? WHERE id = ?', next, s.id);
      }
    });
    return { updated: rows.length };
  }],
];
