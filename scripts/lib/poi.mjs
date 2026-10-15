// Shared helpers for the Foodieverse data contract.
// Used by the validation, image, tag and authoring scripts.
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { slugify } from './slugify.mjs';

export { slugify };

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const POI_DIR = join(ROOT, 'data', 'pois');
export const IMAGE_DIR = join(ROOT, 'data', 'images');
export const taxonomy = JSON.parse(readFileSync(join(ROOT, 'data', 'taxonomy.json'), 'utf8'));

export const VIBE_IDS = taxonomy.vibes.map((v) => v.id);
export const SERVES_IDS = taxonomy.serves.map((s) => s.id);
export const STATUSES = taxonomy.statuses;
export const IMAGE_EXT = /\.(jpe?g|png|webp|avif|tiff?)$/i;
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const KNOWN_FIELDS = new Set([
  'id', 'slug', 'name', 'city', 'country', 'location', 'vibe', 'serves', 'tags', 'recommendation',
  'googleMapsUrl', 'address', 'images', 'imageAlt', 'status', 'createdAt', 'updatedAt',
]);

export function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Load every POI file. Returns [{ file, citySlug, data, error }]. */
export function loadPois() {
  const out = [];
  if (!existsSync(POI_DIR)) return out;
  for (const citySlug of readdirSync(POI_DIR).sort()) {
    const cityPath = join(POI_DIR, citySlug);
    if (!statSync(cityPath).isDirectory()) continue;
    for (const f of readdirSync(cityPath).sort()) {
      if (!f.endsWith('.json')) continue;
      const file = join(cityPath, f);
      try {
        out.push({ file, citySlug, data: JSON.parse(readFileSync(file, 'utf8')) });
      } catch (e) {
        out.push({ file, citySlug, data: null, error: `Invalid JSON: ${e.message}` });
      }
    }
  }
  return out;
}

export function distanceMeters(a, b) {
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Validate one POI. Returns a list of error strings (empty when valid). */
export function validatePoi(poi, { citySlug, fileSlug } = {}) {
  const errors = [];
  if (!poi || typeof poi !== 'object' || Array.isArray(poi)) return ['POI must be a JSON object'];

  for (const key of Object.keys(poi)) {
    if (!KNOWN_FIELDS.has(key)) errors.push(`Unknown field "${key}"`);
  }
  const nonEmpty = (k) => typeof poi[k] === 'string' && poi[k].trim().length > 0;
  for (const k of ['name', 'city', 'recommendation']) {
    if (!nonEmpty(k)) errors.push(`"${k}" must be a non-empty string`);
  }
  if (!nonEmpty('slug') || !SLUG_RE.test(poi.slug)) errors.push('"slug" must be lowercase-kebab-case');
  if (fileSlug && poi.slug !== fileSlug) errors.push(`"slug" (${poi.slug}) must match the file name (${fileSlug}.json)`);
  if (citySlug && nonEmpty('city') && slugify(poi.city) !== citySlug) {
    errors.push(`city "${poi.city}" slugifies to "${slugify(poi.city)}" but the file is in data/pois/${citySlug}/`);
  }
  if (nonEmpty('slug') && nonEmpty('city') && poi.id !== `${poi.slug}-${slugify(poi.city)}`) {
    errors.push(`"id" must be "${poi.slug}-${slugify(poi.city)}"`);
  }
  const loc = poi.location;
  if (!loc || typeof loc !== 'object') errors.push('"location" is required');
  else {
    const { latitude: lat, longitude: lon } = loc;
    if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) errors.push('location.latitude must be a number between -90 and 90');
    if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) errors.push('location.longitude must be a number between -180 and 180');
    if (lat === 0 && lon === 0) errors.push('location is 0,0 — coordinates were probably not resolved');
    for (const k of Object.keys(loc)) if (!['latitude', 'longitude'].includes(k)) errors.push(`Unknown location field "${k}"`);
  }
  if (!VIBE_IDS.includes(poi.vibe)) errors.push(`"vibe" must be one of: ${VIBE_IDS.join(', ')}`);
  if (!Array.isArray(poi.serves) || poi.serves.length === 0) errors.push(`"serves" must list at least one of: ${SERVES_IDS.join(', ')}`);
  else {
    for (const s of poi.serves) if (!SERVES_IDS.includes(s)) errors.push(`"serves" value "${s}" must be one of: ${SERVES_IDS.join(', ')}`);
    if (new Set(poi.serves).size !== poi.serves.length) errors.push('"serves" contains duplicates');
  }
  if (poi.tags !== undefined) {
    if (!Array.isArray(poi.tags)) errors.push('"tags" must be an array');
    else {
      for (const t of poi.tags) if (typeof t !== 'string' || !SLUG_RE.test(t)) errors.push(`tag "${t}" must be lowercase-kebab-case`);
      if (new Set(poi.tags).size !== poi.tags.length) errors.push('"tags" contains duplicates');
    }
  }
  if (!STATUSES.includes(poi.status)) errors.push(`"status" must be one of: ${STATUSES.join(', ')}`);
  if (poi.googleMapsUrl !== undefined && poi.googleMapsUrl !== null) {
    try {
      const u = new URL(poi.googleMapsUrl);
      if (!['http:', 'https:'].includes(u.protocol)) throw new Error();
      if (!/(^|\.)google\.[a-z.]+$|(^|\.)goo\.gl$|^maps\.app\.goo\.gl$/.test(u.hostname)) {
        errors.push(`"googleMapsUrl" host ${u.hostname} does not look like Google Maps`);
      }
    } catch {
      errors.push('"googleMapsUrl" is not a valid URL');
    }
  }
  for (const k of ['country', 'address']) {
    if (poi[k] !== undefined && poi[k] !== null && typeof poi[k] !== 'string') errors.push(`"${k}" must be a string or null`);
  }
  for (const k of ['createdAt', 'updatedAt']) {
    if (typeof poi[k] !== 'string' || !DATE_RE.test(poi[k]) || Number.isNaN(Date.parse(poi[k]))) errors.push(`"${k}" must be a YYYY-MM-DD date`);
  }
  if (poi.images !== undefined) {
    if (!Array.isArray(poi.images)) errors.push('"images" must be an array of file names');
    else {
      const dir = join(IMAGE_DIR, citySlug ?? slugify(poi.city ?? ''), poi.slug ?? '');
      for (const img of poi.images) {
        if (typeof img !== 'string' || img.includes('/') || !IMAGE_EXT.test(img)) {
          errors.push(`image "${img}" must be a plain file name with an image extension`);
        } else if (!existsSync(join(dir, img))) {
          errors.push(`image "${img}" not found in ${dir.replace(ROOT + '/', '')}/`);
        }
      }
    }
  }
  if (poi.imageAlt !== undefined && (!Array.isArray(poi.imageAlt) || poi.imageAlt.some((a) => typeof a !== 'string'))) {
    errors.push('"imageAlt" must be an array of strings');
  }
  return errors;
}

/** Likely duplicates of `poi` among `others`: same name in the same city, or same Google Maps URL. */
export function findDuplicates(poi, others) {
  const norm = (s) => slugify(s ?? '');
  return others.filter((o) => {
    if (!o || o === poi || o.id === poi.id) return false;
    if (poi.googleMapsUrl && o.googleMapsUrl === poi.googleMapsUrl) return true;
    return norm(o.city) === norm(poi.city) && norm(o.name) === norm(poi.name);
  });
}

/** Other POIs within `meters` of `poi` — possibly the same place under another name. */
export function findNearby(poi, others, meters = 25) {
  if (!poi.location) return [];
  return others.filter((o) => o && o !== poi && o.id !== poi.id && o.location && distanceMeters(o.location, poi.location) < meters);
}

export function poiPaths(citySlug, slug) {
  return {
    json: join(POI_DIR, citySlug, `${slug}.json`),
    images: join(IMAGE_DIR, citySlug, slug),
  };
}

export { basename };
