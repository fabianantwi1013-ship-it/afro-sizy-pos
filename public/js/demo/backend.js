// Stand-in for the Node API, running entirely in the browser so the app can be
// hosted as a static demo. Same routes, same rules, same response shapes — the
// screens cannot tell the difference. Everything lives in memory: a refresh
// puts the sample salon back exactly as it was.
import { ApiError } from '../core.js';
import { db, nextId, nowLocal, seedAll, todayLocal } from './store.js';
import { toCsv, whatsappUrl } from './message.js';

const bad = (message) => { throw new ApiError(400, message); };
const missing = (message) => { throw new ApiError(404, message); };
const copy = (value) => (value === undefined ? undefined : structuredClone(value));

const byId = (table, id) => db[table].find((row) => row.id === Number(id));
const sortBy = (list, key) => [...list].sort((a, b) => String(a[key]).localeCompare(String(b[key])));

/* --------------------------------------------------------------- derived */

const saleItems = (saleId) => db.saleItems.filter((i) => i.sale_id === saleId);
const salePayments = (saleId) => db.salePayments.filter((p) => p.sale_id === saleId);

function loadSale(id) {
  const sale = byId('sales', id);
  if (!sale) missing('Sale not found');
  return { ...sale, items: saleItems(sale.id), payments: salePayments(sale.id) };
}

function customerStats(id) {
  const sales = db.sales.filter((s) => s.customer_id === id && s.status === 'completed');
  return {
    visits: sales.length,
    spent: sales.reduce((sum, s) => sum + s.total, 0),
    last_visit: sales.length ? sales.map((s) => s.created_at).sort().at(-1) : null,
  };
}

const inRange = (stamp, from, to) => stamp >= `${from} 00:00:00` && stamp <= `${to} 23:59:59`;

function completedIn(from, to) {
  return db.sales.filter((s) => s.status === 'completed' && inRange(s.created_at, from, to));
}

function groupSum(rows, keyOf, valueOf) {
  const out = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    out.set(key, (out.get(key) || 0) + valueOf(row));
  }
  return out;
}

function summary(from, to) {
  const sales = completedIn(from, to);
  const items = sales.flatMap((s) => saleItems(s.id));
  const payments = sales.flatMap((s) => salePayments(s.id));

  const net = sales.reduce((sum, s) => sum + s.total, 0);
  const headline = {
    sales: sales.length,
    gross: sales.reduce((sum, s) => sum + s.subtotal, 0),
    discounts: sales.reduce((sum, s) => sum + s.discount, 0),
    points_discounts: sales.reduce((sum, s) => sum + s.points_discount, 0),
    net,
    customers: new Set(sales.map((s) => s.customer_id).filter(Boolean)).size,
    avg_ticket: sales.length ? Math.round(net / sales.length) : 0,
    new_customers: db.customers.filter((c) => inRange(c.created_at, from, to)).length,
  };

  const voidedSales = db.sales.filter((s) => s.status === 'voided' && inRange(s.created_at, from, to));

  const methodSales = new Map();
  for (const p of payments) {
    if (!methodSales.has(p.method)) methodSales.set(p.method, new Set());
    methodSales.get(p.method).add(p.sale_id);
  }
  const byMethod = [...groupSum(payments, (p) => p.method, (p) => p.amount)]
    .map(([method, amount]) => ({ method, amount, sales: methodSales.get(method).size }))
    .sort((a, b) => b.amount - a.amount);

  const categoryQty = groupSum(items, (i) => i.category || 'Uncategorised', (i) => i.qty);
  const byCategory = [...groupSum(items, (i) => i.category || 'Uncategorised', (i) => i.line_total)]
    .map(([category, revenue]) => ({ category, revenue, qty: categoryQty.get(category) }))
    .sort((a, b) => b.revenue - a.revenue);

  const serviceQty = groupSum(items, (i) => i.name, (i) => i.qty);
  const topServices = [...groupSum(items, (i) => i.name, (i) => i.line_total)]
    .map(([name, revenue]) => ({ name, revenue, qty: serviceQty.get(name) }))
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 12);

  const staffKey = (i) => `${i.staff_id || 0}|${i.staff_name || 'Unassigned'}`;
  const staffServices = groupSum(items, staffKey, (i) => i.qty);
  const staffCommission = groupSum(items, staffKey, (i) => i.commission_amount);
  const byStaff = [...groupSum(items, staffKey, (i) => i.line_total)]
    .map(([key, revenue]) => {
      const [id, name] = key.split('|');
      return {
        staff_id: Number(id),
        staff_name: name,
        revenue,
        services: staffServices.get(key),
        commission: staffCommission.get(key),
      };
    })
    .sort((a, b) => b.revenue - a.revenue);

  const dayCount = groupSum(sales, (s) => s.created_at.slice(0, 10), () => 1);
  const daily = [...groupSum(sales, (s) => s.created_at.slice(0, 10), (s) => s.total)]
    .map(([day, net_]) => ({ day, net: net_, sales: dayCount.get(day) }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const hourCount = groupSum(sales, (s) => Number(s.created_at.slice(11, 13)), () => 1);
  const hourly = [...groupSum(sales, (s) => Number(s.created_at.slice(11, 13)), (s) => s.total)]
    .map(([hour, net_]) => ({ hour, net: net_, sales: hourCount.get(hour) }))
    .sort((a, b) => a.hour - b.hour);

  return {
    from,
    to,
    headline,
    voided: { sales: voidedSales.length, value: voidedSales.reduce((sum, s) => sum + s.total, 0) },
    byMethod,
    byCategory,
    topServices,
    byStaff,
    daily,
    hourly,
  };
}

function commissionLines(from, to) {
  return completedIn(from, to)
    .flatMap((sale) => saleItems(sale.id)
      .filter((i) => i.staff_id)
      .map((i) => ({
        staff_id: i.staff_id,
        staff_name: i.staff_name,
        receipt_no: sale.receipt_no,
        created_at: sale.created_at,
        service: i.name,
        qty: i.qty,
        line_total: i.line_total,
        commission_rate: i.commission_rate,
        commission_amount: i.commission_amount,
      })))
    .sort((a, b) => a.staff_name.localeCompare(b.staff_name) || a.created_at.localeCompare(b.created_at));
}

const publicSettings = () => {
  const { app_pin: pin, ...rest } = db.settings;
  return { ...rest, has_pin: pin ? 1 : 0 };
};

/* ---------------------------------------------------------------- writes */

function createSale(body) {
  const earnRate = Number(db.settings.points_per_cedi) || 0;
  const redeemRate = Math.max(1, Number(db.settings.points_per_cedi_redeem) || 20);
  if (!Array.isArray(body.items) || !body.items.length) bad('Add at least one service to the sale');

  const items = body.items.map((raw) => {
    const service = raw.serviceId ? byId('services', raw.serviceId) : null;
    const staff = raw.staffId ? byId('staff', raw.staffId) : null;
    const unitPrice = Number(raw.unitPrice ?? service?.price ?? 0);
    const qty = Number(raw.qty ?? 1);
    const lineTotal = unitPrice * qty;
    const rate = staff ? Number(staff.commission_rate) : 0;
    return {
      service_id: service?.id ?? null,
      name: raw.name ?? service?.name ?? 'Item',
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

  let customer = body.customerId ? byId('customers', body.customerId) : null;
  if (!customer && body.newCustomer?.name) {
    const phone = String(body.newCustomer.phone || '').replace(/[\s\-()]/g, '') || null;
    customer = phone ? db.customers.find((c) => c.phone === phone) : null;
    if (!customer) {
      customer = {
        id: nextId('customers'),
        name: body.newCustomer.name,
        phone,
        notes: null,
        points: 0,
        created_at: nowLocal(),
      };
      db.customers.push(customer);
    }
  }

  const subtotal = items.reduce((sum, i) => sum + i.line_total, 0);
  const discount = Math.min(Number(body.discount || 0), subtotal);

  let pointsRedeemed = 0;
  let pointsDiscount = 0;
  if (db.settings.loyalty_enabled === '1' && customer && body.pointsToRedeem) {
    pointsRedeemed = Math.min(Number(body.pointsToRedeem), customer.points);
    pointsDiscount = Math.floor(pointsRedeemed / redeemRate) * 100;
    if (pointsDiscount > subtotal - discount) pointsDiscount = Math.floor((subtotal - discount) / 100) * 100;
    pointsRedeemed = (pointsDiscount / 100) * redeemRate;
  }

  const total = subtotal - discount - pointsDiscount;
  const payments = (body.payments || []).filter((p) => Number(p.amount) > 0);
  const paid = payments.reduce((sum, p) => sum + Number(p.amount), 0);
  if (total > 0 && !payments.length) bad('Record how the customer paid');
  if (paid < total) bad('Amount paid is less than the total due');
  const nonCash = payments.filter((p) => p.method !== 'cash').reduce((s, p) => s + Number(p.amount), 0);
  if (nonCash > total) bad('Non-cash payments cannot exceed the total — change can only be given in cash');

  const today = todayLocal();
  const seq = db.sales.filter((s) => s.created_at.startsWith(today)).length + 1;
  const pointsEarned = db.settings.loyalty_enabled === '1' && customer
    ? Math.floor((total / 100) * earnRate) : 0;

  const sale = {
    id: nextId('sales'),
    receipt_no: `${today.replace(/-/g, '')}-${String(seq).padStart(3, '0')}`,
    customer_id: customer?.id ?? null,
    customer_name: customer?.name ?? null,
    subtotal,
    discount,
    discount_reason: body.discountReason || null,
    points_redeemed: pointsRedeemed,
    points_discount: pointsDiscount,
    total,
    paid,
    change_due: paid - total,
    points_earned: pointsEarned,
    note: body.note || null,
    status: 'completed',
    void_reason: null,
    voided_at: null,
    appointment_id: body.appointmentId ?? null,
    created_at: nowLocal(),
  };
  db.sales.push(sale);
  for (const item of items) db.saleItems.push({ id: nextId('saleItems'), sale_id: sale.id, ...item });
  for (const p of payments) {
    db.salePayments.push({
      id: nextId('salePayments'),
      sale_id: sale.id,
      method: p.method,
      amount: Number(p.amount),
      reference: p.reference || null,
    });
  }
  if (customer) customer.points = Math.max(0, customer.points - pointsRedeemed + pointsEarned);
  if (body.appointmentId) {
    const appt = byId('appointments', body.appointmentId);
    if (appt) { appt.status = 'completed'; appt.sale_id = sale.id; }
  }
  return loadSale(sale.id);
}

function writeAppointment(id, body) {
  if (!/^\d{4}-\d{2}-\d{2} ([01]\d|2[0-3]):[0-5]\d$/.test(String(body.startAt || ''))) {
    bad('Start time must look like 2026-08-16 14:30');
  }
  if (!Array.isArray(body.items) || !body.items.length) bad('Choose at least one service');

  const items = body.items.map((raw) => {
    const service = raw.serviceId ? byId('services', raw.serviceId) : null;
    return {
      service_id: service?.id ?? null,
      name: raw.name ?? service?.name,
      price: Number(raw.price ?? service?.price ?? 0),
      duration_min: Number(raw.durationMin ?? service?.duration_min ?? 60),
    };
  });

  let customer = body.customerId ? byId('customers', body.customerId) : null;
  if (!customer && body.saveCustomer && body.customerName) {
    const phone = String(body.customerPhone || '').replace(/[\s\-()]/g, '') || null;
    customer = phone ? db.customers.find((c) => c.phone === phone) : null;
    if (!customer) {
      customer = {
        id: nextId('customers'), name: body.customerName, phone,
        notes: null, points: 0, created_at: nowLocal(),
      };
      db.customers.push(customer);
    }
  }

  const appointment = id ? byId('appointments', id) : { id: nextId('appointments'), sale_id: null, created_at: nowLocal() };
  if (!appointment) missing('Appointment not found');

  Object.assign(appointment, {
    customer_id: customer?.id ?? null,
    customer_name: customer?.name ?? body.customerName,
    customer_phone: customer?.phone ?? body.customerPhone ?? null,
    staff_id: body.staffId ? Number(body.staffId) : null,
    start_at: body.startAt,
    duration_min: body.durationMin
      ? Number(body.durationMin)
      : items.reduce((sum, i) => sum + i.duration_min, 0),
    status: body.status || appointment.status || 'booked',
    note: body.note || null,
  });
  if (!id) db.appointments.push(appointment);

  db.appointmentItems = db.appointmentItems.filter((i) => i.appointment_id !== appointment.id);
  for (const item of items) {
    db.appointmentItems.push({ id: nextId('appointmentItems'), appointment_id: appointment.id, ...item });
  }
  return withAppointmentExtras(appointment);
}

function withAppointmentExtras(appointment) {
  return {
    ...appointment,
    staff_name: appointment.staff_id ? byId('staff', appointment.staff_id)?.name ?? null : null,
    items: db.appointmentItems.filter((i) => i.appointment_id === appointment.id),
  };
}

/* ---------------------------------------------------------------- routes */

const ROUTES = [
  ['GET', '/api/bootstrap', () => ({
    settings: publicSettings(),
    categories: [...db.categories].sort((a, b) => a.sort - b.sort),
    services: db.services.filter((s) => s.active),
    staff: db.staff.filter((s) => s.active),
    paymentMethods: ['cash', 'momo', 'card', 'bank', 'other'],
    today: todayLocal(),
    todaySummary: summary(todayLocal(), todayLocal()),
  })],

  ['GET', '/api/settings', () => publicSettings()],
  ['PUT', '/api/settings', ({ body }) => {
    for (const [key, value] of Object.entries(body || {})) {
      if (key in db.settings || key === 'app_pin') db.settings[key] = String(value ?? '');
    }
    return publicSettings();
  }],
  ['POST', '/api/unlock', ({ body }) => {
    if (db.settings.app_pin && String(body?.pin ?? '') !== db.settings.app_pin) {
      throw new ApiError(401, 'Wrong PIN');
    }
    return { ok: true };
  }],

  ['GET', '/api/categories', () => [...db.categories].sort((a, b) => a.sort - b.sort)],
  ['POST', '/api/categories', ({ body }) => {
    if (db.categories.some((c) => c.name === body.name)) bad('That category already exists');
    const row = { id: nextId('categories'), name: body.name, sort: db.categories.length };
    db.categories.push(row);
    return row;
  }],

  ['GET', '/api/services', ({ query }) => {
    const rows = query.get('all') === '1' ? db.services : db.services.filter((s) => s.active);
    return [...rows].sort((a, b) =>
      a.category.localeCompare(b.category) || a.sort - b.sort || a.name.localeCompare(b.name));
  }],
  ['POST', '/api/services', ({ body }) => {
    const category = byId('categories', body.categoryId);
    if (!category) bad('Unknown category');
    const row = {
      id: nextId('services'),
      category_id: category.id,
      category: category.name,
      name: body.name,
      price: Number(body.price),
      duration_min: Number(body.durationMin || 60),
      active: 1,
      sort: db.services.length,
    };
    db.services.push(row);
    return row;
  }],
  ['PUT', '/api/services/:id', ({ params, body }) => {
    const service = byId('services', params.id);
    if (!service) missing('Service not found');
    const category = byId('categories', body.categoryId);
    if (!category) bad('Unknown category');
    Object.assign(service, {
      category_id: category.id,
      category: category.name,
      name: body.name,
      price: Number(body.price),
      duration_min: Number(body.durationMin || 60),
      active: body.active === false || body.active === 0 ? 0 : 1,
    });
    return service;
  }],
  ['DELETE', '/api/services/:id', ({ params }) => {
    const service = byId('services', params.id);
    if (service) service.active = 0;
    return { ok: true };
  }],
  ['POST', '/api/services/reprice', ({ body }) => {
    const percent = Number(body.percent);
    const rows = db.services.filter((s) => s.active
      && (!body.categoryId || s.category_id === Number(body.categoryId)));
    for (const s of rows) s.price = Math.max(0, Math.round((s.price * (100 + percent)) / 100));
    return { updated: rows.length };
  }],

  ['GET', '/api/staff', ({ query }) => {
    const rows = query.get('all') === '1' ? db.staff : db.staff.filter((s) => s.active);
    return [...rows].sort((a, b) => b.active - a.active || a.name.localeCompare(b.name));
  }],
  ['POST', '/api/staff', ({ body }) => {
    const row = {
      id: nextId('staff'),
      name: body.name,
      phone: body.phone || null,
      role: body.role || null,
      commission_rate: Number(body.commissionRate ?? db.settings.default_commission),
      active: 1,
    };
    db.staff.push(row);
    return row;
  }],
  ['PUT', '/api/staff/:id', ({ params, body }) => {
    const member = byId('staff', params.id);
    if (!member) missing('Staff member not found');
    Object.assign(member, {
      name: body.name,
      phone: body.phone || null,
      role: body.role || null,
      commission_rate: Number(body.commissionRate ?? 0),
      active: body.active === false || body.active === 0 ? 0 : 1,
    });
    return member;
  }],
  ['DELETE', '/api/staff/:id', ({ params }) => {
    const member = byId('staff', params.id);
    if (member) member.active = 0;
    return { ok: true };
  }],

  ['GET', '/api/customers', ({ query }) => {
    const q = (query.get('q') || '').trim().toLowerCase();
    const limit = Math.min(Number(query.get('limit')) || 200, 500);
    const rows = q
      ? sortBy(db.customers.filter((c) =>
        c.name.toLowerCase().includes(q) || (c.phone || '').includes(q)), 'name')
      : [...db.customers].sort((a, b) => b.created_at.localeCompare(a.created_at));
    return rows.slice(0, limit).map((c) => ({ ...c, ...customerStats(c.id) }));
  }],
  ['GET', '/api/customers/:id', ({ params }) => {
    const customer = byId('customers', params.id);
    if (!customer) missing('Customer not found');
    const sales = db.sales
      .filter((s) => s.customer_id === customer.id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .slice(0, 100)
      .map((s) => ({
        id: s.id, receipt_no: s.receipt_no, total: s.total,
        status: s.status, created_at: s.created_at, points_earned: s.points_earned,
      }));

    const done = db.sales.filter((s) => s.customer_id === customer.id && s.status === 'completed');
    const items = done.flatMap((s) => saleItems(s.id));
    const spentBy = groupSum(items, (i) => i.name, (i) => i.line_total);
    const favourites = [...groupSum(items, (i) => i.name, () => 1)]
      .map(([name, times]) => ({ name, times, spent: spentBy.get(name) }))
      .sort((a, b) => b.times - a.times || b.spent - a.spent)
      .slice(0, 5);

    const upcoming = db.appointments
      .filter((a) => a.customer_id === customer.id && ['booked', 'arrived'].includes(a.status))
      .sort((a, b) => a.start_at.localeCompare(b.start_at))
      .slice(0, 10)
      .map((a) => ({ id: a.id, start_at: a.start_at, status: a.status, staff_id: a.staff_id }));

    return { ...customer, ...customerStats(customer.id), sales, favourites, upcoming };
  }],
  ['POST', '/api/customers', ({ body }) => {
    const phone = String(body.phone || '').replace(/[\s\-()]/g, '') || null;
    if (phone && db.customers.some((c) => c.phone === phone)) {
      bad('A customer with that phone number already exists');
    }
    const row = {
      id: nextId('customers'),
      name: body.name,
      phone,
      notes: body.notes || null,
      points: Number(body.points || 0),
      created_at: nowLocal(),
    };
    db.customers.push(row);
    return { ...row, ...customerStats(row.id) };
  }],
  ['PUT', '/api/customers/:id', ({ params, body }) => {
    const customer = byId('customers', params.id);
    if (!customer) missing('Customer not found');
    const phone = String(body.phone || '').replace(/[\s\-()]/g, '') || null;
    if (phone && db.customers.some((c) => c.phone === phone && c.id !== customer.id)) {
      bad('Another customer already uses that phone number');
    }
    Object.assign(customer, {
      name: body.name, phone, notes: body.notes || null, points: Number(body.points || 0),
    });
    return { ...customer, ...customerStats(customer.id) };
  }],
  ['DELETE', '/api/customers/:id', ({ params }) => {
    const customer = byId('customers', params.id);
    if (!customer) missing('Customer not found');
    const count = db.sales.filter((s) => s.customer_id === customer.id).length;
    if (count) bad(`This customer has ${count} sale(s) on record and cannot be deleted`);
    db.customers = db.customers.filter((c) => c !== customer);
    return { ok: true };
  }],

  ['GET', '/api/sales', ({ query }) => {
    const from = query.get('from');
    const to = query.get('to');
    const q = (query.get('q') || '').trim().toLowerCase();
    let rows = db.sales.filter((s) => {
      if (from && s.created_at < `${from} 00:00:00`) return false;
      if (to && s.created_at > `${to} 23:59:59`) return false;
      if (query.get('status') && s.status !== query.get('status')) return false;
      if (query.get('customerId') && s.customer_id !== Number(query.get('customerId'))) return false;
      if (query.get('staffId')
        && !saleItems(s.id).some((i) => i.staff_id === Number(query.get('staffId')))) return false;
      if (query.get('method')
        && !salePayments(s.id).some((p) => p.method === query.get('method'))) return false;
      if (q && !(s.receipt_no.toLowerCase().includes(q)
        || (s.customer_name || '').toLowerCase().includes(q))) return false;
      return true;
    });
    const count = rows.length;
    const total = rows.filter((s) => s.status === 'completed').reduce((sum, s) => sum + s.total, 0);

    const limit = Math.min(Number(query.get('limit')) || 100, 500);
    const offset = Math.max(Number(query.get('offset')) || 0, 0);
    rows = rows
      .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id - a.id)
      .slice(offset, offset + limit)
      .map((s) => ({
        ...s,
        item_summary: saleItems(s.id).map((i) => i.name).join(', '),
        methods: [...new Set(salePayments(s.id).map((p) => p.method))].join(','),
      }));
    return { sales: rows, count, total, limit, offset };
  }],
  ['GET', '/api/sales/:id', ({ params }) => loadSale(params.id)],
  ['POST', '/api/sales', ({ body }) => createSale(body)],
  ['POST', '/api/sales/:id/void', ({ params, body }) => {
    const sale = byId('sales', params.id);
    if (!sale) missing('Sale not found');
    if (sale.status === 'voided') bad('This sale is already voided');
    sale.status = 'voided';
    sale.void_reason = body.reason;
    sale.voided_at = nowLocal();
    if (sale.customer_id) {
      const customer = byId('customers', sale.customer_id);
      if (customer) {
        customer.points = Math.max(0, customer.points - sale.points_earned + sale.points_redeemed);
      }
    }
    if (sale.appointment_id) {
      const appt = byId('appointments', sale.appointment_id);
      if (appt) { appt.status = 'booked'; appt.sale_id = null; }
    }
    return loadSale(sale.id);
  }],

  ['GET', '/api/appointments', ({ query }) => {
    const date = query.get('date');
    const from = date || query.get('from') || todayLocal();
    const to = date || query.get('to');
    return db.appointments
      .filter((a) => {
        if (a.start_at < `${from} 00:00`) return false;
        if (to && a.start_at > `${to} 23:59`) return false;
        if (query.get('staffId') && a.staff_id !== Number(query.get('staffId'))) return false;
        if (query.get('status') && a.status !== query.get('status')) return false;
        return true;
      })
      .sort((a, b) => a.start_at.localeCompare(b.start_at))
      .map(withAppointmentExtras);
  }],
  ['GET', '/api/appointments/:id', ({ params }) => {
    const appt = byId('appointments', params.id);
    if (!appt) missing('Appointment not found');
    return withAppointmentExtras(appt);
  }],
  ['POST', '/api/appointments', ({ body }) => writeAppointment(null, body)],
  ['PUT', '/api/appointments/:id', ({ params, body }) => writeAppointment(Number(params.id), body)],
  ['PATCH', '/api/appointments/:id/status', ({ params, body }) => {
    const appt = byId('appointments', params.id);
    if (!appt) missing('Appointment not found');
    if (appt.sale_id && body.status !== 'completed') {
      bad('This booking is already paid for — void the sale first');
    }
    appt.status = body.status;
    return withAppointmentExtras(appt);
  }],
  ['DELETE', '/api/appointments/:id', ({ params }) => {
    const appt = byId('appointments', params.id);
    if (!appt) missing('Appointment not found');
    if (appt.sale_id) bad('This booking has a sale attached — void the sale first');
    db.appointments = db.appointments.filter((a) => a !== appt);
    db.appointmentItems = db.appointmentItems.filter((i) => i.appointment_id !== appt.id);
    return { ok: true };
  }],

  ['GET', '/api/reports/summary', ({ query }) => {
    const from = query.get('from') || todayLocal();
    return summary(from, query.get('to') || from);
  }],
  ['GET', '/api/reports/commissions', ({ query }) => {
    const from = query.get('from') || todayLocal();
    const to = query.get('to') || from;
    const grouped = new Map();
    for (const line of commissionLines(from, to)) {
      if (!grouped.has(line.staff_id)) {
        grouped.set(line.staff_id, {
          staff_id: line.staff_id, staff_name: line.staff_name,
          services: 0, revenue: 0, commission: 0, lines: [],
        });
      }
      const entry = grouped.get(line.staff_id);
      entry.services += line.qty;
      entry.revenue += line.line_total;
      entry.commission += line.commission_amount;
      entry.lines.push(line);
    }
    return { from, to, staff: [...grouped.values()].sort((a, b) => b.revenue - a.revenue) };
  }],
];

const compiled = ROUTES.map(([method, pattern, handler]) => {
  const names = [];
  const source = pattern.split('/').map((part) => {
    if (!part.startsWith(':')) return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    names.push(part.slice(1));
    return '([^/]+)';
  }).join('/');
  return { method, handler, names, re: new RegExp(`^${source}$`) };
});

/** Same signature as a fetch-based call: resolves with parsed JSON, throws ApiError. */
export async function request(method, path, body) {
  const url = new URL(path, location.origin);
  for (const route of compiled) {
    const match = route.re.exec(url.pathname);
    if (!match || route.method !== method) continue;
    const params = {};
    route.names.forEach((name, i) => { params[name] = decodeURIComponent(match[i + 1]); });
    return copy(route.handler({ params, query: url.searchParams, body: body || {} }));
  }
  throw new ApiError(404, `No API route for ${url.pathname}`);
}

/* ------------------------------------------------- links the server served */

const cedis = (minor) => (minor / 100).toFixed(2);

function download(filename, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

function salesCsv(from, to) {
  const rows = db.sales
    .filter((s) => inRange(s.created_at, from, to))
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .flatMap((s) => saleItems(s.id).map((i) => [
      s.receipt_no, s.created_at, s.status, s.customer_name || '', i.name, i.category || '',
      i.qty, cedis(i.unit_price), cedis(i.line_total), i.staff_name || '',
      cedis(i.commission_amount), cedis(s.subtotal), cedis(s.discount),
      cedis(s.points_discount), cedis(s.total),
      salePayments(s.id).map((p) => `${p.method} ${p.amount / 100}`).join(' + '),
    ]));
  return toCsv(['Receipt', 'Date', 'Status', 'Customer', 'Service', 'Category', 'Qty', 'Unit price',
    'Line total', 'Staff', 'Commission', 'Sale subtotal', 'Sale discount', 'Points discount',
    'Sale total', 'Payments'], rows);
}

function commissionsCsv(from, to) {
  return toCsv(
    ['Staff', 'Date', 'Receipt', 'Service', 'Qty', 'Service revenue', 'Rate %', 'Commission'],
    commissionLines(from, to).map((l) => [
      l.staff_name, l.created_at, l.receipt_no, l.service, l.qty,
      cedis(l.line_total), l.commission_rate, cedis(l.commission_amount),
    ]),
  );
}

/**
 * The real till serves CSV exports, backups and the WhatsApp hand-off as plain
 * links. There is no server here, so intercept them and do the same job locally.
 */
function installLinkHandler() {
  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="/api/"]');
    if (!link) return;
    event.preventDefault();

    const url = new URL(link.getAttribute('href'), location.origin);
    const from = url.searchParams.get('from') || '2000-01-01';
    const to = url.searchParams.get('to') || '2099-12-31';
    const whatsapp = url.pathname.match(/^\/api\/sales\/(\d+)\/whatsapp$/);

    if (whatsapp) {
      const sale = loadSale(whatsapp[1]);
      const customer = sale.customer_id ? byId('customers', sale.customer_id) : null;
      window.open(whatsappUrl(sale, db.settings, {
        phone: customer?.phone || '',
        customerPoints: customer?.points ?? null,
      }), '_blank', 'noopener');
      return;
    }
    if (url.pathname === '/api/export/sales.csv') {
      return download(`afro-sizy-sales_${from}_to_${to}.csv`, salesCsv(from, to), 'text/csv');
    }
    if (url.pathname === '/api/export/commissions.csv') {
      return download(`afro-sizy-commissions_${from}_to_${to}.csv`, commissionsCsv(from, to), 'text/csv');
    }
    if (url.pathname === '/api/backup') {
      // The real till hands back a SQLite file; JSON is the honest equivalent here.
      return download('afro-sizy-demo-backup.json', JSON.stringify(db, null, 2), 'application/json');
    }
  });
}

installLinkHandler();

export { seedAll };
