/* game-audio.js — one Web Audio engine for a game's music, voice shouts and effects.
   Identical copy in every IP brand game; change one, copy to all six.

   Why it exists (Nov 2026): on iPhone the games' music either never started or
   cut out a few seconds into a race. Two causes:
   - The racers played music through an <audio> element while the engine sound
     ran through Web Audio. When Web Audio starts sounding, iOS can pause the
     <audio> element, so the music died at the green light.
   - Web Audio follows the ring/silent switch unless the page holds a "playback"
     audio session. navigator.audioSession is not reliable inside an iframe, and
     the old keep-alive only ran on iPhones without it, so phones on silent got
     no music at all.
   So everything (music, voices, effects) goes through one AudioContext, iOS gets
   a silent looping <audio> keep-alive on every unlock, and a watchdog brings the
   music back after calls, notifications, app switches or any other interruption.
   Decoded tracks are big (a 2-minute track is about 50 MB on a phone), so only
   the playing track and the one before it stay in memory.

   API (window.GameAudio):
     context()            the shared AudioContext (created on first call, may be suspended)
     unlock()             call from inside a tap/click/key handler; safe to call often
     setMusic(urls, vol)  urls: { key: [aacUrl, opusUrl] }, vol: 0..1 music level
     play(key)            crossfade to a looping track (no-op if already playing)
     stop()               fade the music out
     duck(level)          0..1 multiplier on the music level (pause screens etc.)
     rate(r)              playback rate of the current track (final lap etc.)
     setMuted(bool)       mutes music and voices; games still gate their own effects
     voice(url, vol)      play a short clip; resolves true once it starts
     preloadVoices(urls)  fetch and decode voice clips ahead of time
*/
(function () {
  'use strict';
  if (window.GameAudio) return;
  const IS_IOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const KEEP_TRACKS = 2;
  let ctx = null, silentEl = null, muted = false;
  const M = { urls: {}, vol: 0.45, level: 1, rate: 1, gain: null, bufs: new Map(), loading: {}, cur: null, key: null, want: null };
  const V = { bufs: new Map(), loading: {}, gain: null };

  function context() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      try { ctx = new AC(); } catch (e) { return null; }
      ctx.addEventListener && ctx.addEventListener('statechange', () => setTimeout(watch, 60));
    }
    return ctx;
  }
  function resume() {
    if (ctx && ctx.state !== 'running' && ctx.state !== 'closed') { try { const r = ctx.resume(); if (r && r.catch) r.catch(() => {}); } catch (e) {} }
  }
  function silentWavUrl() {
    const n = 4000, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const w = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    w(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); w(8, 'WAVE'); w(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 8000, true); v.setUint32(28, 16000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); w(36, 'data'); v.setUint32(40, n * 2, true);
    return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
  }
  let primed = false;
  function unlock() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    if (!context()) return;
    resume();
    if (!primed) {
      primed = true;
      try { const b = ctx.createBuffer(1, 1, 22050), s = ctx.createBufferSource(); s.buffer = b; s.connect(ctx.destination); s.start(0); } catch (e) {}
    }
    // iPhone: a looping silent <audio> holds the "playback" session, so sound plays with the
    // silent switch on and Web Audio is not treated as interruptible background noise
    if (IS_IOS) {
      try {
        if (!silentEl) { silentEl = new Audio(silentWavUrl()); silentEl.loop = true; silentEl.setAttribute('playsinline', ''); silentEl.setAttribute('x-webkit-airplay', 'deny'); }
        if (silentEl.paused) { const p = silentEl.play(); if (p && p.catch) p.catch(() => {}); }
      } catch (e) {}
    }
    watch();
  }

  /* ---------- music ---------- */
  function musicGain() {
    if (!ctx) return null;
    if (!M.gain) { M.gain = ctx.createGain(); M.gain.gain.value = muted ? 0 : M.vol * M.level; M.gain.connect(ctx.destination); }
    return M.gain;
  }
  function decode(ab) {
    return new Promise((res, rej) => { try { const p = ctx.decodeAudioData(ab, res, rej); if (p && p.catch) p.catch(rej); } catch (e) { rej(e); } });
  }
  function fetchDecode(urls) {
    const tryUrl = i => i >= urls.length ? Promise.resolve(null)
      : fetch(urls[i]).then(r => { if (!r.ok) throw new Error('audio ' + r.status); return r.arrayBuffer(); }).then(decode).catch(() => tryUrl(i + 1));
    return tryUrl(0);
  }
  function trimCache() {
    // keep the wanted track, the playing one, and the most recently used up to KEEP_TRACKS
    const keep = new Set([M.want, M.key].filter(Boolean));
    for (const k of [...M.bufs.keys()].reverse()) { if (keep.size >= KEEP_TRACKS) break; keep.add(k); }
    for (const k of [...M.bufs.keys()]) if (!keep.has(k)) M.bufs.delete(k);
  }
  function musicBuf(key) {
    if (M.bufs.has(key)) { const b = M.bufs.get(key); M.bufs.delete(key); M.bufs.set(key, b); return Promise.resolve(b); }
    const urls = M.urls[key]; if (!urls || !ctx) return Promise.resolve(null);
    if (!M.loading[key]) {
      M.loading[key] = fetchDecode(urls).then(b => { delete M.loading[key]; if (b) { M.bufs.set(key, b); trimCache(); } return b; });
    }
    return M.loading[key];
  }
  function startTrack(key, buf) {
    const g = musicGain(), t = ctx.currentTime;
    if (M.cur) { const old = M.cur; old.stopped = true; try { old.g.gain.cancelScheduledValues(t); old.g.gain.setTargetAtTime(0, t, 0.3); old.src.stop(t + 2); } catch (e) {} }
    const src = ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.playbackRate.value = M.rate;
    const sg = ctx.createGain(); sg.gain.setValueAtTime(0, t); sg.gain.setTargetAtTime(1, t, 0.35);
    src.connect(sg); sg.connect(g);
    const rec = { src, g: sg, key, ended: false, stopped: false };
    src.onended = () => { rec.ended = true; if (M.cur === rec && !rec.stopped) setTimeout(watch, 30); };
    src.start(t);
    M.cur = rec; M.key = key;
  }
  function playing(key) { return M.cur && M.cur.key === key && !M.cur.ended && !M.cur.stopped; }
  async function play(key) {
    M.want = key;
    if (!context() || playing(key)) return;
    const buf = await musicBuf(key);
    if (!buf || M.want !== key || playing(key)) return;
    M.rate = 1;
    startTrack(key, buf);
  }
  function stop() {
    M.want = null;
    if (M.cur && ctx) { const old = M.cur; old.stopped = true; try { old.g.gain.setTargetAtTime(0, ctx.currentTime, 0.3); old.src.stop(ctx.currentTime + 2); } catch (e) {} }
    M.cur = null; M.key = null;
  }
  function applyGain(tc) {
    if (M.gain && ctx) M.gain.gain.setTargetAtTime(muted ? 0 : M.vol * M.level, ctx.currentTime, tc == null ? 0.25 : tc);
    if (V.gain && ctx) V.gain.gain.setTargetAtTime(muted ? 0 : 1, ctx.currentTime, 0.05);
  }
  function duck(level) { M.level = level; applyGain(); }
  function rate(r) { M.rate = r; if (M.cur && ctx) { try { M.cur.src.playbackRate.setTargetAtTime(r, ctx.currentTime, 0.3); } catch (e) { M.cur.src.playbackRate.value = r; } } }
  function setMuted(m) { muted = !!m; applyGain(0.05); }
  function setMusic(urls, vol) { M.urls = urls || {}; if (vol != null) M.vol = vol; applyGain(); }

  /* ---------- voices ---------- */
  function voiceBuf(url) {
    if (V.bufs.has(url)) return Promise.resolve(V.bufs.get(url));
    if (!ctx) return Promise.resolve(null);
    if (!V.loading[url]) V.loading[url] = fetchDecode([url]).then(b => { delete V.loading[url]; if (b) V.bufs.set(url, b); return b; });
    return V.loading[url];
  }
  function preloadVoices(urls) { if (!context()) return; (urls || []).forEach(u => voiceBuf(u)); }
  async function voice(url, vol) {
    if (muted || !context()) return false;
    const buf = await voiceBuf(url);
    if (!buf || muted || ctx.state !== 'running') return false;
    if (!V.gain) { V.gain = ctx.createGain(); V.gain.gain.value = 1; V.gain.connect(ctx.destination); }
    const s = ctx.createBufferSource(), g = ctx.createGain(); s.buffer = buf; g.gain.value = vol == null ? 0.95 : vol;
    s.connect(g); g.connect(V.gain); s.start();
    // keep the music under the voice while it speaks
    if (M.gain) { const t = ctx.currentTime; M.gain.gain.setTargetAtTime(muted ? 0 : M.vol * M.level * 0.55, t, 0.06); M.gain.gain.setTargetAtTime(muted ? 0 : M.vol * M.level, t + buf.duration, 0.3); }
    return true;
  }

  /* ---------- watchdog: bring the music back after any interruption ---------- */
  function watch() {
    if (!ctx || !M.want) return;
    if (ctx.state !== 'running') { resume(); return; }
    if (silentEl && silentEl.paused && primed) { const p = silentEl.play(); if (p && p.catch) p.catch(() => {}); }
    if (!playing(M.want)) {
      const key = M.want;
      if (M.cur && M.cur.key === key && M.cur.ended) M.cur = null;   // the source died (interruption); start it again
      play(key);
    }
  }
  setInterval(watch, 1000);
  // phones only let audio resume from inside a gesture: every tap, click or key press tries
  ['touchstart', 'touchend', 'pointerdown', 'click', 'keydown'].forEach(ev => addEventListener(ev, () => { if (ctx) { resume(); if (IS_IOS && primed) unlock(); else watch(); } }, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { resume(); setTimeout(watch, 120); } });
  addEventListener('pageshow', () => { resume(); setTimeout(watch, 120); });

  window.GameAudio = {
    context, unlock, setMusic, play, stop, duck, rate, setMuted, voice, preloadVoices,
    get ctx() { return ctx; }, get muted() { return muted; }, get level() { return M.level; },
    get key() { return M.key; }, get want() { return M.want; },
    _debug: () => ({ state: ctx && ctx.state, want: M.want, key: M.key, playing: !!(M.want && playing(M.want)), cached: [...M.bufs.keys()], silent: silentEl ? !silentEl.paused : null }),
  };
})();
