// Best-effort resolution of a Google Maps link into name, coordinates, city,
// country and address. Google consumer URLs are not a stable API, so every
// step is a heuristic and callers must sanity-check the result.
import { slugify } from './slugify.mjs';

const UA = 'IrinasFoodieverse/1.0 (https://github.com/aleboz/foodieverse)';
const BROWSER_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

async function expand(url) {
  let current = url;
  for (let i = 0; i < 8; i++) {
    const res = await fetch(current, { redirect: 'manual', headers: { 'user-agent': BROWSER_UA } });
    const loc = res.headers.get('location');
    if (res.status >= 300 && res.status < 400 && loc) {
      current = new URL(loc, current).toString();
      continue;
    }
    return { url: current, html: res.ok ? await res.text() : '' };
  }
  return { url: current, html: '' };
}

function parseUrl(url) {
  const u = new URL(url);
  // consent.google.com wraps the real target in ?continue=
  if (u.hostname.startsWith('consent.') && u.searchParams.get('continue')) return parseUrl(u.searchParams.get('continue'));
  const r = { name: null, location: null };
  const decoded = decodeURIComponent(u.pathname.replace(/\+/g, ' '));
  const place = decoded.match(/\/place\/([^/]+)/);
  if (place) r.name = place[1].trim();
  // !3d<lat>!4d<lon> is the pin itself; @lat,lon is only the viewport centre.
  const pin = [...url.matchAll(/!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/g)].pop();
  const at = url.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
  const q = u.searchParams.get('q') || u.searchParams.get('query') || u.searchParams.get('destination');
  const qCoords = q?.match(/^\s*(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)\s*$/);
  if (pin) r.location = { latitude: +pin[1], longitude: +pin[2], from: 'pin' };
  else if (qCoords) r.location = { latitude: +qCoords[1], longitude: +qCoords[2], from: 'query' };
  else if (at) r.location = { latitude: +at[1], longitude: +at[2], from: 'viewport' };
  if (!r.name && q && !qCoords) r.name = q.trim();
  return r;
}

// Nominatim's usage policy allows at most one request per second.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCall = 0;
async function nominatim(path, params) {
  const url = new URL(`https://nominatim.openstreetmap.org/${path}`);
  for (const [k, v] of Object.entries({ format: 'jsonv2', addressdetails: 1, 'accept-language': 'en', ...params })) url.searchParams.set(k, v);
  for (let attempt = 0; attempt < 3; attempt++) {
    await sleep(Math.max(0, lastCall + 1100 * (attempt + 1) - Date.now()));
    lastCall = Date.now();
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (res.ok) return res.json();
    if (res.status !== 429 && res.status < 500) throw new Error(`Nominatim ${res.status}`);
  }
  throw new Error('Nominatim unavailable (rate limited) — retry in a minute');
}

const cityOf = (a = {}) => a.city || a.town || a.village || a.municipality || a.city_district || a.county || null;
const addressOf = (a = {}) => {
  const street = [a.road || a.pedestrian || a.square, a.house_number].filter(Boolean).join(' ');
  return [street, a.postcode, cityOf(a)].filter(Boolean).join(', ') || null;
};

/**
 * @param {string} input Google Maps URL
 * @param {{ name?: string, city?: string }} [hints]
 */
export async function resolvePlace(input, { name: nameHint, city: cityHint } = {}) {
  const out = { input, expandedUrl: input, name: null, location: null, city: null, country: null, address: null, source: [], candidates: [], warnings: [] };
  try {
    const { url, html } = await expand(input);
    out.expandedUrl = url;
    const parsed = parseUrl(url);
    out.name = nameHint || parsed.name;
    if (parsed.location) {
      const { from, ...loc } = parsed.location;
      out.location = loc;
      out.source.push(`coordinates from Google URL (${from})`);
      if (from === 'viewport') out.warnings.push('Coordinates are the map viewport centre, not the pin — verify.');
    }
    if (!out.name && html) {
      const t = html.match(/<meta[^>]+(?:property|itemprop)="(?:og:title|name)"[^>]+content="([^"]+)"/);
      if (t && !/^Google Maps$/i.test(t[1])) out.name = t[1].split(' · ')[0].trim();
    }

    if (!out.location && out.name) {
      const q = [out.name, cityHint].filter(Boolean).join(', ');
      const hits = await nominatim('search', { q, limit: 5 });
      out.candidates = hits.map((h) => ({
        name: h.name || h.display_name.split(',')[0],
        displayName: h.display_name,
        location: { latitude: +h.lat, longitude: +h.lon },
        type: `${h.category}/${h.type}`,
      }));
      if (hits.length) {
        out.location = out.candidates[0].location;
        out.source.push(`coordinates from OpenStreetMap search for "${q}"`);
        if (hits.length > 1) out.warnings.push(`${hits.length} OpenStreetMap matches — confirm the right one (see candidates).`);
      } else {
        out.warnings.push(`No OpenStreetMap match for "${q}" — use web search to find the address/coordinates.`);
      }
    }

    if (out.location) {
      const rev = await nominatim('reverse', { lat: out.location.latitude, lon: out.location.longitude, zoom: 18 });
      const a = rev.address ?? {};
      out.city = cityOf(a);
      out.country = a.country ?? null;
      out.address = addressOf(a);
      out.source.push('city/country/address from OpenStreetMap reverse geocoding');
      if (!out.name && rev.name) {
        out.name = rev.name;
        out.warnings.push('Name taken from OpenStreetMap, not Google — verify.');
      }
    }
    if (!out.name) out.warnings.push('Could not determine the place name — ask the author or search the web.');
    if (!out.location) out.warnings.push('Could not determine coordinates.');
    out.suggestedSlug = out.name ? slugify(out.name) : null;
  } catch (e) {
    out.warnings.push(`Resolution error: ${e.message}`);
  }
  return out;
}
