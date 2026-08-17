# Afro & Sizy — Point of Sale

A till, diary and takings book for the salon. Runs on one computer in the shop and is
reachable from any phone or tablet on the same WiFi. **No internet needed, no monthly fee,
no accounts** — everything lives in one file on your machine.

Built for Ghana: prices in cedis, Mobile Money as a first-class payment method, split
tenders (part MoMo, part cash), and 80 mm thermal receipts.

**▶ Try it: https://fabianantwi1013-ship-it.github.io/afro-sizy-pos/** — the full app running
on sample salon data. Ring up a sale, book someone in, look at the takings. Nothing you do
there is saved, and it is not connected to any real salon.

---

## Starting it

**First time only:** install [Node.js](https://nodejs.org) (the LTS version). Nothing else
to install — this app has zero dependencies.

Then just double-click **`start.bat`**. A window opens showing:

```
  Afro & Sizy — Point of Sale
  ───────────────────────────
  On this computer   http://localhost:8787
  On phones/tablets  http://192.168.1.20:8787
```

Leave that window open while the salon is trading — it *is* the till. Closing it stops the
system. Press `Ctrl+C` to stop it deliberately.

From a terminal you can also run:

```bash
npm start
```

### Using it from a phone or tablet

Connect the phone to the same WiFi as the computer, then type the
`On phones/tablets` address into its browser. Add it to the home screen and it behaves like
an app. Windows may ask to allow Node.js through the firewall the first time — say yes for
**private networks**.

---

## Set it up before your first sale

1. **Team** → add every stylist, barber and nail tech, with their commission rate.
   Sales can only be credited to people who exist here.
2. **Setup → Service menu** → the catalogue is pre-loaded with 82 services across braids,
   locs, nails, lashes, brows, wigs, waxing and barbering. **The prices are placeholders —
   go through and set your real ones.** Use *Adjust prices* to move a whole category at once.
3. **Setup → Salon details** → phone number and receipt footer, which print on every receipt.
4. **Setup → Till lock** → set a PIN so nobody else on the WiFi can ring up sales.

---

## The screens

### New Sale
Tap services to build the ticket. For each line you can change quantity, override the price
(tap the amount), and pick **who served** — that is what drives commission. Attach a
customer to record their visit and loyalty points, or leave it as a walk-in.

*Charge* opens the payment sheet: choose Cash / Mobile Money / Card / Bank transfer, type
what you received, and it works out the change. **Split with another method** lets a
customer pay part MoMo and part cash. A half-finished ticket survives a refresh or a flat
battery — it is saved as you go.

*Recent sales* (top right) reprints or voids anything rung up today.

### Appointments
A day-by-day diary. Book a client against a stylist and services; the length is worked out
from the services chosen. Mark them **Arrived** when they walk in, then **Check out** to
send the whole booking to the till pre-filled — take payment and the booking is marked paid
and linked to the receipt.

### Customers
Everyone attached to a sale is saved here with visit count, lifetime spend, usual services
and loyalty points. Customers with 5+ visits are tagged *Regular*.

### Team
Commission owed per person for any period. Click a name to see every service they performed
and what they earned on each. Export to CSV for payday.

### Reports
Takings for a day, week, month or any custom range: revenue by payment method, by category,
top services, team performance, busiest hours, and the full sales list with search. Void a
sale here and it comes straight out of takings, commission and points.

---

## Receipts

Every receipt can be sent on **WhatsApp**, **printed**, or **downloaded** — from the
sale-complete screen, from *Recent sales*, and from any past sale in Reports.

### Making it yours

*Setup → Salon details → Receipt look* controls the branding:

- **Upload a logo** — a photo of the signboard or a proper logo file. It is shrunk to fit
  automatically (flat logos stay PNG so transparency survives; photographs are converted to
  JPEG so they stay small). With no logo, the salon's initials are used as a monogram.
- **Receipt colour** — the accent used for the salon name, the TOTAL band, the loyalty
  badge and the rule down the left edge. Defaults to the crimson from the sign.
- **Preview receipt** shows exactly how it will look, on a made-up sale, before you print
  or send anything real.

Worth knowing: **thermal printers print in black only.** The colour shows on the downloaded
image, on WhatsApp and on A4; on a thermal slip the same design comes out as a clean
black-and-white receipt, with the TOTAL band reversed out in white. Nothing relies on colour
alone to be readable.

**WhatsApp** opens a chat with the customer, with the whole receipt already typed out —
services, discount, total, how they paid, change, points earned. One tap to send. If the
customer has a phone number saved it goes straight to their chat; if not, WhatsApp asks you
to pick the contact. Ghana numbers are converted automatically (`024 111 2222` →
`233241112222`), and a number already carrying a country code is left alone. It works with
WhatsApp Desktop and WhatsApp Web on the till, and the WhatsApp app on a phone.

**Print** opens your browser's print dialog, formatted for **80 mm thermal paper**. Any
thermal printer that installs as a normal Windows printer works — pick it in the dialog and
set margins to none. Ordinary A4 works too if you have no thermal printer.

**Download** saves the receipt as a PNG image (`afro-sizy-receipt-20260816-004.png`), sized
to the same 80 mm slip — handy when you want to send the customer a picture of the slip, or
keep a copy because the printer is out of paper. It is an image rather than a PDF on purpose:
the ₵ sign is not part of the standard PDF font set, so a PDF would show the cedi symbol as
a blank box.

---

## Loyalty points

Off the shelf: customers earn **1 point per ₵1** spent, and **20 points = ₵1 off** — about
5% back. Both numbers are yours to change in *Setup → Loyalty*, or switch the whole thing
off. Points are redeemed in whole cedis at checkout; voiding a sale takes back the points it
earned and returns any it spent.

---

## Commission

Each sale line is credited to the stylist chosen on the till, at **their rate on the day of
the sale**. Changing someone's rate later never rewrites history. Commission is calculated on
the **service price before any discount** — if you would rather absorb discounts out of
commission, say so and it is a small change.

---

## Backups — please do this weekly

Everything is in `data/pos.db`. Two ways to keep it safe:

- **Setup → Your data → Download backup** gives you a single dated file. Copy it to a USB
  stick, phone, or email it to yourself.
- Or copy the whole `data` folder while the till is stopped.

The same screen exports all sales and all commissions as CSV, which opens in Excel.

To restore: stop the till, put the backup file in `data/`, rename it to `pos.db`.

---

## If something goes wrong

**"Port 8787 is already in use"** — the till is probably already running in another window.
Otherwise start it on a different port:

```bash
set PORT=8880 && npm start
```

**A phone cannot reach it** — check both are on the same WiFi, and that Windows Firewall is
allowing Node.js on private networks.

**The browser says it cannot reach the till server** — the black window has been closed.
Double-click `start.bat` again; no data is lost.

**Starting over after training** — clears sales, bookings and customers but keeps your
prices, team and settings:

```bash
npm run reset
```

Add `-- --all` to wipe absolutely everything back to a fresh install.

---

## The online demo

GitHub Pages can only serve static files — it cannot run a Node server or a database. So the
demo swaps the server out rather than reimplementing the app:

```
npm run build:demo      # builds dist/
```

The build copies `public/` unchanged, marks the shell `data-pos-mode="demo"`, and copies in
the real `src/seed.js` and `src/message.js`. That flag makes `core.js` route every API call
to `public/js/demo/backend.js` — an in-browser stand-in with the same routes, same rules and
same response shapes — instead of fetching from the server. The screens cannot tell the
difference, and because the catalogue and the WhatsApp message come from the real source
files, the demo cannot drift from the till.

`public/js/demo/store.js` seeds a month of plausible trading from a fixed random seed, so
everyone who opens the link sees the same numbers. It is all in memory: a refresh resets it.

Pushing to `main` rebuilds and redeploys it via `.github/workflows/pages.yml`. **None of this
affects the real till** — that runs from `public/` on the salon's machine and never loads the
demo folder.

To check a demo build locally the way Pages will serve it (from a sub-path):

```bash
npm run build:demo && POS_PUBLIC_DIR=dist npm start
```

## For whoever maintains this

Plain Node with **no dependencies at all** — no `npm install`, no build step, no framework.
It uses Node's built-in `node:sqlite`, so Node 22.5 or newer is required (24+ recommended).

```
server.js            HTTP server, static files, PIN guard
src/db.js            schema, migrations-on-boot, seed data
src/seed.js          the starting service catalogue and default settings
src/http.js          router, JSON/CSV helpers, validation
src/api/*.js         one module per resource
src/message.js       receipt-as-message text, phone normalisation, CSV (shared with the demo)
public/js/demo/      browser stand-in for the API, used only by the Pages build
scripts/build-demo.js  builds dist/ for GitHub Pages
public/              the browser app: no framework, ES modules
public/js/core.js    API client, formatting, dialogs, toasts
public/js/view-*.js  one module per screen
scripts/reset.js     clear-down helper
```

Money is stored everywhere as **integer pesewas**, never floats. Timestamps are local wall
clock (`YYYY-MM-DD HH:MM:SS`) because a salon reasons in shop time, not UTC.

Sales, services and staff are never hard-deleted — services and staff are deactivated, sales
are voided — so old receipts and reports always stay truthful.

The PIN is a staff lock for the salon network: it gates every write request, but it is not
encryption. Keep the computer itself locked down too.
