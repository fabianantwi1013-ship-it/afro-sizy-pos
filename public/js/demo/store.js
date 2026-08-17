// In-memory stand-in for the SQLite database, seeded with a month of plausible
// trading so every screen has something to show. Deterministic: everyone who
// opens the demo link sees the same numbers.
import { CATEGORIES, SERVICES, DEFAULT_SETTINGS } from './catalogue.js';

/* --------------------------------------------------------------- plumbing */

/** mulberry32 — small, fast, and repeatable across browsers. */
function rng(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const nowLocal = () => {
  const d = new Date();
  return `${dateStr(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
export const todayLocal = () => dateStr(new Date());
export const shiftDays = (days) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return dateStr(d);
};

export const db = {
  categories: [],
  services: [],
  staff: [],
  customers: [],
  sales: [],
  saleItems: [],
  salePayments: [],
  appointments: [],
  appointmentItems: [],
  settings: { ...DEFAULT_SETTINGS },
};

const counters = {};
export const nextId = (table) => (counters[table] = (counters[table] || 0) + 1);

/* ------------------------------------------------------------------- seed */

const STAFF = [
  { name: 'Ama Mensah', role: 'Senior braider', phone: '0241112222', commission_rate: 45 },
  { name: 'Efua Danso', role: 'Nail technician', phone: '0209887766', commission_rate: 40 },
  { name: 'Kofi Owusu', role: 'Barber', phone: '0553344556', commission_rate: 35 },
  { name: 'Yaa Boateng', role: 'Lash & brow artist', phone: '0276655443', commission_rate: 42 },
];

// Which stylist normally does which kind of work.
const SPECIALITY = {
  Braids: 'Ama Mensah',
  Locs: 'Ama Mensah',
  'Wigs & Installation': 'Ama Mensah',
  Nails: 'Efua Danso',
  'Pedicure & Manicure': 'Efua Danso',
  Barbering: 'Kofi Owusu',
  Styling: 'Kofi Owusu',
  Lashes: 'Yaa Boateng',
  Brows: 'Yaa Boateng',
  Waxing: 'Yaa Boateng',
};

const CUSTOMERS = [
  ['Adwoa Serwaa Boateng', '0241118822', 'Prefers knotless, sensitive scalp'],
  ['Akosua Frimpong', '0554477112', ''],
  ['Efua Mensah', '0203344991', 'Always books with Ama'],
  ['Ama Darko', '0277788221', ''],
  ['Abena Owusu', '0269911443', 'Brings her own hair'],
  ['Yaa Asantewaa', '0244455667', ''],
  ['Nana Ama Kyei', '0551122334', 'Allergic to acrylic'],
  ['Esi Bonsu', '0208877665', ''],
  ['Akua Nyarko', '0242233445', ''],
  ['Adjoa Tetteh', '0559988776', 'Pays by MoMo'],
  ['Kwame Asante', '0201234567', ''],
  ['Kofi Mensah', '0553456789', ''],
  ['Yaw Boadu', '0246677889', ''],
  ['Kojo Danquah', '0274433221', ''],
];

// Roughly how often each category walks through the door.
const WEIGHTS = {
  Braids: 20, Nails: 16, 'Pedicure & Manicure': 12, Barbering: 12, Styling: 11,
  Lashes: 9, 'Wigs & Installation': 8, Locs: 6, Brows: 3, Waxing: 3,
};

function seedCatalogue() {
  const byName = new Map();
  CATEGORIES.forEach((name, i) => {
    const row = { id: nextId('categories'), name, sort: i };
    db.categories.push(row);
    byName.set(name, row.id);
  });
  SERVICES.forEach(([category, name, cedis, duration], i) => {
    db.services.push({
      id: nextId('services'),
      category_id: byName.get(category),
      category,
      name,
      price: Math.round(cedis * 100),
      duration_min: duration,
      active: 1,
      sort: i,
    });
  });
}

function seedPeople(random) {
  for (const person of STAFF) {
    db.staff.push({ id: nextId('staff'), active: 1, ...person });
  }
  CUSTOMERS.forEach(([name, phone, notes], i) => {
    db.customers.push({
      id: nextId('customers'),
      name,
      phone,
      notes: notes || null,
      points: 0,
      created_at: `${shiftDays(-45 + Math.floor(random() * 15) - i)} 10:00:00`,
    });
  });
}

const pick = (random, list) => list[Math.floor(random() * list.length)];

function weightedCategory(random) {
  const total = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);
  let roll = random() * total;
  for (const [category, weight] of Object.entries(WEIGHTS)) {
    if ((roll -= weight) <= 0) return category;
  }
  return 'Braids';
}

function receiptNo(day, seq) {
  return `${day.replace(/-/g, '')}-${String(seq).padStart(3, '0')}`;
}

/** Writes one completed sale straight into the store, server rules and all. */
function addSale(day, seq, time, lines, customer, { discount = 0, discountReason = null,
  pointsRedeemed = 0, methods, status = 'completed' } = {}) {
  const earnRate = Number(db.settings.points_per_cedi) || 1;
  const redeemRate = Math.max(1, Number(db.settings.points_per_cedi_redeem) || 20);

  const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);
  const cappedDiscount = Math.min(discount, subtotal);
  let pointsDiscount = Math.floor(pointsRedeemed / redeemRate) * 100;
  if (pointsDiscount > subtotal - cappedDiscount) {
    pointsDiscount = Math.floor((subtotal - cappedDiscount) / 100) * 100;
  }
  const usedPoints = (pointsDiscount / 100) * redeemRate;
  const total = subtotal - cappedDiscount - pointsDiscount;
  const paid = methods.reduce((sum, p) => sum + p.amount, 0);
  const pointsEarned = customer ? Math.floor((total / 100) * earnRate) : 0;

  const sale = {
    id: nextId('sales'),
    receipt_no: receiptNo(day, seq),
    customer_id: customer?.id ?? null,
    customer_name: customer?.name ?? null,
    subtotal,
    discount: cappedDiscount,
    discount_reason: discountReason,
    points_redeemed: usedPoints,
    points_discount: pointsDiscount,
    total,
    paid,
    change_due: Math.max(0, paid - total),
    points_earned: pointsEarned,
    note: null,
    status,
    void_reason: status === 'voided' ? 'Rung up on the wrong customer' : null,
    voided_at: status === 'voided' ? `${day} ${time}` : null,
    appointment_id: null,
    created_at: `${day} ${time}`,
  };
  db.sales.push(sale);

  for (const line of lines) {
    db.saleItems.push({ id: nextId('saleItems'), sale_id: sale.id, ...line });
  }
  for (const payment of methods) {
    db.salePayments.push({ id: nextId('salePayments'), sale_id: sale.id, reference: null, ...payment });
  }
  if (customer && status === 'completed') {
    customer.points = Math.max(0, customer.points - usedPoints + pointsEarned);
  }
  return sale;
}

function buildLine(service, staff, qty = 1) {
  const lineTotal = service.price * qty;
  return {
    service_id: service.id,
    name: service.name,
    category: service.category,
    unit_price: service.price,
    qty,
    line_total: lineTotal,
    staff_id: staff?.id ?? null,
    staff_name: staff?.name ?? null,
    commission_rate: staff ? staff.commission_rate : 0,
    commission_amount: staff ? Math.round((lineTotal * staff.commission_rate) / 100) : 0,
  };
}

function seedTrading(random) {
  const staffByName = new Map(db.staff.map((s) => [s.name, s]));
  const activeServices = db.services.filter((s) => s.active);

  for (let back = 30; back >= 0; back -= 1) {
    const day = shiftDays(-back);
    const weekday = new Date(`${day}T12:00:00`).getDay();
    if (weekday === 0) continue;                              // closed Sundays
    const busy = weekday === 5 || weekday === 6;              // Fri & Sat rush
    const count = (busy ? 7 : 4) + Math.floor(random() * (busy ? 4 : 3));

    for (let n = 0; n < count; n += 1) {
      const hour = 9 + Math.floor(random() * 9);
      const minute = pick(random, [0, 15, 30, 45]);
      const time = `${pad(hour)}:${pad(minute)}:00`;

      const lines = [];
      const lineCount = random() < 0.35 ? 2 : random() < 0.12 ? 3 : 1;
      for (let l = 0; l < lineCount; l += 1) {
        const category = weightedCategory(random);
        const options = activeServices.filter((s) => s.category === category);
        const service = pick(random, options);
        if (lines.some((line) => line.service_id === service.id)) continue;
        const staff = staffByName.get(SPECIALITY[category]);
        lines.push(buildLine(service, staff, service.name.includes('per nail') ? 2 : 1));
      }
      if (!lines.length) continue;

      const customer = random() < 0.68 ? pick(random, db.customers) : null;
      const subtotal = lines.reduce((sum, l) => sum + l.line_total, 0);

      let discount = 0;
      let discountReason = null;
      if (random() < 0.14) {
        discount = Math.round((subtotal * pick(random, [5, 10, 10, 15])) / 100 / 100) * 100;
        discountReason = pick(random, ['Regular client', 'Promo', 'Referral', 'Student']);
      }

      let pointsRedeemed = 0;
      if (customer && customer.points >= 200 && random() < 0.18) {
        pointsRedeemed = Math.min(customer.points, 200 + Math.floor(random() * 400));
      }

      const redeemRate = Math.max(1, Number(db.settings.points_per_cedi_redeem) || 20);
      let pointsDiscount = Math.floor(pointsRedeemed / redeemRate) * 100;
      if (pointsDiscount > subtotal - discount) pointsDiscount = Math.floor((subtotal - discount) / 100) * 100;
      const due = subtotal - discount - pointsDiscount;

      // Mobile money is how most people pay in Accra.
      const roll = random();
      let methods;
      if (roll < 0.5) methods = [{ method: 'momo', amount: due }];
      else if (roll < 0.78) methods = [{ method: 'cash', amount: Math.ceil(due / 1000) * 1000 }];
      else if (roll < 0.88) methods = [{ method: 'card', amount: due }];
      else if (roll < 0.93) methods = [{ method: 'bank', amount: due }];
      else {
        const part = Math.round(due / 2 / 100) * 100;
        methods = [{ method: 'momo', amount: part }, { method: 'cash', amount: due - part }];
      }

      addSale(day, n + 1, time, lines, customer, {
        discount, discountReason, pointsRedeemed, methods,
        status: back > 1 && random() < 0.012 ? 'voided' : 'completed',
      });
    }
  }
}

function seedDiary(random) {
  const staffByName = new Map(db.staff.map((s) => [s.name, s]));
  const plan = [
    [0, '09:30', 'Adwoa Serwaa Boateng', ['Knotless Braids (Medium)'], 'completed'],
    [0, '11:00', 'Akosua Frimpong', ['Gel Polish (Hands)', 'Classic Pedicure'], 'arrived'],
    [0, '12:30', 'Kwame Asante', ['Haircut + Beard Trim'], 'booked'],
    [0, '14:00', 'Nana Ama Kyei', ['Volume Lashes'], 'booked'],
    [0, '15:30', 'Ama Darko', ['Frontal Installation'], 'booked'],
    [0, '17:00', 'Esi Bonsu', ['Loc Retwist + Style'], 'booked'],
    [1, '10:00', 'Abena Owusu', ['Box Braids'], 'booked'],
    [1, '11:30', 'Adjoa Tetteh', ['Microblading'], 'booked'],
    [1, '14:00', 'Yaa Asantewaa', ['Spa Pedicure', 'Spa Manicure'], 'booked'],
    [2, '10:30', 'Akua Nyarko', ['Wig Revamping'], 'booked'],
    [2, '13:00', 'Kofi Mensah', ["Men's Haircut"], 'booked'],
  ];

  for (const [offset, time, customerName, serviceNames, status] of plan) {
    const customer = db.customers.find((c) => c.name === customerName) || null;
    const services = serviceNames
      .map((name) => db.services.find((s) => s.name === name))
      .filter(Boolean);
    if (!services.length) continue;

    const staff = staffByName.get(SPECIALITY[services[0].category]);
    const appointment = {
      id: nextId('appointments'),
      customer_id: customer?.id ?? null,
      customer_name: customerName,
      customer_phone: customer?.phone ?? null,
      staff_id: staff?.id ?? null,
      start_at: `${shiftDays(offset)} ${time}`,
      duration_min: services.reduce((sum, s) => sum + s.duration_min, 0),
      status,
      note: random() < 0.25 ? 'Bringing her own hair' : null,
      sale_id: null,
      created_at: `${shiftDays(-3)} 12:00:00`,
    };
    db.appointments.push(appointment);
    for (const service of services) {
      db.appointmentItems.push({
        id: nextId('appointmentItems'),
        appointment_id: appointment.id,
        service_id: service.id,
        name: service.name,
        price: service.price,
        duration_min: service.duration_min,
      });
    }
  }
}

export function seedAll() {
  const random = rng(20260816);
  db.settings = { ...DEFAULT_SETTINGS };
  seedCatalogue();
  seedPeople(random);
  seedTrading(random);
  seedDiary(random);
}

seedAll();
