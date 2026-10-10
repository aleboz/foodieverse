#!/usr/bin/env node
// Issue-based authoring: turns a "New place" / "Update a place" issue into a
// preview comment, applies corrections from follow-up comments, and publishes
// on "yes". Run by .github/workflows/issue-authoring.yml; the workflow only
// calls this for issues and comments from the repository's owner/collaborators.
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { loadPois, slugify, taxonomy, poiPaths, ROOT, findDuplicates, distanceMeters } from './lib/poi.mjs';
import { resolvePlace, geocode } from './lib/resolve.mjs';
import { aiEnabled, suggestNewPlace, interpretChange, verifyPlace } from './lib/ai.mjs';

const { GITHUB_TOKEN, GITHUB_REPOSITORY, GITHUB_EVENT_PATH, GITHUB_EVENT_NAME } = process.env;
const event = JSON.parse(readFileSync(GITHUB_EVENT_PATH, 'utf8'));
const issue = event.issue;
const STATE_RE = /<!-- foodieverse-state:([A-Za-z0-9+/=]+) -->/;
const YES_RE = /^\s*(yes|y|yes please|publish|ok|okay|ja|sì|si|oui|go)\s*[.!👍]*\s*$/i;
const tmp = mkdtempSync(join(tmpdir(), 'foodieverse-'));

// ---------- GitHub API ----------
async function gh(path, { method = 'GET', body } = {}) {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: {
      authorization: `Bearer ${GITHUB_TOKEN}`,
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`GitHub API ${method} ${path} → ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}
const repo = `/repos/${GITHUB_REPOSITORY}`;
const comment = (body) => gh(`${repo}/issues/${issue.number}/comments`, { method: 'POST', body: { body } });
const closeIssue = () => gh(`${repo}/issues/${issue.number}`, { method: 'PATCH', body: { state: 'closed', state_reason: 'completed' } });

async function siteUrl() {
  try {
    const pages = await gh(`${repo}/pages`);
    if (pages?.html_url) return pages.html_url.replace(/\/?$/, '/');
  } catch {
    /* fall back to the Astro config */
  }
  const cfg = readFileSync(join(ROOT, 'astro.config.mjs'), 'utf8');
  const site = cfg.match(/site:\s*'([^']+)'/)?.[1] ?? '';
  const base = cfg.match(/base:\s*'([^']+)'/)?.[1] ?? '/';
  return `${site}${base}`.replace(/\/?$/, '/');
}

// ---------- Parsing ----------
/** Issue forms render as "### Label\n\nvalue" sections. */
function parseForm(body = '') {
  const out = {};
  for (const part of body.split(/^### /m).slice(1)) {
    const nl = part.indexOf('\n');
    const label = part.slice(0, nl).trim();
    let value = part.slice(nl + 1).trim();
    if (value === '_No response_' || value === 'None') value = '';
    out[label] = value;
  }
  return out;
}

function imageUrls(text = '') {
  const urls = new Set();
  for (const m of text.matchAll(/!\[[^\]]*\]\((https:\/\/[^)\s]+)\)/g)) urls.add(m[1]);
  for (const m of text.matchAll(/<img[^>]+src="(https:\/\/[^"]+)"/g)) urls.add(m[1]);
  return [...urls];
}

/** The reply without quoted lines and without a trailing signature (after "---" or "-- "). */
function replyText(text = '') {
  const lines = [];
  for (const line of text.split('\n')) {
    if (/^\s*(---+|___+|\*\*\*+|-- )\s*$/.test(line)) break;
    if (/^\s*(sent from my|get outlook for|sent with)\b/i.test(line)) break;
    if (!/^\s*>/.test(line)) lines.push(line);
  }
  return stripImages(lines.join('\n'));
}

const stripImages = (text = '') =>
  text.replace(/!\[[^\]]*\]\([^)]*\)/g, '').replace(/<img[^>]*>/g, '').trim();

const MAPS_URL_RE = /https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|(?:www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+)\S*/i;
const GENERIC_TITLE_RE = /^\s*(new place|new|place|untitled|issue)?\s*$/i;
const NUMBER_WORDS = { one: 1, two: 2, three: 3 };

const HEART_RE = /♥|❤️?|<3/g;
const COUNT_RE = /\b([1-3]|one|two|three)\s*hearts?\b/gi;
const TAG_RE = /(^|\s)#([\p{L}\p{N}][\p{L}\p{N}-]*)/gu;
const leftover = (t) => t.replace(/[\s,;:·.!-]/g, '');

/**
 * Reads hearts, category and #tags from plain text, e.g. "♥♥ drink #natural-wine"
 * or "3 hearts". Strict mode (new places) only reads lines made up entirely of
 * such tokens and removes them from the text, so "I ❤️ this place" stays text.
 * Loose mode (correction replies) reads them anywhere, plus status words
 * ("it has closed", "reopened").
 */
function parseSimple(text = '', { loose = false } = {}) {
  const found = {};
  const keep = [];
  for (const line of text.split('\n')) {
    const hearts = (line.match(HEART_RE) ?? []).length;
    const count = [...line.matchAll(COUNT_RE)].at(-1);
    const tags = [...line.matchAll(TAG_RE)].map((m) => m[2]);
    let rest = line.replace(HEART_RE, ' ').replace(COUNT_RE, ' ').replace(TAG_RE, ' ');
    let category = null;
    for (const c of taxonomy.categories) {
      const re = new RegExp(`(^|[^\\p{L}])(category:?\\s*)?${c.label}(?![\\p{L}])`, 'iu');
      if (re.test(rest) && (loose || !leftover(rest.replace(re, ' ')))) {
        category = c.id;
        rest = rest.replace(re, ' ');
        break;
      }
    }
    const isMeta = (hearts || count || tags.length || category) && !leftover(rest);
    if (isMeta || loose) {
      if (count) found.rating = NUMBER_WORDS[count[1].toLowerCase()] ?? Number(count[1]);
      else if (hearts) found.rating = Math.min(3, hearts);
      if (tags.length) found.tags = [...(found.tags ?? []), ...tags];
      if (category) found.category = category;
    }
    if (loose) {
      if (/\btemporar(il)?y closed\b/i.test(line)) found.status = 'temporarily-closed';
      else if (/\b(re-?opened|open again)\b/i.test(line)) found.status = 'active';
      else if (/\b(closed|shut down)\b/i.test(line)) found.status = 'closed';
      else if (/\b(archive|hide it)\b/i.test(line)) found.status = 'archived';
    }
    if (!isMeta) keep.push(line);
  }
  return { ...found, text: keep.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
}

/** A plain issue: Maps link + text (+ optional hearts/category/#tags line), or "Update …". */
function parsePlainIssue(title = '', body = '') {
  const titleText = GENERIC_TITLE_RE.test(title) ? '' : title.trim();
  const all = stripImages(`${titleText}\n${body ?? ''}`).trim();
  if (/^update\b/i.test(all)) {
    const [first, ...more] = all.replace(/^update\s*:?\s*/i, '').split('\n');
    const split = first.match(/^(.*?)(?::|\s[-–—]\s)(.*)$/);
    const place = (split ? split[1] : first).trim();
    const change = [split ? split[2] : '', ...more].join('\n').trim();
    return { kind: 'update', place, change, images: imageUrls(body) };
  }
  const url = all.match(MAPS_URL_RE)?.[0];
  if (!url) return null;
  const textBody = stripImages(body ?? '').replace(url, '').trim();
  const parsed = parseSimple(textBody);
  return {
    kind: 'add',
    url,
    recommendation: parsed.text,
    hearts: parsed.rating ?? null,
    category: parsed.category ?? null,
    tags: cleanTags(parsed.tags),
    keepText: false,
    nameHint: '', // the title is only used as a fallback if the link can't be resolved
    cityHint: '',
    images: imageUrls(body),
  };
}

async function downloadImages(urls) {
  const files = [];
  for (const [i, url] of urls.entries()) {
    const res = await fetch(url, { headers: { authorization: `Bearer ${GITHUB_TOKEN}` } });
    if (!res.ok) throw new Error(`Could not download photo ${i + 1} (HTTP ${res.status}).`);
    const type = res.headers.get('content-type') ?? '';
    if (!type.startsWith('image/')) throw new Error(`Photo ${i + 1} is not an image (${type || 'unknown type'}).`);
    const ext = type.includes('png') ? 'png' : type.includes('webp') ? 'webp' : type.includes('heic') || type.includes('heif') ? 'heic' : 'jpg';
    const file = join(tmp, `upload-${i + 1}.${ext}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
    files.push(file);
  }
  return files;
}

// ---------- State (stored in a hidden marker in the preview comment) ----------
const encodeState = (s) => `<!-- foodieverse-state:${Buffer.from(JSON.stringify(s)).toString('base64')} -->`;

async function latestState() {
  const comments = await gh(`${repo}/issues/${issue.number}/comments?per_page=100`);
  for (const c of comments.reverse()) {
    const m = c.body?.match(STATE_RE);
    if (m) return JSON.parse(Buffer.from(m[1], 'base64').toString('utf8'));
  }
  return null;
}

// ---------- Data helpers ----------
const allPois = () => loadPois().map((e) => e.data).filter(Boolean);
function existingTags() {
  const counts = {};
  for (const p of allPois()) for (const t of p.tags ?? []) counts[t] = (counts[t] ?? 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]));
}
const cleanTags = (tags) => [...new Set((tags ?? []).map((t) => slugify(t)).filter(Boolean))];
const categoryLabel = (id) => taxonomy.categories.find((c) => c.id === id)?.label ?? id;

function runPoi(args) {
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'poi.mjs'), ...args], { cwd: ROOT, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}${r.stderr}`.trim() };
}

function findPlace(query) {
  const pois = allPois();
  const path = query.match(/\/([a-z0-9-]+)\/([a-z0-9-]+)\/?(?:[?#].*)?$/);
  if (path) {
    const hit = pois.find((p) => slugify(p.city) === path[1] && p.slug === path[2]);
    if (hit) return [hit];
  }
  const q = slugify(query);
  const exact = pois.filter((p) => slugify(`${p.name} ${p.city}`) === q || slugify(p.name) === q);
  if (exact.length) return exact;
  const words = q.split('-').filter((w) => w.length > 1);
  return pois.filter((p) => {
    const hay = slugify(`${p.name} ${p.city}`);
    return words.every((w) => hay.includes(w));
  });
}

// ---------- Preview ----------
function previewMarkdown(p, { photos = 0, notes = [], diff = null } = {}) {
  const lines = [
    `**${p.name}** · ${p.city}${p.country ? `, ${p.country}` : ''}`,
    '',
    `${p.rating ? '♥'.repeat(p.rating) : '(no hearts)'} · ${categoryLabel(p.category)}${p.status && p.status !== 'active' ? ` · **${p.status}**` : ''}`,
    (p.tags ?? []).length ? p.tags.map((t) => `\`${t}\``).join(' ') : '_(no tags)_',
    '',
    ...p.recommendation.split('\n').map((l) => `> ${l}`),
    '',
    `📍 ${p.address ?? `${p.location.latitude.toFixed(5)}, ${p.location.longitude.toFixed(5)}`}` +
      ` · [check on map](https://www.openstreetmap.org/?mlat=${p.location.latitude}&mlon=${p.location.longitude}#map=17/${p.location.latitude}/${p.location.longitude})` +
      (photos ? ` · 🖼 ${photos} photo${photos > 1 ? 's' : ''}` : ''),
  ];
  if (diff) lines.push('', '<details><summary>Changes</summary>', '', '```diff', diff, '```', '</details>');
  for (const n of notes.filter(Boolean)) lines.push('', `> [!NOTE]\n> ${n}`);
  lines.push(
    '',
    '---',
    aiEnabled()
      ? 'Reply **yes** to publish, or reply with corrections in plain words (e.g. "make it three hearts", "remove expensive", "keep my original text").'
      : 'Reply **yes** to publish, or reply with corrections such as "3 hearts", "Drink", "#terrace" or "remove #expensive".',
  );
  return lines.join('\n');
}

function textDiff(before, after) {
  const keys = ['name', 'category', 'rating', 'tags', 'status', 'address', 'recommendation'];
  const out = [];
  for (const k of keys) {
    const a = JSON.stringify(before[k] ?? null);
    const b = JSON.stringify(after[k] ?? null);
    if (a !== b) out.push(`- ${k}: ${a}`, `+ ${k}: ${b}`);
  }
  return out.join('\n');
}

async function postPreview(state, poiForPreview, { notes = [], diff = null } = {}) {
  // Validate through the same CLI the agents use, without writing anything.
  const files = await downloadImages(state.images);
  const imageArgs = files.flatMap((f) => ['--image', f]);
  let check;
  if (state.kind === 'add') {
    const draftFile = join(tmp, 'draft.json');
    writeFileSync(draftFile, JSON.stringify(state.draft));
    check = runPoi(['add', draftFile, ...imageArgs, '--dry-run']);
  } else {
    const patchFile = join(tmp, 'patch.json');
    writeFileSync(patchFile, JSON.stringify(state.patch));
    check = runPoi(['update', state.ref, patchFile, ...imageArgs, '--dry-run']);
  }
  if (check.code === 1) {
    const errors = check.out.split('Validation failed:')[1] ?? check.out;
    await comment(`I couldn't prepare this place:\n\n\`\`\`\n${errors.trim()}\n\`\`\`\n\nReply with a correction, or edit the issue.\n\n${encodeState(state)}`);
    return;
  }
  const photos = (poiForPreview.images?.length ?? 0) + state.images.length;
  await comment(`${previewMarkdown(poiForPreview, { photos, notes, diff })}\n\n${encodeState(state)}`);
}

// ---------- Flows ----------
async function startFromIssue() {
  const form = parseForm(issue.body);
  if ('Google Maps link' in form) {
    const [nameHint, cityHint] = (form['Place name and city'] || '').split(',').map((v) => v.trim());
    return startNewPlace({
      url: form['Google Maps link'].match(/https?:\/\/\S+/)?.[0],
      recommendation: stripImages(form['Your recommendation']),
      hearts: { '♥ Recommended': 1, '♥♥ Strong recommendation': 2, "♥♥♥ Don't miss": 3 }[form.Hearts] ?? null,
      category: taxonomy.categories.find((c) => c.label === form.Category)?.id ?? null,
      tags: cleanTags((form.Tags || '').split(',')),
      keepText: /\[x\]/i.test(form.Text || ''),
      nameHint: nameHint || '',
      cityHint: cityHint || '',
      images: imageUrls(form.Photos),
    });
  }
  if ('Which place?' in form) {
    return startUpdate({ place: form['Which place?'], change: stripImages(form['What should change?'] || ''), images: imageUrls(form['Photos to add']) });
  }
  const plain = parsePlainIssue(issue.title, issue.body);
  if (plain?.kind === 'add') return startNewPlace(plain);
  if (plain?.kind === 'update') return startUpdate(plain);
  await comment(
    'To add a place, write the Google Maps link and your recommendation, optionally with a line like `♥♥ drink #natural-wine`.\n' +
      'To change one, start with `Update`, e.g. `Update Bar Vivant, Copenhagen: one heart`.',
  );
}

/**
 * Web check (AI + web search): confirm the OpenStreetMap match, use the place's
 * proper name and address, and re-locate it when the address was wrong.
 * Mutates `place`, adds a line to `notes`. Returns true when a verdict was made.
 */
async function checkPlace(place, url, recommendation, notes) {
  let v;
  try {
    v = await verifyPlace({ mapsUrl: url, resolved: place, recommendation });
  } catch (e) {
    notes.push(`Couldn't double-check the place on the web this time (${e.message}).`);
    return false;
  }
  if (!v) return false;
  const source = v.source ? ` ([source](${v.source}))` : '';
  const changes = [];
  if (v.name && v.name.trim() && v.name.trim() !== place.name) {
    changes.push(`name "${place.name}" → "${v.name.trim()}"`);
    place.name = v.name.trim();
  }
  const norm = (a) => (a ?? '').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const addressChanged = v.address && norm(v.address) !== norm(place.address);
  if (!v.same_place && v.address) {
    const found = await geocode(v.address).catch(() => null) ?? (await geocode(`${place.name}, ${v.city ?? place.city}`).catch(() => null));
    if (found) {
      changes.push(`location moved to ${v.address}`);
      place.location = found.location;
      place.city = v.city || found.city || place.city;
      place.country = v.country || found.country || place.country;
      place.address = v.address;
    } else {
      notes.push(`⚠️ The web check says this is ${place.name}, ${v.address}, but I couldn't find that address on the map. Check the map link below before saying yes.${source}`);
      return true;
    }
  } else if (addressChanged) {
    // Keep pin and address consistent: re-locate when the verified address is elsewhere.
    const found = await geocode(v.address).catch(() => null);
    if (found && distanceMeters(found.location, place.location) > 200) {
      changes.push(`location moved to ${v.address}`);
      place.location = found.location;
      place.city = v.city || found.city || place.city;
      place.country = v.country || found.country || place.country;
    } else {
      changes.push(`address → ${v.address}`);
    }
    place.address = v.address;
  }
  if (v.city && v.city !== place.city && !v.same_place) place.city = v.city;
  const prefix = v.confidence === 'low' ? '⚠️ Web check not conclusive' : changes.length ? '✏️ Web check corrected' : '✓ Web check confirmed';
  notes.push(`${prefix}${changes.length ? `: ${changes.join('; ')}` : ''}. ${v.note}${source}`);
  return true;
}

async function startNewPlace(input) {
  const { url, recommendation } = input;
  if (!url || !recommendation) return comment('I need both a Google Maps link and your recommendation — please edit the issue.');

  let place = await resolvePlace(url, { name: input.nameHint || undefined, city: input.cityHint || undefined });
  if ((!place.name || !place.location || !place.city) && !input.nameHint && issue.title && !GENERIC_TITLE_RE.test(issue.title) && !issue.title.includes(url)) {
    place = await resolvePlace(url, { name: issue.title.trim() });
  }
  if ((!place.location || !place.city) && place.name && aiEnabled()) {
    // Last resort: let the web check find the address, then put it on the map.
    try {
      const v = await verifyPlace({ mapsUrl: url, resolved: place, recommendation });
      const found = v?.address ? await geocode(v.address) : null;
      if (found) {
        Object.assign(place, {
          name: v.name?.trim() || place.name,
          location: found.location,
          city: v.city || found.city,
          country: v.country || found.country,
          address: v.address,
          warnings: [],
          candidates: [],
        });
        place.foundByWebCheck = `✏️ Found via web check: ${place.name}, ${v.address}. ${v.note}${v.source ? ` ([source](${v.source}))` : ''}`;
      }
    } catch {
      /* fall through to the message below */
    }
  }
  if (!place.name || !place.location || !place.city) {
    return comment(
      `I couldn't work out which place this link points to${place.warnings.length ? ` (${place.warnings.join(' ')})` : ''}.\n\n` +
        'Please paste the link from the Google Maps **Share** button, or put the place name and city in the issue title (e.g. "Bar Vivant, Copenhagen").',
    );
  }
  const notes = [...place.warnings];
  const verified = place.foundByWebCheck ? (notes.push(place.foundByWebCheck), true) : await checkPlace(place, url, recommendation, notes);
  if (!verified && place.candidates.length > 1) notes.push(`Matched "${place.candidates[0].displayName}". If that's wrong, put the place name and city in the issue title.`);

  const { hearts, category, tags: userTags, keepText } = input;

  let ai = null;
  try {
    ai = await suggestNewPlace({ name: place.name, city: place.city, recommendation, existingTags: existingTags() });
  } catch (e) {
    notes.push(`AI suggestions unavailable this time (${e.message}).`);
  }
  if (!ai && !aiEnabled()) notes.push('AI suggestions are off (no API key configured), so category, hearts and tags come only from what you wrote.');
  if (ai?.notes) notes.push(ai.notes);

  const draft = {
    name: place.name,
    city: place.city,
    country: place.country,
    location: place.location,
    category: category ?? ai?.category ?? 'other',
    tags: userTags.length ? userTags : cleanTags(ai?.tags),
    recommendation: keepText || !ai ? recommendation : ai.recommendation.trim() || recommendation,
    rating: hearts ?? ai?.rating ?? null,
    googleMapsUrl: url,
    address: place.address,
  };
  const dupes = findDuplicates({ ...draft, id: '' }, allPois());
  for (const d of dupes) notes.push(`"${d.name}" in ${d.city} already exists (${d.status}). To change it instead, open an issue starting with \`Update\`.`);

  const state = { kind: 'add', draft, original: recommendation, images: input.images };
  await postPreview(state, draft, { notes });
}

async function startUpdate({ place: query, change, images }) {
  const hits = query ? findPlace(query) : [];
  if (hits.length !== 1) {
    const list = hits.slice(0, 8).map((p) => `- ${p.name}, ${p.city}`).join('\n');
    return comment(
      hits.length
        ? `Several places match "${query}":\n\n${list}\n\nPlease edit the issue with the exact name and city.`
        : `I couldn't find "${query}". Please edit the issue with the exact name and city (e.g. \`Update Bar Vivant, Copenhagen: one heart\`), or the link to its page.`,
    );
  }
  const poi = hits[0];
  const ref = `${slugify(poi.city)}/${poi.slug}`;
  await applyChangeRequest({ kind: 'update', ref, patch: {}, images }, change);
}

/** Apply a plain-words change request to the current state and post a new preview. */
async function applyChangeRequest(state, request) {
  const notes = [];
  const current =
    state.kind === 'add'
      ? { ...state.draft, status: 'active' }
      : { ...JSON.parse(readFileSync(poiPaths(...state.ref.split('/')).json, 'utf8')), ...state.patch };

  if (request) {
    if (!aiEnabled()) {
      const simple = parseSimple(request, { loose: true });
      const understood = [];
      if (simple.rating) { current.rating = simple.rating; understood.push(`${'♥'.repeat(simple.rating)}`); }
      if (simple.category) { current.category = simple.category; understood.push(categoryLabel(simple.category)); }
      if (simple.status) { current.status = simple.status; understood.push(simple.status); }
      if (simple.tags?.length) {
        const remove = /\b(remove|delete|drop|without)\b/i.test(request);
        const tags = cleanTags(simple.tags);
        current.tags = remove ? (current.tags ?? []).filter((t) => !tags.includes(t)) : cleanTags([...(current.tags ?? []), ...tags]);
        understood.push(`${remove ? 'removed' : 'added'} ${tags.map((t) => `#${t}`).join(' ')}`);
      }
      notes.push(
        understood.length
          ? `Changed: ${understood.join(', ')}.`
          : 'Without the AI I only understand hearts (`♥♥`, "3 hearts"), a category word, `#tags` (add, or "remove #tag") and "closed" / "reopened". Edit the issue to change anything else.',
      );
    } else {
      let change = null;
      try {
        change = await interpretChange({ poi: current, request, existingTags: existingTags() });
      } catch (e) {
        notes.push(`I couldn't process that (${e.message}). Try rephrasing.`);
      }
      if (change) {
        if (/original text|my text|exactly as (i )?wrote/i.test(request) && state.original) change.recommendation = state.original;
        for (const k of ['name', 'category', 'rating', 'recommendation', 'status', 'address']) {
          if (change[k] !== null && change[k] !== undefined) current[k] = change[k];
        }
        if (change.tags) current.tags = cleanTags(change.tags);
        if (change.reply) notes.unshift(change.reply);
      }
    }
  }

  if (state.kind === 'add') {
    const { status, ...draft } = current;
    state.draft = { ...draft, status: status === 'active' ? undefined : status };
    if (!state.draft.status) delete state.draft.status;
    return postPreview(state, current, { notes });
  }
  const original = JSON.parse(readFileSync(poiPaths(...state.ref.split('/')).json, 'utf8'));
  state.patch = {};
  for (const k of ['name', 'category', 'rating', 'tags', 'recommendation', 'status', 'address']) {
    if (JSON.stringify(current[k] ?? null) !== JSON.stringify(original[k] ?? null)) state.patch[k] = current[k];
  }
  if (!Object.keys(state.patch).length && !state.images.length) notes.push('Nothing to change yet — reply with what should change.');
  return postPreview(state, current, { notes, diff: textDiff(original, current) || null });
}

async function publish(state) {
  const files = await downloadImages(state.images);
  const imageArgs = files.flatMap((f) => ['--image', f]);
  let result;
  let message;
  if (state.kind === 'add') {
    const draftFile = join(tmp, 'draft.json');
    writeFileSync(draftFile, JSON.stringify(state.draft));
    result = runPoi(['add', draftFile, ...imageArgs]);
    message = `Add ${state.draft.name} (${state.draft.city})`;
  } else {
    const patchFile = join(tmp, 'patch.json');
    writeFileSync(patchFile, JSON.stringify(state.patch));
    result = runPoi(['update', state.ref, patchFile, ...imageArgs]);
    const p = JSON.parse(readFileSync(poiPaths(...state.ref.split('/')).json, 'utf8'));
    message = state.patch.status && state.patch.status !== 'active' ? `${state.patch.status === 'closed' ? 'Close' : 'Update'} ${p.name}: ${state.patch.status}` : `Update ${p.name} (${p.city})`;
  }
  if (result.code !== 0) return comment(`Publishing failed — nothing was changed:\n\n\`\`\`\n${result.out}\n\`\`\``);
  const written = result.out.match(/wrote data\/pois\/([a-z0-9-]+)\/([a-z0-9-]+)\.json/);
  const validate = spawnSync('npm', ['run', '-s', 'validate'], { cwd: ROOT, encoding: 'utf8' });
  if (validate.status !== 0) return comment(`Publishing failed — the collection didn't validate:\n\n\`\`\`\n${validate.stdout}${validate.stderr}\n\`\`\``);

  const git = (...a) => spawnSync('git', a, { cwd: ROOT, encoding: 'utf8' });
  git('config', 'user.name', 'foodieverse-bot');
  git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
  git('add', 'data');
  if (git('diff', '--cached', '--quiet').status === 0) return comment('There was nothing to change, so nothing was published.');
  git('commit', '-q', '-m', `${message}\n\nFrom issue #${issue.number}`);
  let pushed = false;
  for (let i = 0; i < 3 && !pushed; i++) {
    pushed = git('push', 'origin', 'HEAD:main').status === 0;
    if (!pushed) git('pull', '--rebase', 'origin', 'main');
  }
  if (!pushed) return comment('Publishing failed: I could not save the change to the repository. Please try again by replying **yes**.');

  // Pushes made by this workflow don't trigger other workflows, so start the
  // deployment explicitly and wait for it.
  const started = Date.now();
  await gh(`${repo}/actions/workflows/publish.yml/dispatches`, { method: 'POST', body: { ref: 'main' } });
  let run = null;
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10000));
    const runs = await gh(`${repo}/actions/workflows/publish.yml/runs?branch=main&event=workflow_dispatch&per_page=5`);
    run = runs.workflow_runs.find((r) => Date.parse(r.created_at) >= started - 30000) ?? null;
    if (run?.status === 'completed') break;
  }
  const base = await siteUrl();
  const [, citySlug, slug] = written ?? [null, ...state.ref.split('/')];
  const link = `${base}${citySlug}/${slug}/`;
  if (run?.conclusion === 'success') {
    await comment(`Published ✅ ${link}`);
    await closeIssue();
  } else if (run?.status === 'completed') {
    await comment(`The change is saved, but the website update failed. Details: ${run.html_url}`);
  } else {
    await comment(`The change is saved and the website is still updating; it should appear shortly at ${link}`);
    await closeIssue();
  }
}

// ---------- Main ----------
try {
  if (GITHUB_EVENT_NAME === 'issues') {
    await startFromIssue();
  } else if (GITHUB_EVENT_NAME === 'issue_comment') {
    const text = event.comment.body ?? '';
    const state = await latestState();
    if (!state) await startFromIssue();
    else {
      state.images = [...state.images, ...imageUrls(text)];
      if (YES_RE.test(replyText(text))) await publish(state);
      else await applyChangeRequest(state, replyText(text));
    }
  }
} catch (e) {
  console.error(e);
  await comment(`Something went wrong: ${e.message}`).catch(() => {});
  process.exit(1);
}
