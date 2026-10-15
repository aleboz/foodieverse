// Leaflet with a choice of base maps, loaded only when a map is actually shown.
import type { Map as LeafletMap, Marker, LatLngExpression, Layer } from 'leaflet';
import taxonomy from '../../data/taxonomy.json';

export interface MapPoi {
  id: string;
  name: string;
  lat: number;
  lng: number;
  vibe?: string;
  meta: string;
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
const vibeClass = (v?: string) => (v && /^[a-z-]+$/.test(v) ? ` vibe-${v}` : '');
const VIEW_KEY = 'foodieverse:mapView';
const OSM_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

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
  // Base maps (no API keys needed). "Map" is Esri's gray canvas plus its
  // street-name layer, light or dark to follow the phone's setting. All need
  // attribution; none allow bulk/offline use.
  const dark = window.matchMedia('(prefers-color-scheme: dark)');
  const canvasUrl = (part: 'Base' | 'Reference') =>
    `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_${dark.matches ? 'Dark' : 'Light'}_Gray_${part}/MapServer/tile/{z}/{y}/{x}`;
  const canvasOpts = { maxZoom: 19, maxNativeZoom: 16, attribution: `Tiles &copy; Esri &mdash; Esri, HERE, Garmin, ${OSM_ATTRIBUTION}` };
  const canvasBase = L.tileLayer(canvasUrl('Base'), canvasOpts);
  const canvasLabels = L.tileLayer(canvasUrl('Reference'), { maxZoom: 19, maxNativeZoom: 16 });
  const clean = L.layerGroup([canvasBase, canvasLabels]);
  dark.addEventListener('change', () => {
    canvasBase.setUrl(canvasUrl('Base'));
    canvasLabels.setUrl(canvasUrl('Reference'));
  });
  const bases: Record<string, Layer> = {
    Map: clean,
    OpenStreetMap: L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: OSM_ATTRIBUTION }),
    Satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Imagery &copy; Esri, Maxar, Earthstar Geographics',
    }),
  };
  let view = 'Map';
  if (interactive) {
    try {
      const saved = localStorage.getItem(VIEW_KEY);
      if (saved && bases[saved]) view = saved;
    } catch {
      /* storage unavailable */
    }
  }
  bases[view].addTo(map);
  if (interactive) {
    L.control.layers(bases, undefined, { position: 'topright' }).addTo(map);
    map.on('baselayerchange', (e) => {
      try {
        localStorage.setItem(VIEW_KEY, (e as unknown as { name: string }).name);
      } catch {
        /* storage unavailable */
      }
    });
  }
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
        html: `<div class="pin${vibeClass(p.vibe)}" data-id="${p.id}"></div>`,
        iconSize: [28, 28],
        iconAnchor: [3, 28],
        popupAnchor: [11, -25],
      }),
    });
    if (interactive) {
      marker.bindPopup(`<a class="popup-link" href="${p.url}">${escapeHtml(p.name)}</a><br><span class="meta">${escapeHtml(p.meta)}</span>`);
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
  if (interactive) {
    // Legend: the vibes present on this map, in taxonomy order.
    const present = taxonomy.vibes.filter((v) => pois.some((p) => p.vibe === v.id));
    if (present.length) {
      const legend = new L.Control({ position: 'topright' });
      legend.onAdd = () => {
        const el = L.DomUtil.create('div', 'map-legend');
        el.setAttribute('aria-label', 'Pin colours');
        el.innerHTML = present.map((v) => `<span><i class="dot${vibeClass(v.id)}" aria-hidden="true"></i>${escapeHtml(v.label)}</span>`).join('');
        return el;
      };
      legend.addTo(map);
    }

    // Show my location: a dot, zoomed to include places within 5 km.
    // Geolocation is requested only on click, used locally, never stored.
    if ('geolocation' in navigator) {
      const locate = new L.Control({ position: 'topleft' });
      locate.onAdd = () => {
        const bar = L.DomUtil.create('div', 'leaflet-bar');
        const btn = L.DomUtil.create('a', 'locate-btn', bar) as HTMLAnchorElement;
        btn.href = '#';
        btn.setAttribute('role', 'button');
        btn.title = 'Show my location';
        btn.setAttribute('aria-label', 'Show my location');
        btn.innerHTML = '<span aria-hidden="true">◎</span>';
        L.DomEvent.disableClickPropagation(bar);
        L.DomEvent.on(btn, 'click', (e) => {
          L.DomEvent.preventDefault(e);
          btn.classList.add('is-busy');
          navigator.geolocation.getCurrentPosition(
            (pos) => {
              btn.classList.remove('is-busy');
              showMeNearby(pos.coords.latitude, pos.coords.longitude);
            },
            () => {
              btn.classList.remove('is-busy');
              L.popup().setLatLng(map.getCenter()).setContent('Could not get your location.').openOn(map);
            },
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
          );
        });
        return bar;
      };
      locate.addTo(map);
    }
  }

  function showMeNearby(lat: number, lng: number) {
    const here = L.latLng(lat, lng);
    if (!me) {
      me = L.marker(here, {
        title: 'You are here',
        keyboard: false,
        icon: L.divIcon({ className: '', html: '<div class="me-dot"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }),
      }).addTo(map);
    } else me.setLatLng(here);
    const near = [...visible].map((id) => markers.get(id)!.getLatLng()).filter((p) => p.distanceTo(here) < 5000);
    if (near.length) map.fitBounds(L.latLngBounds([...near, here]).pad(0.15), { maxZoom: 16 });
    else map.setView(here, 15);
  }

  api.fit();
  return api;
}
