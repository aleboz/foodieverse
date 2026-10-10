#!/usr/bin/env node
// Resolve a Google Maps link into name, coordinates, city, country and address.
//
//   npm run resolve -- "<google maps url>" [--name "Place name" --city "City"]
//
// Prints JSON: { input, expandedUrl, name, location, city, country, address,
//                source, candidates, warnings, suggestedSlug }
import { resolvePlace } from './lib/resolve.mjs';

const args = process.argv.slice(2);
const opt = (n) => {
  const i = args.indexOf(n);
  return i === -1 ? undefined : args.splice(i, 2)[1];
};
const name = opt('--name');
const city = opt('--city');
if (!args[0]) {
  console.error('usage: resolve "<google maps url>" [--name "..."] [--city "..."]');
  process.exit(1);
}
console.log(JSON.stringify(await resolvePlace(args[0], { name, city }), null, 2));
