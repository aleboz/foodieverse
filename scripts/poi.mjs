#!/usr/bin/env node
// Authoring CLI used by the AI agent. The author never runs this directly.
//
//   npm run poi -- add <draft.json> [--image <file>]... [--dry-run]
//   npm run poi -- update <city>/<slug> <patch.json> [--image <file>]... [--replace-images] [--dry-run]
//   npm run poi -- status <city>/<slug> <active|temporarily-closed|closed|archived> [--dry-run]
//   npm run poi -- show <city>/<slug>
//   npm run poi -- find <text>
//
// A draft is a partial POI: name, city, country, location, vibe, serves, tags,
// recommendation, googleMapsUrl, website, address, imageAlt. id, slug, dates,
// status and image file names are filled in here. --dry-run prints the
// preview and validation result without writing anything.
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { join, relative } from 'node:path';
import sharp from 'sharp';
import {
  loadPois, validatePoi, findDuplicates, findNearby, slugify, today, poiPaths, taxonomy, ROOT,
} from './lib/poi.mjs';

const args = process.argv.slice(2);
const cmd = args.shift();
const flag = (name) => {
  const i = args.indexOf(name);
  if (i === -1) return false;
  args.splice(i, 1);
  return true;
};
const multi = (name) => {
  const out = [];
  let i;
  while ((i = args.indexOf(name)) !== -1) out.push(...args.splice(i, 2).slice(1));
  return out;
};

const dryRun = flag('--dry-run');
const replaceImages = flag('--replace-images');
const imagesIn = multi('--image');
const slugOverride = multi('--slug')[0];

const FIELD_ORDER = [
  'id', 'slug', 'name', 'city', 'country', 'location', 'vibe', 'serves', 'tags', 'recommendation',
  'googleMapsUrl', 'website', 'address', 'images', 'imageAlt', 'status', 'createdAt', 'updatedAt',
];
const ordered = (poi) => Object.fromEntries(FIELD_ORDER.filter((k) => poi[k] !== undefined).map((k) => [k, poi[k]]));
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const die = (msg) => {
  console.error(`✗ ${msg}`);
  process.exit(1);
};

function preview(poi, { duplicates = [], nearby = [], images = [] } = {}) {
  const vibe = taxonomy.vibes.find((v) => v.id === poi.vibe);
  const serves = (poi.serves ?? []).map((id) => taxonomy.serves.find((s) => s.id === id)?.label ?? id);
  const lines = [
    `${poi.name} · ${poi.city}${poi.country ? `, ${poi.country}` : ''}`,
    '',
    `${vibe ? vibe.label : poi.vibe ?? '(no vibe)'}${poi.status !== 'active' ? `  ·  status: ${poi.status}` : ''}`,
    serves.join(' · ') || '(no service times)',
    (poi.tags ?? []).join(' · ') || '(no tags)',
    '',
    poi.recommendation,
    '',
    `📍 ${poi.address ?? `${poi.location?.latitude}, ${poi.location?.longitude}`}`,
  ];
  const nImg = images.length || poi.images?.length || 0;
  if (nImg) lines.push(`🖼  ${nImg} photo${nImg > 1 ? 's' : ''}`);
  if (poi.googleMapsUrl) lines.push(`🔗 ${poi.googleMapsUrl}`);
  if (poi.website) lines.push(`🌐 ${poi.website}`);
  for (const d of duplicates) lines.push('', `⚠️  Possible duplicate of existing "${d.name}" (${d.city}, status ${d.status})`);
  for (const n of nearby) lines.push('', `⚠️  Very close to existing "${n.name}" — same place?`);
  return lines.join('\n');
}

// Re-encode photos: honour EXIF rotation, cap at 2400 px, strip all metadata
// (GPS, camera, timestamps) so nothing private lands in the public repo.
async function importImages(files, destDir, startIndex) {
  const names = [];
  for (const src of files) if (!existsSync(src)) die(`image not found: ${src}`);
  if (!dryRun) mkdirSync(destDir, { recursive: true });
  let n = startIndex;
  for (const src of files) {
    if (!existsSync(src)) die(`image not found: ${src}`);
    n++;
    const name = `${String(n).padStart(2, '0')}.jpg`;
    try {
      const pipeline = sharp(src, { failOn: 'error' }).rotate().resize({ width: 2400, height: 2400, fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 88, mozjpeg: true });
      if (dryRun) await pipeline.toBuffer();
      else await pipeline.toFile(join(destDir, name));
    } catch (e) {
      die(`could not read image ${src} (${e.message}). HEIC is not supported — convert to JPEG first.`);
    }
    names.push(name);
  }
  return names;
}

function finish(poi, file, others, extra = {}) {
  const errors = validatePoi(poi, { citySlug: slugify(poi.city), fileSlug: poi.slug }).filter(
    // Images are not on disk yet during a dry run.
    (e) => !(dryRun && e.startsWith('image ') && e.includes('not found')),
  );
  const duplicates = findDuplicates(poi, others);
  const nearby = findNearby(poi, others).filter((n) => !duplicates.includes(n));
  console.log(preview(poi, { duplicates, nearby, ...extra }));
  console.log('');
  if (errors.length) {
    console.error('✗ Validation failed:');
    for (const e of errors) console.error(`    ${e}`);
    process.exit(1);
  }
  if (dryRun) {
    console.log(`(dry run — would write ${relative(ROOT, file)})`);
    if (duplicates.length) process.exitCode = 2;
    return;
  }
  writeFileSync(file, JSON.stringify(ordered(poi), null, 2) + '\n');
  console.log(`✓ wrote ${relative(ROOT, file)}`);
}

function locate(ref) {
  if (!ref || !ref.includes('/')) die('expected <city-slug>/<poi-slug>, e.g. copenhagen/bar-vivant (use "find" to search)');
  const [citySlug, slug] = ref.split('/');
  const { json } = poiPaths(citySlug, slug);
  if (!existsSync(json)) die(`no POI at ${relative(ROOT, json)}`);
  return { citySlug, slug, file: json, poi: readJson(json) };
}

const all = loadPois().map((e) => e.data).filter(Boolean);

switch (cmd) {
  case 'add': {
    const draftPath = args[0];
    if (!draftPath) die('usage: add <draft.json> [--image <file>]... [--dry-run]');
    const draft = readJson(draftPath);
    if (!draft.city) die('draft needs a "city"');
    if (!draft.name) die('draft needs a "name"');
    const citySlug = slugify(draft.city);
    let slug = slugOverride || draft.slug || slugify(draft.name);
    const base = slug;
    for (let i = 2; existsSync(poiPaths(citySlug, slug).json); i++) slug = `${base}-${i}`;
    const { json, images: imgDir } = poiPaths(citySlug, slug);
    const imageNames = imagesIn.length ? await importImages(imagesIn, imgDir, 0) : [];
    const date = today();
    const poi = {
      ...draft,
      id: `${slug}-${citySlug}`,
      slug,
      tags: draft.tags ?? [],
      country: draft.country ?? null,
      googleMapsUrl: draft.googleMapsUrl ?? null,
      website: draft.website ?? null,
      address: draft.address ?? null,
      images: imageNames,
      status: draft.status ?? 'active',
      createdAt: date,
      updatedAt: date,
    };
    if (!poi.imageAlt?.length) delete poi.imageAlt;
    if (!dryRun) mkdirSync(join(json, '..'), { recursive: true });
    finish(poi, json, all, { images: imageNames });
    break;
  }
  case 'update': {
    const { citySlug, slug, file, poi: before } = locate(args[0]);
    const patch = args[1] ? readJson(args[1]) : {};
    for (const k of ['id', 'slug', 'createdAt', 'images']) {
      if (k in patch) die(`"${k}" cannot be patched (images: use --image / --replace-images)`);
    }
    if (patch.city && slugify(patch.city) !== citySlug) die('moving a POI to another city: archive it and add it again');
    const { images: imgDir } = poiPaths(citySlug, slug);
    let images = before.images ?? [];
    if (replaceImages) {
      if (!dryRun && existsSync(imgDir)) rmSync(imgDir, { recursive: true });
      images = [];
    }
    if (imagesIn.length) {
      const highest = existsSync(imgDir) && !replaceImages
        ? Math.max(0, ...readdirSync(imgDir).map((f) => parseInt(f, 10) || 0))
        : 0;
      images = [...images, ...(await importImages(imagesIn, imgDir, highest))];
    }
    const after = { ...before, ...patch, images, updatedAt: today() };
    for (const [k, v] of Object.entries(patch)) if (v === undefined) delete after[k];
    printDiff(before, after);
    finish(after, file, all.filter((p) => p.id !== before.id));
    break;
  }
  case 'status': {
    const { file, poi: before } = locate(args[0]);
    const status = args[1];
    if (!taxonomy.statuses.includes(status)) die(`status must be one of: ${taxonomy.statuses.join(', ')}`);
    const after = { ...before, status, updatedAt: today() };
    printDiff(before, after);
    finish(after, file, all.filter((p) => p.id !== before.id));
    break;
  }
  case 'show': {
    const { poi } = locate(args[0]);
    console.log(preview(poi));
    console.log('\n' + JSON.stringify(poi, null, 2));
    break;
  }
  case 'find': {
    const q = slugify(args.join(' '));
    if (!q) die('usage: find <text>');
    const hits = all.filter((p) => slugify(`${p.name} ${p.city} ${p.address ?? ''}`).includes(q));
    if (!hits.length) console.log('No match.');
    for (const p of hits) console.log(`${slugify(p.city)}/${p.slug}  —  ${p.name}, ${p.city}  [${p.status}]`);
    break;
  }
  default:
    console.log(readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1, 14).join('\n').replace(/^\/\/ ?/gm, ''));
    process.exit(cmd ? 1 : 0);
}

function printDiff(before, after) {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const changes = [];
  for (const k of keys) {
    if (k === 'updatedAt') continue;
    const a = JSON.stringify(before[k]);
    const b = JSON.stringify(after[k]);
    if (a !== b) changes.push(`  ${k}:\n    - ${a ?? '(none)'}\n    + ${b ?? '(none)'}`);
  }
  console.log(changes.length ? `Changes:\n${changes.join('\n')}\n` : 'No changes.\n');
}
