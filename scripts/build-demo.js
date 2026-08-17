// Builds the GitHub Pages demo into dist/.
//
// The demo is the same front end as the real till; only two things change:
//   1. the shell is marked data-pos-mode="demo", which makes core.js route every
//      API call to an in-browser stand-in instead of fetching from the server
//   2. the real service catalogue is copied in, so the demo can never drift
//      from what the salon actually sees
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = process.env.DEMO_OUT || join(ROOT, 'dist');

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });
await cp(join(ROOT, 'public'), OUT, { recursive: true });
await cp(join(ROOT, 'src', 'seed.js'), join(OUT, 'js', 'demo', 'catalogue.js'));
await cp(join(ROOT, 'src', 'message.js'), join(OUT, 'js', 'demo', 'message.js'));

const indexPath = join(OUT, 'index.html');
const source = await readFile(indexPath, 'utf8');

// Pages serves the site from /<repo>/, so the asset paths must be relative
// there. The real till keeps absolute paths, which survive any deep link.
const REWRITES = [
  ['<html lang="en">', '<html lang="en" data-pos-mode="demo">'],
  ['href="/css/styles.css"', 'href="css/styles.css"'],
  ['src="/js/app.js"', 'src="js/app.js"'],
  ['<title>Afro &amp; Sizy — Point of Sale</title>',
    '<title>Afro &amp; Sizy — Point of Sale (demo)</title>'],
  ['<meta name="viewport"',
    '<meta name="description" content="Try the Afro &amp; Sizy point of sale: ring up a sale, '
    + 'book an appointment, see takings and staff commission. Sample data, nothing is saved.">\n'
    + '<meta name="viewport"'],
];

let html = source;
for (const [find, replace] of REWRITES) {
  if (!html.includes(find)) {
    throw new Error(`build-demo: index.html no longer contains ${JSON.stringify(find)}`);
  }
  html = html.replace(find, replace);
}
await writeFile(indexPath, html);

// Stops GitHub Pages running Jekyll over the output.
await writeFile(join(OUT, '.nojekyll'), '');

console.log(`Demo built into ${OUT}`);
