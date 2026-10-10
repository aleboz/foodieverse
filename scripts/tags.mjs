#!/usr/bin/env node
// Lists the tags already in use, most frequent first, so the authoring agent
// can reuse existing vocabulary before inventing new tags.
//   npm run tags            -> human-readable
//   npm run tags -- --json  -> machine-readable
import { loadPois } from './lib/poi.mjs';

const counts = new Map();
for (const { data } of loadPois()) {
  for (const t of data?.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
}
const sorted = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(Object.fromEntries(sorted), null, 2));
} else if (!sorted.length) {
  console.log('No tags yet.');
} else {
  for (const [t, n] of sorted) console.log(`${String(n).padStart(3)}  ${t}`);
}
