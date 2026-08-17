import { get, readSettings } from '../db.js';
import { asInt } from '../http.js';
import { whatsappText, whatsappUrl } from '../message.js';
import { loadSale } from './sales.js';

/** Pulls the bits the message builder needs out of the database. */
function context(sale) {
  const customer = sale.customer_id
    ? get('SELECT phone, points FROM customers WHERE id = ?', sale.customer_id)
    : null;
  return {
    settings: readSettings(),
    options: { phone: customer?.phone ?? '', customerPoints: customer?.points ?? null },
  };
}

export const routes = [
  // Redirects rather than returning JSON so the till can use a plain link —
  // no popup blocker, works the same from a table row or a dialog.
  ['GET', '/api/sales/:id/whatsapp', ({ params, res }) => {
    const sale = loadSale(asInt(params.id, 'Sale'));
    const { settings, options } = context(sale);
    res.writeHead(302, {
      location: whatsappUrl(sale, settings, options),
      'cache-control': 'no-store',
    });
    res.end();
  }],

  // Lets the till preview the exact message before sending.
  ['GET', '/api/sales/:id/whatsapp.json', ({ params }) => {
    const sale = loadSale(asInt(params.id, 'Sale'));
    const { settings, options } = context(sale);
    return {
      text: whatsappText(sale, settings, options),
      url: whatsappUrl(sale, settings, options),
    };
  }],
];
