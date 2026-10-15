// Build-time access to the POI data contract (data/pois/**.json).
import taxonomy from '../../data/taxonomy.json';
import { slugify } from '../../scripts/lib/slugify.mjs';

export type VibeId = 'no-frills' | 'hipster' | 'casual' | 'fancy';
export type ServesId = 'breakfast-brunch' | 'coffee' | 'ice-cream' | 'bakery' | 'lunch' | 'dinner' | 'cocktails' | 'beer-wine';
export type Status = 'active' | 'temporarily-closed' | 'closed' | 'archived';

export interface Poi {
  id: string;
  slug: string;
  name: string;
  city: string;
  country?: string | null;
  location: { latitude: number; longitude: number };
  vibe: VibeId;
  serves: ServesId[];
  tags?: string[];
  recommendation: string;
  googleMapsUrl?: string | null;
  website?: string | null;
  address?: string | null;
  images?: string[];
  imageAlt?: string[];
  status: Status;
  createdAt: string;
  updatedAt: string;
}

export interface ImageVariant { w: number; path: string }
export interface PoiImage { file: string; width: number; height: number; variants: ImageVariant[] }

export interface City { name: string; slug: string; country: string | null; count: number; center: { latitude: number; longitude: number } }

export const vibes = taxonomy.vibes as { id: VibeId; label: string }[];
export const serves = taxonomy.serves as { id: ServesId; label: string }[];
export const vibeLabel = (id: string) => vibes.find((v) => v.id === id)?.label ?? id;
/** Service labels in taxonomy order ("Lunch", "Dinner"). */
export const servesLabels = (p: Poi) => serves.filter((s) => p.serves.includes(s.id)).map((s) => s.label);

// Same slug rules as the authoring scripts, so URLs match folder names.
export { slugify };

const files = import.meta.glob<Poi>('/data/pois/*/*.json', { eager: true, import: 'default' });
const manifestFiles = import.meta.glob<Record<string, PoiImage[]>>('/src/generated/images.json', { eager: true, import: 'default' });
const imageManifest = Object.values(manifestFiles)[0] ?? {};

/** Every POI except archived ones (those are kept in git only). */
export const allPois: Poi[] = Object.values(files)
  .filter((p) => p.status !== 'archived')
  .sort((a, b) => a.name.localeCompare(b.name));

/** POIs shown in lists and on maps. */
export const activePois = allPois.filter((p) => p.status === 'active');

export const citySlug = (p: Poi) => slugify(p.city);

export const cities: City[] = Object.values(
  activePois.reduce<Record<string, Poi[]>>((acc, p) => {
    (acc[citySlug(p)] ??= []).push(p);
    return acc;
  }, {}),
)
  .map((pois) => ({
    name: pois[0].city,
    slug: citySlug(pois[0]),
    country: pois[0].country ?? null,
    count: pois.length,
    center: {
      latitude: pois.reduce((s, p) => s + p.location.latitude, 0) / pois.length,
      longitude: pois.reduce((s, p) => s + p.location.longitude, 0) / pois.length,
    },
  }))
  .sort((a, b) => a.name.localeCompare(b.name));

export const imagesFor = (p: Poi): PoiImage[] => imageManifest[p.id] ?? [];

export const recentPois = [...activePois].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 4);

/** The author's Google Maps link, or a search for the place by name and address (which opens the place itself, not a dropped pin). */
export function googleMapsHref(p: Poi): string {
  if (p.googleMapsUrl) return p.googleMapsUrl;
  const query = [p.name, p.address || `${p.location.latitude},${p.location.longitude}`, p.address ? p.city : null].filter(Boolean).join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** Text used by client-side search: name, city, vibe, when to go, tags, recommendation. */
export function searchText(p: Poi): string {
  return [p.name, p.city, p.country, vibeLabel(p.vibe), ...servesLabels(p), ...(p.tags ?? []), ...(p.tags ?? []).map((t) => t.replace(/-/g, ' ')), p.recommendation, p.address]
    .filter(Boolean)
    .join(' ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
