import { createReadStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { all, get, db, todayLocal, DATA_DIR } from '../db.js';
import { toCsv } from '../http.js';

function range(query) {
  const from = query.get('from') || todayLocal();
  const to = query.get('to') || from;
  return { from, to, lo: `${from} 00:00:00`, hi: `${to} 23:59:59` };
}

export function summary(query) {
  const { from, to, lo, hi } = range(query);
  const scope = "s.created_at BETWEEN ? AND ? AND s.status = 'completed'";

  const headline = get(
    `SELECT COUNT(*) AS sales,
            COALESCE(SUM(s.subtotal), 0)        AS gross,
            COALESCE(SUM(s.discount), 0)        AS discounts,
            COALESCE(SUM(s.points_discount), 0) AS points_discounts,
            COALESCE(SUM(s.total), 0)           AS net,
            COUNT(DISTINCT s.customer_id)       AS customers
       FROM sales s WHERE ${scope}`,
    lo, hi,
  );

  const voided = get(
    `SELECT COUNT(*) AS sales, COALESCE(SUM(total), 0) AS value
       FROM sales s WHERE s.created_at BETWEEN ? AND ? AND s.status = 'voided'`,
    lo, hi,
  );

  const byMethod = all(
    `SELECT sp.method, COUNT(DISTINCT s.id) AS sales, SUM(sp.amount) AS amount
       FROM sale_payments sp JOIN sales s ON s.id = sp.sale_id
      WHERE ${scope}
      GROUP BY sp.method ORDER BY amount DESC`,
    lo, hi,
  );

  const byCategory = all(
    `SELECT COALESCE(si.category, 'Uncategorised') AS category,
            SUM(si.qty) AS qty, SUM(si.line_total) AS revenue
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE ${scope}
      GROUP BY category ORDER BY revenue DESC`,
    lo, hi,
  );

  const topServices = all(
    `SELECT si.name, SUM(si.qty) AS qty, SUM(si.line_total) AS revenue
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE ${scope}
      GROUP BY si.name ORDER BY revenue DESC LIMIT 12`,
    lo, hi,
  );

  const byStaff = all(
    `SELECT COALESCE(si.staff_id, 0) AS staff_id,
            COALESCE(si.staff_name, 'Unassigned') AS staff_name,
            SUM(si.qty) AS services,
            SUM(si.line_total) AS revenue,
            SUM(si.commission_amount) AS commission
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE ${scope}
      GROUP BY staff_id, staff_name ORDER BY revenue DESC`,
    lo, hi,
  );

  const daily = all(
    `SELECT substr(s.created_at, 1, 10) AS day,
            COUNT(*) AS sales, COALESCE(SUM(s.total), 0) AS net
       FROM sales s WHERE ${scope}
      GROUP BY day ORDER BY day`,
    lo, hi,
  );

  const hourly = all(
    `SELECT CAST(substr(s.created_at, 12, 2) AS INTEGER) AS hour,
            COUNT(*) AS sales, COALESCE(SUM(s.total), 0) AS net
       FROM sales s WHERE ${scope}
      GROUP BY hour ORDER BY hour`,
    lo, hi,
  );

  const newCustomers = get(
    'SELECT COUNT(*) AS n FROM customers WHERE created_at BETWEEN ? AND ?',
    lo, hi,
  ).n;

  return {
    from,
    to,
    headline: {
      ...headline,
      avg_ticket: headline.sales ? Math.round(headline.net / headline.sales) : 0,
      new_customers: newCustomers,
    },
    voided,
    byMethod,
    byCategory,
    topServices,
    byStaff,
    daily,
    hourly,
  };
}

function commissionRows({ lo, hi }) {
  return all(
    `SELECT si.staff_id, si.staff_name, s.receipt_no, s.created_at,
            si.name AS service, si.qty, si.line_total, si.commission_rate, si.commission_amount
       FROM sale_items si JOIN sales s ON s.id = si.sale_id
      WHERE s.created_at BETWEEN ? AND ? AND s.status = 'completed' AND si.staff_id IS NOT NULL
      ORDER BY si.staff_name, s.created_at`,
    lo, hi,
  );
}

const cedis = (minor) => (minor / 100).toFixed(2);

function sendCsv(res, filename, body) {
  res.writeHead(200, {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': `attachment; filename="${filename}"`,
    'cache-control': 'no-store',
  });
  res.end(body);
}

export const routes = [
  ['GET', '/api/reports/summary', ({ query }) => summary(query)],

  ['GET', '/api/reports/commissions', ({ query }) => {
    const r = range(query);
    const rows = commissionRows(r);
    const byStaff = new Map();
    for (const row of rows) {
      if (!byStaff.has(row.staff_id)) {
        byStaff.set(row.staff_id, {
          staff_id: row.staff_id,
          staff_name: row.staff_name,
          services: 0,
          revenue: 0,
          commission: 0,
          lines: [],
        });
      }
      const entry = byStaff.get(row.staff_id);
      entry.services += row.qty;
      entry.revenue += row.line_total;
      entry.commission += row.commission_amount;
      entry.lines.push(row);
    }
    return { ...r, staff: [...byStaff.values()].sort((a, b) => b.revenue - a.revenue) };
  }],

  ['GET', '/api/export/sales.csv', ({ query, res }) => {
    const { from, to, lo, hi } = range(query);
    const rows = all(
      `SELECT s.receipt_no, s.created_at, s.status, s.customer_name,
              si.name AS service, si.category, si.qty, si.unit_price, si.line_total,
              si.staff_name, si.commission_amount,
              s.subtotal, s.discount, s.points_discount, s.total,
              (SELECT GROUP_CONCAT(sp.method || ' ' || (sp.amount / 100.0), ' + ')
                 FROM sale_payments sp WHERE sp.sale_id = s.id) AS payments
         FROM sales s JOIN sale_items si ON si.sale_id = s.id
        WHERE s.created_at BETWEEN ? AND ?
        ORDER BY s.created_at, s.id, si.id`,
      lo, hi,
    );
    const csv = toCsv(
      ['Receipt', 'Date', 'Status', 'Customer', 'Service', 'Category', 'Qty', 'Unit price',
        'Line total', 'Staff', 'Commission', 'Sale subtotal', 'Sale discount', 'Points discount',
        'Sale total', 'Payments'],
      rows.map((r) => [
        r.receipt_no, r.created_at, r.status, r.customer_name || '', r.service, r.category || '',
        r.qty, cedis(r.unit_price), cedis(r.line_total), r.staff_name || '',
        cedis(r.commission_amount), cedis(r.subtotal), cedis(r.discount),
        cedis(r.points_discount), cedis(r.total), r.payments || '',
      ]),
    );
    sendCsv(res, `afro-sizy-sales_${from}_to_${to}.csv`, csv);
  }],

  ['GET', '/api/export/commissions.csv', ({ query, res }) => {
    const r = range(query);
    const rows = commissionRows(r);
    const csv = toCsv(
      ['Staff', 'Date', 'Receipt', 'Service', 'Qty', 'Service revenue', 'Rate %', 'Commission'],
      rows.map((row) => [
        row.staff_name, row.created_at, row.receipt_no, row.service, row.qty,
        cedis(row.line_total), row.commission_rate, cedis(row.commission_amount),
      ]),
    );
    sendCsv(res, `afro-sizy-commissions_${r.from}_to_${r.to}.csv`, csv);
  }],

  ['GET', '/api/backup', async ({ res }) => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const target = join(DATA_DIR, `backup-${stamp}.db`);
    db.exec(`VACUUM INTO '${target.replace(/\\/g, '/').replace(/'/g, "''")}'`);
    res.writeHead(200, {
      'content-type': 'application/x-sqlite3',
      'content-disposition': `attachment; filename="afro-sizy-backup-${stamp}.db"`,
      'cache-control': 'no-store',
    });
    await new Promise((resolve, reject) => {
      const stream = createReadStream(target);
      stream.on('error', reject);
      stream.on('end', resolve);
      stream.pipe(res);
    });
    await unlink(target).catch(() => {});
  }],
];
