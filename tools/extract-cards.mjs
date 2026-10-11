// Export the 2.5D landmark art from the "World Property Cards" design file as static SVGs.
// Usage: node tools/extract-cards.mjs "/path/to/World Property Cards.html"
// Writes public/cards/<landmark>.svg, tinted with each property's set colour (utilities use the utility colour).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { SETS, UTILITIES } from '../shared/content.js';
import { landmarkId, UTILITY_COLOR } from '../shared/cards.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = process.argv[2];
if (!src) { console.error('Pass the path to the World Property Cards HTML file.'); process.exit(1); }

function unpack(html) {
  const block = (type) => html.match(new RegExp(`<script type="__bundler/${type}">([\\s\\S]*?)</script>`))?.[1] ?? '';
  const manifest = JSON.parse(block('manifest') || '{}');
  let template = block('template');
  try { template = JSON.parse(template); } catch { /* raw */ }
  const assets = {};
  for (const [id, v] of Object.entries(manifest)) {
    let data = Buffer.from(v.data, 'base64');
    if (v.compressed) data = zlib.gunzipSync(data);
    assets[id] = { mime: v.mime, data };
  }
  return { template, assets };
}

// Find the "Landmark" component page and turn its generator into a function.
const outer = unpack(fs.readFileSync(src, 'utf8'));
const page = Object.values(outer.assets).map((a) => a.data.toString('utf8')).find((h) => /<title>Landmark<\/title>/.test(h));
if (!page) { console.error('No Landmark component found in the design file.'); process.exit(1); }
const tpl = unpack(page).template;
const script = tpl.match(/<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/)[1];
const [, , vw, vh] = tpl.match(/sc-camel-view-box="([^"]+)"/)[1].split(/\s+/).map(Number);
class DCLogic { constructor(p) { this.props = p; } }
// eslint-disable-next-line no-new-func
const Component = new Function('DCLogic', `${script}; return Component;`)(DCLogic);

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
function render(lm, color) {
  const { polys, label } = new Component({ lm, color }).renderVals();
  const paths = polys.map((p) => `<path d="${p.d}" fill="${p.f}" stroke="${p.s}" stroke-width="${p.sw}"${p.o !== 1 ? ` opacity="${p.o}"` : ''} stroke-linejoin="round" stroke-linecap="round"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vw} ${vh}" width="${vw}" height="${vh}" role="img" aria-label="${esc(label)}">${paths}</svg>`;
}

const out = path.join(root, 'public/cards');
fs.mkdirSync(out, { recursive: true });
let n = 0;
for (const set of SETS) for (const city of set.cities) { fs.writeFileSync(path.join(out, `${landmarkId(city)}.svg`), render(landmarkId(city), set.color)); n++; }
for (const u of UTILITIES) { fs.writeFileSync(path.join(out, `${u.lm}.svg`), render(u.lm, UTILITY_COLOR)); n++; }
console.log(`Wrote ${n} landmark SVGs (${vw}x${vh}) to public/cards/`);
