#!/usr/bin/env node
// Build-time image optimisation. Originals in data/images/<city>/<slug>/ are
// turned into resized WebP variants in public/img/ (not committed) plus a
// manifest the site reads for srcset/width/height. Unchanged images are
// skipped, so CI only pays for new photos when public/img is cached.
import { readdirSync, existsSync, statSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join, parse, relative } from 'node:path';
import sharp from 'sharp';
import { loadPois, IMAGE_DIR, ROOT } from './lib/poi.mjs';

const WIDTHS = [480, 960, 1600];
const OUT_DIR = join(ROOT, 'public', 'img');
const MANIFEST = join(ROOT, 'src', 'generated', 'images.json');

const manifest = {};
const expected = new Set();
let made = 0;
let reused = 0;

for (const { citySlug, data: poi } of loadPois()) {
  if (!poi?.images?.length) continue;
  const entries = [];
  for (const file of poi.images) {
    const src = join(IMAGE_DIR, citySlug, poi.slug, file);
    if (!existsSync(src)) continue; // validate.mjs reports this
    const outDir = join(OUT_DIR, citySlug, poi.slug);
    mkdirSync(outDir, { recursive: true });
    const meta = await sharp(src).rotate().metadata();
    // metadata() reports pre-rotation size; swap for 90°/270° EXIF orientations.
    const rotated = (meta.orientation ?? 1) >= 5;
    const w0 = rotated ? meta.height : meta.width;
    const h0 = rotated ? meta.width : meta.height;
    const widths = WIDTHS.filter((w) => w < w0);
    if (!widths.length || widths.at(-1) < Math.min(w0, WIDTHS.at(-1))) widths.push(Math.min(w0, WIDTHS.at(-1)));
    const variants = [];
    for (const w of widths) {
      const name = `${parse(file).name}-${w}.webp`;
      const out = join(outDir, name);
      expected.add(out);
      if (existsSync(out) && statSync(out).mtimeMs >= statSync(src).mtimeMs) reused++;
      else {
        await sharp(src).rotate().resize({ width: w }).webp({ quality: 74 }).toFile(out);
        made++;
      }
      variants.push({ w, path: `img/${citySlug}/${poi.slug}/${name}` });
    }
    entries.push({ file, width: w0, height: h0, variants });
  }
  manifest[poi.id] = entries;
}

// Remove variants of deleted/renamed photos.
function prune(dir) {
  if (!existsSync(dir)) return;
  for (const f of readdirSync(dir)) {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) {
      prune(p);
      if (!readdirSync(p).length) rmSync(p, { recursive: true });
    } else if (!expected.has(p)) rmSync(p);
  }
}
prune(OUT_DIR);

mkdirSync(join(ROOT, 'src', 'generated'), { recursive: true });
writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
console.log(`images: ${made} generated, ${reused} up to date → ${relative(ROOT, OUT_DIR)}/`);
