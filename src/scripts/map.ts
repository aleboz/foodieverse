// Leaflet + OpenStreetMap, loaded only when a map is actually shown.
import type { Map as LeafletMap, Marker, LatLngExpression } from 'leaflet';

export interface MapPoi {
  id: string;
  name: string;
  lat: number;
  lng: number;
  icon: string;
  category: string;
  rating: number | null;
  url: string;
}

export interface PoiMap {
  map: LeafletMap;
  markers: Map<string, Marker>;
  setVisible(ids: Set<string>): void;
  highlight(id: string | null, opts?: { pan?: boolean; open?: boolean }): void;
  showMe(lat: number, lng: number): void;
  fit(): void;
  resize(): void;
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export async function createMap(
  el: HTMLElement,
  pois: MapPoi[],
  opts: { onSelect?: (id: string) => void; zoom?: number; interactive?: boolean } = {},
): Promise<PoiMap> {
  const [{ default: L }] = await Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')]);

  const interactive = opts.interactive ?? true;
  const map = L.map(el, {
    zoomControl: interactive,
    scrollWheelZoom: interactive,
    dragging: interactive || !L.Browser.mobile,
    tap: false,
    attributionControl: true,
  } as L.MapOptions);
  // OSM tile usage policy: attribution required, no bulk/offline use.
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }).addTo(map);
  map.attributionControl.setPrefix(false);

  const markers = new Map<string, Marker>();
  const visible = new Set(pois.map((p) => p.id));
  let me: Marker | null = null;

  for (const p of pois) {
    const marker = L.marker([p.lat, p.lng], {
      title: p.name,
      alt: p.name,
      keyboard: interactive,
      riseOnHover: true,
      icon: L.divIcon({
        className: '',
        html: `<div class="pin" data-id="${p.id}"><span aria-hidden="true">${p.icon}</span></div>`,
        iconSize: [34, 34],
        iconAnchor: [4, 34],
        popupAnchor: [13, -30],
      }),
    });
    if (interactive) {
      const hearts = p.rating ? `<span class="hearts" aria-label="${p.rating} of 3 hearts">${'♥'.repeat(p.rating)}</span>` : '';
      marker.bindPopup(`<a class="popup-link" href="${p.url}">${escapeHtml(p.name)}</a>${hearts}<br><span class="meta">${escapeHtml(p.category)}</span>`);
      marker.on('click', () => opts.onSelect?.(p.id));
    }
    marker.addTo(map);
    markers.set(p.id, marker);
  }

  const pinEl = (id: string) => markers.get(id)?.getElement()?.querySelector('.pin');

  const api: PoiMap = {
    map,
    markers,
    setVisible(ids) {
      for (const [id, m] of markers) {
        if (ids.has(id) && !visible.has(id)) m.addTo(map);
        if (!ids.has(id) && visible.has(id)) m.remove();
      }
      visible.clear();
      ids.forEach((id) => visible.add(id));
    },
    highlight(id, { pan = false, open = false } = {}) {
      document.querySelectorAll('.pin.is-active').forEach((n) => n.classList.remove('is-active'));
      if (!id) return;
      const m = markers.get(id);
      if (!m || !visible.has(id)) return;
      pinEl(id)?.classList.add('is-active');
      m.setZIndexOffset(1000);
      for (const [other, om] of markers) if (other !== id) om.setZIndexOffset(0);
      if (pan && !map.getBounds().pad(-0.1).contains(m.getLatLng())) map.panTo(m.getLatLng());
      if (open) m.openPopup();
    },
    showMe(lat, lng) {
      const pos: LatLngExpression = [lat, lng];
      if (!me) {
        me = L.marker(pos, {
          title: 'You are here',
          keyboard: false,
          icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
        }).addTo(map);
      } else me.setLatLng(pos);
      const pts = [...visible].map((id) => markers.get(id)!.getLatLng());
      map.fitBounds(L.latLngBounds([...pts, L.latLng(lat, lng)]).pad(0.15), { maxZoom: 16 });
    },
    fit() {
      const pts = [...visible].map((id) => markers.get(id)!.getLatLng());
      if (!pts.length) return;
      if (pts.length === 1) map.setView(pts[0], opts.zoom ?? 15);
      else map.fitBounds(L.latLngBounds(pts).pad(0.12), { maxZoom: 16 });
    },
    resize() {
      map.invalidateSize();
    },
  };
  api.fit();
  return api;
}
