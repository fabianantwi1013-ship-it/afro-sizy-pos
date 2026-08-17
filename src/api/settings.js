import { readSettings, writeSetting, tx } from '../db.js';
import { HttpError, bad } from '../http.js';
import { DEFAULT_SETTINGS } from '../seed.js';

const EDITABLE = Object.keys(DEFAULT_SETTINGS);

const NUMERIC = {
  default_commission: [0, 100],
  points_per_cedi: [0, 100],
  points_per_cedi_redeem: [1, 1000],
  open_hour: [0, 23],
  close_hour: [1, 24],
};

// The logo is kept as a data URI, so it needs far more room than a normal setting.
const MAX_LENGTH = { logo_data: 400_000 };

/** app_pin never leaves the server. */
export function publicSettings() {
  const { app_pin: pin, ...rest } = readSettings();
  return { ...rest, has_pin: pin ? 1 : 0 };
}

export const routes = [
  ['GET', '/api/settings', () => publicSettings()],

  ['PUT', '/api/settings', ({ body }) => {
    const updates = {};
    for (const [key, value] of Object.entries(body || {})) {
      if (!EDITABLE.includes(key)) continue;
      const str = String(value ?? '').trim();
      if (str.length > (MAX_LENGTH[key] ?? 300)) bad(`${key.replace(/_/g, ' ')} is too long`);
      if (key === 'logo_data' && str && !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(str)) {
        bad('The logo must be a PNG, JPG or WebP image');
      }
      if (key === 'brand_color' && str && !/^#[0-9a-fA-F]{6}$/.test(str)) {
        bad('Receipt colour must be a hex colour like #b8283f');
      }
      if (NUMERIC[key]) {
        const [min, max] = NUMERIC[key];
        const n = Number(str);
        if (!Number.isFinite(n) || n < min || n > max) {
          bad(`${key.replace(/_/g, ' ')} must be between ${min} and ${max}`);
        }
      }
      if (key === 'app_pin' && str && !/^\d{4,8}$/.test(str)) {
        bad('PIN must be 4 to 8 digits (leave blank to switch the lock off)');
      }
      updates[key] = str;
    }
    if (Number(updates.close_hour ?? readSettings().close_hour) <=
        Number(updates.open_hour ?? readSettings().open_hour)) {
      bad('Closing hour must be after opening hour');
    }
    tx(() => {
      for (const [key, value] of Object.entries(updates)) writeSetting(key, value);
    });
    return publicSettings();
  }],

  ['POST', '/api/unlock', ({ body }) => {
    const pin = readSettings().app_pin;
    if (!pin) return { ok: true };
    if (String(body?.pin ?? '') !== pin) throw new HttpError(401, 'Wrong PIN');
    return { ok: true };
  }],
];
