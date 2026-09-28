// Join-link helpers: parsing the deep links the seat QR encodes, and
// building them (used by tests; the backend renders the actual QR).

export function parseJoinParams(sp) {
  const clean = (v) => (v || '').trim();
  return {
    source: clean(sp.get('source')),
    backend: clean(sp.get('backend')).replace(/\/+$/, ''),
    token: clean(sp.get('token')),
    theater: clean(sp.get('theater')),
    auditorium: clean(sp.get('auditorium')),
    bridge: clean(sp.get('bridge')),
  };
}

export function theaterDeepLink({ base, backend, theater, auditorium }) {
  const q = new URLSearchParams({
    source: 'theater',
    backend: backend.replace(/\/+$/, ''),
    theater,
    auditorium,
  });
  return `${base.replace(/\/+$/, '')}/?${q.toString()}`;
}

export function publicNowPlayingUrl({ backend, theater, auditorium }) {
  const q = new URLSearchParams({ theaterId: theater, auditoriumId: auditorium });
  return `${backend.replace(/\/+$/, '')}/v1/public/now-playing?${q.toString()}`;
}
