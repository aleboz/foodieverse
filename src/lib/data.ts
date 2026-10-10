// Build-time access to the POI data contract (data/pois/**.json).
import taxonomy from '../../data/taxonomy.json';
import { slugify } from '../../scripts/lib/slugify.mjs';

export type CategoryId = 'eat' | 'drink' | 'coffee' | 'shop' | 'stay' | 'see' | 'explore' | 'other';
export type Status = 'active' | 'temporarily-closed' | 'closed' | 'archived';

export interface Poi {
  id: string;
  slug: string;
  name: string;
  city: string;
  country?: string | null;
  location: { latitude: number; longitude: number };
  category: CategoryId;
  tags?: string[];
  recommendation: string;
  rating?: 1 | 2 | 3 | null;
  googleMapsUrl?: string | null;
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

export const categories = taxonomy.categories as { id: CategoryId; label: string; icon: string; description: string }[];
export const ratingLabels = taxonomy.ratings as Record<string, string>;
export const category = (id: string) => categories.find((c) => c.id === id) ?? categories.at(-1)!;

// Same slug rules as the authoring scripts, so URLs match folder names.
export { slugify };

const files = import.meta.glob<Poi>('/data/pois/*/*.json', { eager: true, import: 'default' });
const manifestFiles = import.meta.glob<Record<string, PoiImage[]>>('/src/generated/images.json', { eager: true, import: 'default' });
const imageManifest = Object.values(manifestFiles)[0] ?? {};

/** Every POI except archived ones (those are kept in git only). */
export const allPois: Poi[] = Object.values(files)
  .filter((p) => p.status !== 'archived')
  .sort((a, b) => (b.rating ?? 0) - (a.rating ?? 0) || a.name.localeCompare(b.name));

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

export function googleMapsHref(p: Poi): string {
  return p.googleMapsUrl || `https://www.google.com/maps/search/?api=1&query=${p.location.latitude},${p.location.longitude}`;
}

/** Text used by client-side search: name, city, category, tags, recommendation. */
export function searchText(p: Poi): string {
  const c = category(p.category);
  return [p.name, p.city, p.country, c.label, c.id, ...(p.tags ?? []), ...(p.tags ?? []).map((t) => t.replace(/-/g, ' ')), p.recommendation, p.address]
    .filter(Boolean)
    .join(' ')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}
