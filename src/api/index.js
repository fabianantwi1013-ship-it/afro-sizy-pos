import { createRouter } from '../http.js';
import { todayLocal } from '../db.js';
import * as catalog from './catalog.js';
import * as staff from './staff.js';
import * as customers from './customers.js';
import * as sales from './sales.js';
import * as appointments from './appointments.js';
import * as reports from './reports.js';
import * as settings from './settings.js';
import * as whatsapp from './whatsapp.js';

const bootstrap = [
  ['GET', '/api/bootstrap', () => {
    const today = todayLocal();
    return {
      settings: settings.publicSettings(),
      categories: catalog.listCategories(),
      services: catalog.listServices(),
      staff: staff.listStaff(),
      paymentMethods: sales.PAYMENT_METHODS,
      today,
      todaySummary: reports.summary(new URLSearchParams({ from: today, to: today })),
    };
  }],
];

export const match = createRouter([
  bootstrap,
  catalog.routes,
  staff.routes,
  customers.routes,
  sales.routes,
  whatsapp.routes,
  appointments.routes,
  reports.routes,
  settings.routes,
]);
