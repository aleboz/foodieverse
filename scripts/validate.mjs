#!/usr/bin/env node
// Validates every POI under data/pois. Exits non-zero on any error so a bad
// commit can never replace the live site.
import { readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename, relative } from 'node:path';
import { loadPois, validatePoi, findDuplicates, findNearby, IMAGE_DIR, ROOT } from './lib/poi.mjs';

const entries = loadPois();
let errorCount = 0;
let warnCount = 0;
const rel = (p) => relative(ROOT, p);

const valid = [];
for (const e of entries) {
  const errs = e.error ? [e.error] : validatePoi(e.data, { citySlug: e.citySlug, fileSlug: basename(e.file, '.json') });
  if (errs.length) {
    errorCount += errs.length;
    console.error(`✗ ${rel(e.file)}`);
    for (const m of errs) console.error(`    ${m}`);
  } else {
    valid.push(e.data);
  }
}

const ids = new Map();
for (const p of valid) {
  if (ids.has(p.id)) {
    errorCount++;
    console.error(`✗ duplicate id "${p.id}"`);
  }
  ids.set(p.id, p);
}

const reported = new Set();
for (const p of valid) {
  for (const d of findDuplicates(p, valid)) {
    const key = [p.id, d.id].sort().join('|');
    if (reported.has(key)) continue;
    reported.add(key);
    errorCount++;
    console.error(`✗ possible duplicate: ${p.id} and ${d.id}`);
  }
  for (const n of findNearby(p, valid)) {
    const key = 'near:' + [p.id, n.id].sort().join('|');
    if (reported.has(key)) continue;
    reported.add(key);
    warnCount++;
    console.warn(`! ${p.id} and ${n.id} are less than 25 m apart — check they are different places`);
  }
}

// Image folders that no POI points at are usually leftovers from a rename.
if (existsSync(IMAGE_DIR)) {
  for (const city of readdirSync(IMAGE_DIR)) {
    const cityDir = join(IMAGE_DIR, city);
    if (!statSync(cityDir).isDirectory()) continue;
    for (const slug of readdirSync(cityDir)) {
      if (!valid.some((p) => p.slug === slug && p.id === `${slug}-${city}`)) {
        warnCount++;
        console.warn(`! ${rel(join(cityDir, slug))}/ is not used by any POI`);
      }
    }
  }
}

const cities = new Set(valid.map((p) => p.city));
console.log(`\n${valid.length} valid POIs in ${cities.size} cities · ${errorCount} errors · ${warnCount} warnings`);
process.exit(errorCount ? 1 : 0);
