// everyline companion: patron app wiring.
//
// Join -> discovery -> booth stream -> lens. The state machine above the
// renderer: BoothStream (protocol v0) -> BoothClock (booth is the clock) ->
// CuePlayer (what's visible) -> LensRenderer (pixels). The renderer is the
// only piece that changes when the Meta Wearables SDK arrives.

import { BoothClock } from './clock.js';
import { CuePlayer } from './player.js';
import { WebRenderer } from './renderer.js';
import { BoothStream } from './stream.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);

const store = {
  get(k) {
    try {
      return localStorage.getItem('everyline.' + k);
    } catch {
      return null;
    }
  },
  set(k, v) {
    try {
      localStorage.setItem('everyline.' + k, v);
    } catch {
      /* private mode */
    }
  },
};

const clock = new BoothClock();
let player = null;
let renderer = null;
let stream = null;
let raf = 0;
let currentTitle = '';

function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) =>
    s.classList.toggle('active', s.id === 'screen-' + name));
}

function setJoinError(msg) {
  $('#join-error').textContent = msg || '';
}

function authHeaders() {
  return { authorization: `Bearer ${$('#operator-token').value.trim()}` };
}

function backendBase() {
  return $('#backend-url').value.trim().replace(/\/+$/, '');
}

async function startLive(aud) {
  showScreen('live');
  renderer = new WebRenderer($('#lens'));
  renderer.setStatus({ state: 'connecting', title: aud.currentShow?.title });
  player = new CuePlayer({
    clock,
    onDisplay: (cue) => renderer.showCue(cue),
    onClear: () => renderer.clear(),
  });
  stream = new BoothStream({
    wsImpl: WebSocket,
    handlers: {
      onWelcome: (m) => {
        currentTitle = m.showing?.title || '';
        renderer.setStatus({ state: 'live', title: currentTitle, source: m.source });
        renderLanguages(m.languages && m.languages.length ? m.languages : ['en']);
      },
      onCue: (m) => player.pushCue(m),
      onTransport: (m) => {
        clock.onTransport(m, Date.now());
        renderer.setStatus({ state: 'live', title: currentTitle, lang: player.lang });
      },
      onStatus: (s) =>
        renderer.setStatus({ state: s, title: currentTitle, lang: player?.lang }),
      onLanguage: (lang) => {
        player.setLanguage(lang);
        renderer.setLang(lang);
        renderer.setStatus({ state: stream.state, title: currentTitle, lang });
      },
    },
  });
  stream.connect(aud.cueStreamUrl);
  stream.subscribe('en');
  const loop = () => {
    player.tick();
    raf = requestAnimationFrame(loop);
  };
  loop();
}

function stopLive() {
  cancelAnimationFrame(raf);
  if (stream) stream.close();
  stream = player = renderer = null;
  currentTitle = '';
  showScreen('join');
}

function renderLanguages(langs) {
  const row = document.querySelector('.lang-row');
  row.innerHTML = '';
  langs.forEach((lang) => {
    const b = document.createElement('button');
    b.textContent = lang.toUpperCase();
    b.dataset.lang = lang;
    if (lang === 'en') b.classList.add('active');
    b.addEventListener('click', () => stream && stream.subscribe(lang));
    row.appendChild(b);
  });
}

function renderAuditoriums(d) {
  $('#aud-theater-name').textContent = d.theater.name;
  const list = $('#aud-list');
  list.innerHTML = '';
  d.auditoriums.forEach((aud) => {
    const card = document.createElement('button');
    card.className = 'aud-card';
    card.disabled = !aud.captionsAvailable;
    const show = aud.currentShow ? aud.currentShow.title : 'No show listed';
    const badge = aud.captionsAvailable ? 'captions live' : 'no captions';
    card.innerHTML = `<strong>${aud.name}</strong><span>${show}</span><em>${badge}</em>`;
    if (aud.captionsAvailable) {
      card.addEventListener('click', () => startLive(aud));
    }
    list.appendChild(card);
  });
  if (!d.auditoriums.length) {
    list.innerHTML = '<p class="muted">No auditoriums registered yet.</p>';
  }
}

async function findShowtimes() {
  setJoinError('');
  const theaterId = $('#theater-id').value.trim();
  if (!theaterId) {
    setJoinError('Enter a theater ID.');
    return;
  }
  store.set('backend', $('#backend-url').value.trim());
  store.set('token', $('#operator-token').value.trim());
  store.set('theater', theaterId);
  try {
    const res = await fetch(
      `${backendBase()}/v1/discovery?theaterId=${encodeURIComponent(theaterId)}`,
      { headers: authHeaders() });
    if (!res.ok) throw new Error(`backend answered ${res.status}`);
    renderAuditoriums(await res.json());
    showScreen('auditoriums');
  } catch {
    setJoinError('Could not reach the backend. Check the URL, theater ID, and token.');
  }
}

function init() {
  $('#backend-url').value = params.get('backend') || store.get('backend') || '';
  $('#operator-token').value = params.get('token') || store.get('token') || '';
  $('#theater-id').value = params.get('theater') || store.get('theater') || '';

  $('#find-btn').addEventListener('click', findShowtimes);
  $('#back-btn').addEventListener('click', () => showScreen('join'));
  $('#leave-btn').addEventListener('click', stopLive);

  // Deep link (?backend=&token=&theater=&auditorium=): straight to the film.
  const deepAud = params.get('auditorium');
  if (configReady() && deepAud) {
    (async () => {
      try {
        const res = await fetch(
          `${backendBase()}/v1/discovery?theaterId=${encodeURIComponent($('#theater-id').value.trim())}`,
          { headers: authHeaders() });
        const d = await res.json();
        const aud = d.auditoriums.find((a) => a.id === deepAud);
        if (aud && aud.captionsAvailable) startLive(aud);
      } catch {
        /* fall through to the join screen */
      }
    })();
  }
}

function configReady() {
  return $('#backend-url').value.trim() && $('#theater-id').value.trim();
}

init();
