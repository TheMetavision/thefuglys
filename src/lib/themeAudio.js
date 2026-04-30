// src/lib/themeAudio.js
//
// Shared theme-audio utility for the four IP brand sites
// (Fuglys / Labrats / Biker Babies / Cats On Crack).
//
// v3.1 — 2026-04-30 — adds dismiss (per-session) + progress/seek API:
//   - dismiss() — user clicks the X on the player. Sets a sessionStorage
//     flag so the player stays hidden for the rest of this browser tab/session
//     but reappears on a new visit. Pauses audio if playing.
//   - isDismissed() — sync check used by the component on init.
//   - getProgress() — returns { current, duration, percent } for the progress
//     bar. Reads Howler.seek() and Howler.duration().
//   - seekTo(seconds) — moves the playhead. If audio not yet loaded, lazy-
//     loads first then seeks once metadata is available.
//
// v2 — 2026-04-29 — fixes for cross-page UX:
//   1. Reset state to 'idle' on init if previous-session state was active
//      playback (browser autoplay policy compliance).
//   2. First-play-only seek to persisted position so within-session pause/
//      resume uses Howler's own position.
//
// Reference build: written for Fuglys, designed to be copied across to the
// other three brand repos without modification.
//
// Uses Howler.js (npm install howler).
//
// State machine:
//   'idle'      → control visible, no audio loaded yet (lazy-load on first click)
//   'playing'   → track plays through once
//   'ended'     → track finished, replay affordance shown
//   'replaying' → user clicked replay on ended state (collapses to 'playing')
//
// Persistence:
//   - Track position (seconds), state, volume in localStorage. 24h TTL.
//   - Per-session dismiss flag in sessionStorage (cleared on tab close).
//   - All keys namespaced per brand (`fuglys_theme_*`, etc.)

import { Howl } from 'howler';

// ─── Constants ─────────────────────────────────────────────────────────────

const DEFAULT_VOLUME = 0.25;
const SUPPRESSION_FADE_MS = 500;
const STATE_TTL_MS = 24 * 60 * 60_000;
const POSITION_THROTTLE_MS = 1000;

// ─── Storage helpers (per-brand namespacing) ───────────────────────────────

function makeStorage(namespace) {
  const k = (suffix) => `${namespace}_theme_${suffix}`;
  const safeGet = (key) => {
    try { return localStorage.getItem(key); } catch { return null; }
  };
  const safeSet = (key, value) => {
    try { localStorage.setItem(key, value); } catch { /* private mode etc. — no-op */ }
  };
  const safeRemove = (key) => {
    try { localStorage.removeItem(key); } catch { /* no-op */ }
  };

  // Session-scoped storage for the dismiss flag — cleared on tab close,
  // so the player reappears next visit.
  const sessionGet = (key) => {
    try { return sessionStorage.getItem(key); } catch { return null; }
  };
  const sessionSet = (key, value) => {
    try { sessionStorage.setItem(key, value); } catch { /* no-op */ }
  };
  const sessionRemove = (key) => {
    try { sessionStorage.removeItem(key); } catch { /* no-op */ }
  };

  return {
    readState() {
      const raw = safeGet(k('state'));
      if (!raw) return null;
      try {
        const parsed = JSON.parse(raw);
        if (Date.now() - (parsed.savedAt || 0) > STATE_TTL_MS) {
          safeRemove(k('state'));
          return null;
        }
        return parsed;
      } catch {
        safeRemove(k('state'));
        return null;
      }
    },
    writeState(state) {
      safeSet(k('state'), JSON.stringify({ ...state, savedAt: Date.now() }));
    },
    clearState() {
      safeRemove(k('state'));
    },
    // Per-session dismiss flag
    isDismissed() {
      return sessionGet(k('dismissed')) === 'true';
    },
    setDismissed(value) {
      if (value) sessionSet(k('dismissed'), 'true');
      else sessionRemove(k('dismissed'));
    },
  };
}

// ─── Suppression matcher ──────────────────────────────────────────────────

function isSuppressed(pathname, patterns) {
  if (!patterns || patterns.length === 0) return false;
  return patterns.some((p) => p.test(pathname));
}

// ─── Howl factory (lazy) ──────────────────────────────────────────────────

function buildHowl({ src, volume, onEnd, onLoad }) {
  return new Howl({
    src: [src],
    html5: true,
    preload: 'metadata',
    volume,
    onend: onEnd,
    onload: onLoad,
  });
}

// ─── Public API ───────────────────────────────────────────────────────────

/**
 * Create a theme-audio controller for a brand.
 *
 * @param {Object} config
 * @param {string} config.namespace            e.g. 'fuglys' | 'labrats' | 'coc' | 'bb'
 * @param {string} config.src                  CDN URL of the .mp3
 * @param {RegExp[]} config.suppressionPaths   Routes where the control hides
 * @param {(state: string) => void} config.onStateChange  Render callback (state machine state changed)
 * @param {(volume: number) => void} [config.onVolumeChange]  Optional volume render callback
 * @param {() => void} [config.onDismiss]      Called when user dismisses the player
 * @returns {Object} controller
 */
export function createThemeAudio(config) {
  const { namespace, src, suppressionPaths, onStateChange, onVolumeChange, onDismiss } = config;

  const storage = makeStorage(namespace);
  const persisted = storage.readState() || {};

  let howl = null;
  let firstPlayThisSession = true;
  let pendingSeek = null; // queued seek if Howl not yet loaded

  const persistedState = persisted.state;
  let state =
    persistedState === 'playing' || persistedState === 'replaying'
      ? 'idle'
      : persistedState || 'idle';

  let volume = typeof persisted.volume === 'number' ? persisted.volume : DEFAULT_VOLUME;
  let lastPositionWrite = 0;
  let positionInterval = null;
  let suppressed = false;
  let destroyed = false;

  // ── State helpers ────────────────────────────────────────────────────────

  function setState(next) {
    if (state === next) return;
    state = next;
    storage.writeState({ state, volume, position: getPosition() });
    onStateChange(state);
  }

  function getPosition() {
    if (!howl) return persisted.position || 0;
    try {
      const t = howl.seek();
      return typeof t === 'number' ? t : 0;
    } catch {
      return 0;
    }
  }

  function startPositionTracker() {
    stopPositionTracker();
    positionInterval = setInterval(() => {
      if (state !== 'playing' && state !== 'replaying') return;
      const now = Date.now();
      if (now - lastPositionWrite < POSITION_THROTTLE_MS) return;
      lastPositionWrite = now;
      storage.writeState({ state, volume, position: getPosition() });
    }, POSITION_THROTTLE_MS);
  }

  function stopPositionTracker() {
    if (positionInterval) {
      clearInterval(positionInterval);
      positionInterval = null;
    }
  }

  // ── Howl init (lazy) ─────────────────────────────────────────────────────

  function ensureHowl() {
    if (howl || destroyed) return howl;
    howl = buildHowl({
      src,
      volume,
      onEnd: () => {
        stopPositionTracker();
        storage.writeState({ state: 'ended', volume, position: 0 });
        setState('ended');
      },
      onLoad: () => {
        // If a seek was queued before metadata loaded, apply it now.
        if (pendingSeek != null && howl) {
          try { howl.seek(pendingSeek); } catch { /* no-op */ }
          pendingSeek = null;
        }
      },
    });
    return howl;
  }

  // ── Public actions ───────────────────────────────────────────────────────

  function play() {
    if (suppressed || destroyed) return;
    if (storage.isDismissed()) return; // ignore play attempts when dismissed
    ensureHowl();
    if (!howl) return;
    if (firstPlayThisSession) {
      firstPlayThisSession = false;
      const resumeAt = persisted.position || 0;
      if (resumeAt > 0 && state !== 'ended') {
        try { howl.seek(resumeAt); } catch { /* no-op */ }
      }
    }
    howl.play();
    setState(state === 'ended' ? 'replaying' : 'playing');
    startPositionTracker();
  }

  function pause() {
    if (!howl) return;
    howl.pause();
    storage.writeState({ state: 'idle', volume, position: getPosition() });
    setState('idle');
    stopPositionTracker();
  }

  function replay() {
    ensureHowl();
    if (!howl) return;
    try { howl.stop(); howl.seek(0); } catch { /* no-op */ }
    howl.play();
    setState('replaying');
    startPositionTracker();
    firstPlayThisSession = false;
  }

  function setVolume(next) {
    volume = Math.max(0, Math.min(1, next));
    if (howl) howl.volume(volume);
    storage.writeState({ state, volume, position: getPosition() });
    if (onVolumeChange) onVolumeChange(volume);
  }

  // ── Progress / seek API (v3.1) ──────────────────────────────────────────

  function getProgress() {
    if (!howl) {
      const persistedPos = persisted.position || 0;
      return { current: persistedPos, duration: 0, percent: 0 };
    }
    try {
      const current = Number(howl.seek()) || 0;
      const duration = Number(howl.duration()) || 0;
      const percent = duration > 0 ? Math.min(100, Math.max(0, (current / duration) * 100)) : 0;
      return { current, duration, percent };
    } catch {
      return { current: 0, duration: 0, percent: 0 };
    }
  }

  /**
   * Seek to a specific position in seconds. If audio not yet loaded, queue the
   * seek for after onload. Caller is responsible for ensuring play() / replay()
   * is called separately if they want playback to resume.
   */
  function seekTo(seconds) {
    if (destroyed) return;
    if (storage.isDismissed()) return;
    const target = Math.max(0, Number(seconds) || 0);
    ensureHowl();
    if (!howl) return;
    // If duration is known and target is beyond, clamp.
    let safeTarget = target;
    try {
      const dur = Number(howl.duration()) || 0;
      if (dur > 0) safeTarget = Math.min(target, dur);
    } catch { /* no-op */ }

    // Howler's seek() works once metadata is loaded. If not yet, queue.
    try {
      const current = howl.seek();
      // If seek returns the howl object itself or a non-number, we're not loaded yet.
      if (typeof current !== 'number' || Number.isNaN(current)) {
        pendingSeek = safeTarget;
      } else {
        howl.seek(safeTarget);
      }
    } catch {
      pendingSeek = safeTarget;
    }
    storage.writeState({ state, volume, position: safeTarget });
  }

  // ── Dismiss (v3.1) ──────────────────────────────────────────────────────

  function dismiss() {
    storage.setDismissed(true);
    if (howl && (state === 'playing' || state === 'replaying')) {
      try { howl.pause(); } catch { /* no-op */ }
    }
    storage.writeState({ state: 'idle', volume, position: getPosition() });
    stopPositionTracker();
    if (onDismiss) onDismiss();
  }

  function isDismissed() {
    return storage.isDismissed();
  }

  // ── Suppression ──────────────────────────────────────────────────────────

  function applySuppression(pathname) {
    const shouldSuppress = isSuppressed(pathname, suppressionPaths);
    if (shouldSuppress === suppressed) return;
    suppressed = shouldSuppress;

    if (suppressed) {
      if (howl && (state === 'playing' || state === 'replaying')) {
        try { howl.fade(volume, 0, SUPPRESSION_FADE_MS); } catch { /* no-op */ }
        setTimeout(() => {
          if (!howl) return;
          try { howl.pause(); howl.volume(volume); } catch { /* no-op */ }
        }, SUPPRESSION_FADE_MS + 50);
      }
      stopPositionTracker();
    } else if (!suppressed && (state === 'playing' || state === 'replaying')) {
      setState('idle');
    }
  }

  // ── Click handler ───────────────────────────────────────────────────────

  function handleClick() {
    if (suppressed || destroyed) return;
    if (storage.isDismissed()) return;
    if (state === 'idle') play();
    else if (state === 'playing' || state === 'replaying') pause();
    else if (state === 'ended') replay();
  }

  // ── Lifecycle ────────────────────────────────────────────────────────────

  function destroy() {
    destroyed = true;
    stopPositionTracker();
    if (howl) {
      try { howl.unload(); } catch { /* no-op */ }
      howl = null;
    }
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  if (typeof window !== 'undefined') {
    applySuppression(window.location.pathname);
  }
  queueMicrotask(() => onStateChange(state));

  return {
    handleClick,
    play,
    pause,
    replay,
    setVolume,
    applySuppression,
    destroy,
    // v3.1 additions
    dismiss,
    isDismissed,
    getProgress,
    seekTo,
    get state() { return state; },
    get volume() { return volume; },
    get isSuppressed() { return suppressed; },
  };
}

// ─── Convenience: detect prefers-reduced-motion ───────────────────────────

export function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
