// everyline companion: patron app wiring.
//
// Three ways to watch, one rendering pipeline:
//   theater -> BoothStream over WebSocket to the booth appliance
//   home    -> BoothStream over WebSocket to the home bridge (same protocol)
//   demo    -> DemoSource, a virtual booth on the phone itself
// All three feed BoothClock -> CuePlayer -> LensRenderer. The renderer is
// the only piece that changes when the Meta Wearables SDK arrives.

import { BoothClock } from './clock.js';
import { CuePlayer } from './player.js';
import { WebRenderer } from './renderer.js';
import { BoothStream } from './stream.js';
import { DemoSource } from './source.js';
import { parseSrt } from './srt.js';
import { parseJoinParams, publicNowPlayingUrl } from './join.js';

const $ = (sel) => document.querySelector(sel);
const params = new URLSearchParams(location.search);

const store = {
  get(k) {
    try { return localStorage.getItem('everyline.' + k); } catch { return null; }
  },
  set(k, v) {
    try { localStorage.setItem('everyline.' + k, v); } catch { /* private mode */ }
  },
};

let clock = new BoothClock();
let player = null;
let renderer = null;
let source = null;
let raf = 0;
let currentTitle = '';
let currentSource = '';
let mode = 'theater';

const CAP_SIZES = ['s', 'm', 'l'];

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

// ---------- live ----------

function makeHandlers() {
  return {
    onWelcome: (m) => {
      currentTitle = m.showing?.title || '';
      currentSource = m.source || '';
      renderer.setStatus({ state: 'live', title: currentTitle, source: currentSource });
      renderLanguages(m.languages && m.languages.length ? m.languages : ['en']);
    },
    onCue: (m) => player.pushCue(m),
    onTransport: (m) => {
      clock.onTransport(m, Date.now());
      renderer.setStatus({ state: 'live', title: currentTitle, lang: player.lang, source: currentSource });
    },
    onStatus: (s) =>
      renderer.setStatus({ state: s, title: currentTitle, lang: player?.lang, source: currentSource }),
    onLanguage: (lang) => {
      player.setLanguage(lang);
      renderer.setLang(lang);
      renderer.setStatus({ state: 'live', title: currentTitle, lang, source: currentSource });
    },
  };
}

function startLive({ label, makeSource, url, demo = false }) {
  clock = new BoothClock();
  currentTitle = label;
  currentSource = '';
  showScreen('live');
  $('#demo-bar').classList.toggle('hidden', !demo);
  renderer = new WebRenderer($('#lens'));
  renderer.setStatus({ state: 'connecting', title: label });
  player = new CuePlayer({
    clock,
    onDisplay: (cue) => renderer.showCue(cue),
    onClear: () => renderer.clear(),
  });
  source = makeSource(makeHandlers());
  source.connect(url);
  source.subscribe('en');
  if (demo) wireDemoControls();
  const loop = () => {
    player.tick();
    raf = requestAnimationFrame(loop);
  };
  loop();
}

function wireDemoControls() {
  const playBtn = $('#demo-play');
  const update = () => { playBtn.textContent = source.playing ? 'Pause' : 'Play'; };
  playBtn.onclick = () => {
    if (source.playing) source.pause();
    else source.play();
    update();
  };
  $('#demo-restart').onclick = () => {
    source.seek(0);
    source.play();
    update();
  };
  update();
}

function stopLive() {
  cancelAnimationFrame(raf);
  if (source) source.close();
  source = player = renderer = null;
  currentTitle = '';
  currentSource = '';
  showScreen('join');
}

function renderLanguages(langs) {
  const row = document.querySelector('.lang-row');
  row.innerHTML = '';
  langs.forEach((lang) => {
    const b = document.createElement('button');
    b.textContent = lang.toUpperCase();
    b.dataset.lang = lang;
    b.setAttribute('aria-label', `Captions in ${lang}`);
    if (lang === 'en') b.classList.add('active');
    b.addEventListener('click', () => source && source.subscribe(lang));
    row.appendChild(b);
  });
}

// ---------- theater ----------

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
      card.addEventListener('click', () =>
        startLive({
          label: aud.currentShow?.title || aud.name,
          makeSource: (h) => new BoothStream({ wsImpl: WebSocket, handlers: h }),
          url: aud.cueStreamUrl,
        }));
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

// ---------- home ----------

function connectHome(url) {
  setJoinError('');
  url = (url || $('#bridge-url').value).trim();
  if (!url) {
    setJoinError('Enter your bridge address.');
    return;
  }
  store.set('bridge', url);
  startLive({
    label: 'Home',
    makeSource: (h) => new BoothStream({ wsImpl: WebSocket, handlers: h }),
    url,
  });
}

// ---------- demo ----------

async function startDemo() {
  setJoinError('');
  try {
    const [en, es] = await Promise.all([
      fetch('captions.en.srt').then((r) => {
        if (!r.ok) throw new Error('en');
        return r.text();
      }),
      fetch('captions.es.srt').then((r) => {
        if (!r.ok) throw new Error('es');
        return r.text();
      }),
    ]);
    const tracks = { en: parseSrt(en), es: parseSrt(es) };
    if (!tracks.en.length) throw new Error('empty');
    startLive({
      label: 'The Long Room',
      makeSource: (h) => new DemoSource({ handlers: h, tracks }),
      demo: true,
    });
    source.play();
    $('#demo-play').textContent = 'Pause';
  } catch {
    setJoinError('Could not load the demo captions. Serve this folder over HTTP and try again.');
  }
}

// ---------- join screen ----------

function selectMode(next) {
  mode = next;
  document.querySelectorAll('.mode-card').forEach((c) =>
    c.classList.toggle('active', c.dataset.mode === next));
  document.querySelectorAll('.mode-panel').forEach((p) =>
    p.classList.toggle('active', p.id === `panel-${next}`));
  setJoinError('');
}

function applyCapSize(size) {
  const lens = $('#lens');
  lens.classList.remove('cap-s', 'cap-m', 'cap-l');
  lens.classList.add(`cap-${size}`);
  store.set('capSize', size);
  $('#cap-size-label').textContent = size.toUpperCase();
}

function init() {
  $('#backend-url').value = params.get('backend') || store.get('backend') || '';
  $('#operator-token').value = params.get('token') || store.get('token') || '';
  $('#theater-id').value = params.get('theater') || store.get('theater') || '';
  $('#bridge-url').value = params.get('bridge') || store.get('bridge') || '';

  document.querySelectorAll('.mode-card').forEach((c) =>
    c.addEventListener('click', () => selectMode(c.dataset.mode)));

  $('#find-btn').addEventListener('click', findShowtimes);
  $('#home-connect-btn').addEventListener('click', () => connectHome());
  $('#demo-start-btn').addEventListener('click', startDemo);
  $('#back-btn').addEventListener('click', () => showScreen('join'));
  $('#leave-btn').addEventListener('click', stopLive);

  $('#cap-dec').addEventListener('click', () => {
    const cur = store.get('capSize') || 'm';
    applyCapSize(CAP_SIZES[(CAP_SIZES.indexOf(cur) + CAP_SIZES.length - 1) % CAP_SIZES.length]);
  });
  $('#cap-inc').addEventListener('click', () => {
    const cur = store.get('capSize') || 'm';
    applyCapSize(CAP_SIZES[(CAP_SIZES.indexOf(cur) + 1) % CAP_SIZES.length]);
  });
  applyCapSize(store.get('capSize') || 'm');

  // Deep links.
  const qp = parseJoinParams(params);
  if (qp.source === 'demo') {
    startDemo();
  } else if (qp.source === 'home' && (qp.bridge || store.get('bridge'))) {
    selectMode('home');
    connectHome(qp.bridge || store.get('bridge'));
  } else if (qp.backend && qp.theater && qp.auditorium) {
    joinTheaterDeep(qp);
  }
}

// Seat-QR deep link: ?source=theater&backend=&theater=&auditorium=.
// Tokenless: the public now-playing endpoint needs no operator token, so a
// printed QR never leaks a credential. A tokened link still works and gets
// the operator discovery path.
async function joinTheaterDeep(qp) {
  if (qp.token) {
    $('#backend-url').value = qp.backend;
    $('#operator-token').value = qp.token;
    $('#theater-id').value = qp.theater;
    try {
      const res = await fetch(
        `${qp.backend}/v1/discovery?theaterId=${encodeURIComponent(qp.theater)}`,
        { headers: { authorization: `Bearer ${qp.token}` } });
      if (res.ok) {
        const d = await res.json();
        const aud = d.auditoriums.find((a) => a.id === qp.auditorium);
        if (aud && aud.captionsAvailable) {
          return startLive({
            label: aud.currentShow?.title || aud.name,
            makeSource: (h) => new BoothStream({ wsImpl: WebSocket, handlers: h }),
            url: aud.cueStreamUrl,
          });
        }
      }
    } catch { /* fall through to the public path */ }
  }
  try {
    const res = await fetch(publicNowPlayingUrl(qp));
    if (!res.ok) throw new Error(`backend answered ${res.status}`);
    const d = await res.json();
    if (!d.captionsAvailable || !d.cueStreamUrl) {
      setJoinError(`Captions are not live in ${d.auditorium?.name || 'this auditorium'} yet.`);
      return;
    }
    startLive({
      label: d.currentShow?.title || d.auditorium.name,
      makeSource: (h) => new BoothStream({ wsImpl: WebSocket, handlers: h }),
      url: d.cueStreamUrl,
    });
  } catch {
    setJoinError('Could not reach the theater. Check you are on the auditorium WiFi.');
  }
}

init();
