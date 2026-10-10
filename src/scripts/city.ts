// City page behaviour: search, filters, list/map switching and "near me".
// Filter state lives in the URL query so reloads, shared links and the back
// button all behave predictably.
import type { MapPoi, PoiMap } from './map';

interface State {
  q: string;
  cat: string;
  tags: string[];
  min: number;
  view: 'list' | 'map';
}

const desktop = window.matchMedia('(min-width: 900px)');
const norm = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

function readState(): State {
  const p = new URLSearchParams(location.search);
  return {
    q: p.get('q') ?? '',
    cat: p.get('cat') ?? '',
    tags: (p.get('tag') ?? '').split(',').filter(Boolean),
    min: Number(p.get('min')) || 0,
    view: p.get('view') === 'map' ? 'map' : 'list',
  };
}

function stateUrl(s: State): string {
  const p = new URLSearchParams();
  if (s.q) p.set('q', s.q);
  if (s.cat) p.set('cat', s.cat);
  if (s.tags.length) p.set('tag', s.tags.join(','));
  if (s.min) p.set('min', String(s.min));
  if (s.view === 'map') p.set('view', 'map');
  const qs = p.toString();
  return location.pathname + (qs ? `?${qs}` : '');
}

export function initCity() {
  const root = document.getElementById('city')!;
  const cityKey = root.dataset.city!;
  const cards = [...document.querySelectorAll<HTMLLIElement>('#cards > .card')];
  const list = document.getElementById('cards')!;
  const originalOrder = [...cards];
  const input = document.getElementById('q') as HTMLInputElement;
  const clearQ = document.getElementById('clear-q')!;
  const count = document.getElementById('result-count')!;
  const noResults = document.getElementById('no-results')!;
  const resetBtn = document.getElementById('reset')!;
  const toggle = document.getElementById('view-toggle')!;
  const controls = document.getElementById('controls')!;
  const moreCount = document.getElementById('active-filter-count')!;
  const nearBtn = document.getElementById('near-me') as HTMLButtonElement;
  const mapData: MapPoi[] = JSON.parse(document.getElementById('map-data')!.textContent || '[]');

  let state = readState();
  let poiMap: PoiMap | null = null;
  let mapLoading: Promise<PoiMap> | null = null;
  let visibleIds = new Set(cards.map((c) => c.dataset.id!));
  let me: { lat: number; lng: number } | null = null;

  try {
    localStorage.setItem('foodieverse:lastCity', JSON.stringify({ slug: cityKey, name: root.dataset.cityName }));
  } catch {
    /* storage unavailable */
  }

  const ensureMap = () => {
    if (!mapLoading) {
      mapLoading = import('./map').then(({ createMap }) =>
        createMap(document.getElementById('map')!, mapData, { onSelect: selectFromMap }),
      );
      mapLoading.then((m) => {
        poiMap = m;
        m.setVisible(visibleIds);
        m.fit();
        if (me) m.showMe(me.lat, me.lng);
      });
    }
    return mapLoading;
  };

  function selectFromMap(id: string) {
    cards.forEach((c) => c.classList.toggle('is-active', c.dataset.id === id));
    poiMap?.highlight(id);
    if (desktop.matches) {
      const card = cards.find((c) => c.dataset.id === id);
      card?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }

  function apply() {
    const terms = norm(state.q).split(/\s+/).filter(Boolean);
    visibleIds = new Set();
    for (const card of cards) {
      const d = card.dataset;
      const tags = (d.tags ?? '').split(' ');
      const show =
        (!state.cat || d.cat === state.cat) &&
        Number(d.rating) >= state.min &&
        state.tags.every((t) => tags.includes(t)) &&
        terms.every((t) => d.search!.includes(t));
      card.hidden = !show;
      if (show) visibleIds.add(d.id!);
    }
    const n = visibleIds.size;
    count.textContent = n === cards.length ? `${n} ${n === 1 ? 'place' : 'places'}` : `Showing ${n} of ${cards.length}`;
    noResults.hidden = n > 0;
    const filtered = !!(state.q || state.cat || state.tags.length || state.min);
    resetBtn.hidden = !filtered;
    const extra = state.tags.length + (state.min ? 1 : 0);
    moreCount.textContent = extra ? `(${extra})` : '';

    if (input.value !== state.q) input.value = state.q;
    clearQ.hidden = !state.q;
    document.querySelectorAll<HTMLButtonElement>('[data-cat]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.cat === state.cat)));
    document.querySelectorAll<HTMLButtonElement>('[data-min]').forEach((b) => b.setAttribute('aria-pressed', String((Number(b.dataset.min) || 0) === state.min)));
    document.querySelectorAll<HTMLButtonElement>('[data-tag]').forEach((b) => b.setAttribute('aria-pressed', String(state.tags.includes(b.dataset.tag!))));
    if (state.tags.length || state.min) (document.getElementById('more-filters') as HTMLDetailsElement).open = true;

    poiMap?.setVisible(visibleIds);
    applyView();
    try {
      sessionStorage.setItem(`foodieverse:cityUrl:${cityKey}`, stateUrl({ ...state, view: 'list' }));
    } catch {
      /* storage unavailable */
    }
  }

  function applyView() {
    root.dataset.view = state.view;
    const toMap = state.view !== 'map';
    toggle.innerHTML = toMap ? '<span aria-hidden="true">🗺️</span> Map' : '<span aria-hidden="true">☰</span> List';
    toggle.setAttribute('aria-label', toMap ? 'Show map' : 'Show list');
    if (state.view === 'map' || desktop.matches) {
      if (!desktop.matches) root.style.setProperty('--map-top', `${controls.getBoundingClientRect().bottom + 8}px`);
      ensureMap().then((m) => {
        m.resize();
        m.fit();
      });
    }
  }

  function update(patch: Partial<State>, push = false) {
    state = { ...state, ...patch };
    const url = stateUrl(state);
    if (push) history.pushState(null, '', url);
    else history.replaceState(null, '', url);
    apply();
  }

  // --- events ---
  let t: number | undefined;
  input.addEventListener('input', () => {
    clearTimeout(t);
    t = window.setTimeout(() => update({ q: input.value }), 120);
  });
  clearQ.addEventListener('click', () => {
    update({ q: '' });
    input.focus();
  });
  root.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button');
    if (!b) return;
    if (b.dataset.cat !== undefined) update({ cat: b.dataset.cat });
    else if (b.dataset.min !== undefined) update({ min: Number(b.dataset.min) || 0 });
    else if (b.dataset.tag !== undefined) {
      const tag = b.dataset.tag;
      update({ tags: state.tags.includes(tag) ? state.tags.filter((x) => x !== tag) : [...state.tags, tag] });
    } else if (b.hasAttribute('data-reset') || b === resetBtn) update({ q: '', cat: '', tags: [], min: 0 });
  });
  toggle.addEventListener('click', () => {
    if (state.view === 'map') {
      // Return to the list the way we came if possible, so back stays intuitive.
      if (history.state?.fromList) history.back();
      else update({ view: 'list' });
    } else {
      window.scrollTo(0, 0);
      state = { ...state, view: 'map' };
      history.pushState({ fromList: true }, '', stateUrl(state));
      apply();
    }
  });
  window.addEventListener('popstate', () => {
    state = readState();
    apply();
  });
  desktop.addEventListener('change', applyView);
  window.addEventListener('resize', () => {
    if (state.view === 'map' && !desktop.matches) root.style.setProperty('--map-top', `${controls.getBoundingClientRect().bottom + 8}px`);
  });

  // Desktop: hovering or focusing a card highlights its marker.
  for (const card of cards) {
    const on = () => {
      if (!desktop.matches) return;
      cards.forEach((c) => c.classList.toggle('is-active', c === card));
      poiMap?.highlight(card.dataset.id!, { pan: true });
    };
    card.addEventListener('mouseenter', on);
    card.addEventListener('focusin', on);
  }

  // Near me: geolocation is requested only here, used locally, never stored.
  if (!('geolocation' in navigator)) nearBtn.hidden = true;
  nearBtn.addEventListener('click', () => {
    if (me) {
      me = null;
      originalOrder.forEach((c) => list.appendChild(c));
      cards.forEach((c) => (c.querySelector<HTMLElement>('[data-distance]')!.hidden = true));
      nearBtn.innerHTML = '<span aria-hidden="true">◎</span> Near me';
      apply();
      return;
    }
    nearBtn.disabled = true;
    nearBtn.textContent = 'Locating…';
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        me = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        const dist = (c: HTMLElement) => haversine(me!.lat, me!.lng, Number(c.dataset.lat), Number(c.dataset.lng));
        const sorted = [...cards].sort((a, b) => dist(a) - dist(b));
        sorted.forEach((c) => {
          list.appendChild(c);
          const el = c.querySelector<HTMLElement>('[data-distance]')!;
          el.textContent = formatDistance(dist(c));
          el.hidden = false;
        });
        nearBtn.disabled = false;
        nearBtn.innerHTML = '<span aria-hidden="true">✕</span> Nearest first';
        count.textContent = `${count.textContent} · nearest first`;
        poiMap?.showMe(me.lat, me.lng);
      },
      () => {
        nearBtn.disabled = false;
        nearBtn.innerHTML = '<span aria-hidden="true">◎</span> Near me';
        count.textContent = 'Could not get your location.';
      },
      { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 },
    );
  });

  apply();
  if (desktop.matches) {
    const idle = (window as any).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 200));
    idle(() => ensureMap());
  }
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const R = 6371000;
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lng2 - lng1) * r) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function formatDistance(m: number) {
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  if (m < 100000) return `${(m / 1000).toFixed(1)} km`;
  return `${Math.round(m / 1000)} km`;
}
