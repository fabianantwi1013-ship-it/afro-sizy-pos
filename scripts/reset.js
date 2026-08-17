// Wipes transactional data (sales, appointments, customers) but keeps the
// service catalogue, staff and settings. Useful after training on the till.
//   npm run reset -- --all      also clears services, staff and settings
import { rm } from 'node:fs/promises';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { DATA_DIR, DB_PATH, db, run } from '../src/db.js';

const wipeEverything = process.argv.includes('--all');

const rl = createInterface({ input: stdin, output: stdout });
const answer = await rl.question(
  wipeEverything
    ? `Delete the ENTIRE database at ${DB_PATH}? Type DELETE to confirm: `
    : 'Delete all sales, appointments and customers? Type CLEAR to confirm: ',
);
rl.close();

if (wipeEverything) {
  if (answer.trim() !== 'DELETE') process.exit(console.log('Cancelled.') ?? 0);
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    await rm(`${DB_PATH}${suffix}`, { force: true });
  }
  console.log(`Removed the database. It will be rebuilt on next start (${DATA_DIR}).`);
} else {
  if (answer.trim() !== 'CLEAR') process.exit(console.log('Cancelled.') ?? 0);
  db.exec('PRAGMA foreign_keys = OFF');
  for (const table of [
    'sale_payments', 'sale_items', 'sales',
    'appointment_items', 'appointments', 'customers',
  ]) {
    run(`DELETE FROM ${table}`);
  }
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('VACUUM');
  console.log('Cleared sales, appointments and customers. Catalogue and staff kept.');
}
