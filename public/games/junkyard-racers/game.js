// The Fuglys: Junkyard Racers
// A Mario Kart-style scrap-kart racer: 8 karts, 3 laps, drift boosts, item crates, Grand Prix and Time Trial.
// Structure follows Labrats Vent Runner: config and data first (TRACKS, RACERS, ITEMS), then world, karts,
// AI, items, input, UI and the main loop as clearly commented sections. New tracks are data, not code.
import * as THREE from 'three';
import { GLTFLoader } from './vendor/jsm/loaders/GLTFLoader.js';
import { EffectComposer } from './vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from './vendor/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from './vendor/jsm/postprocessing/OutputPass.js';

/* ============================================================
   CONFIG
   ============================================================ */
const BASE = window.JR_BASE || './';
const Q = new URLSearchParams(location.search);
const DEBUG = Q.has('debug');                 // unlocks every track and racer, never posts times
const FPS_CAP = +Q.get('fps') || 0;           // test hook
const TIMESCALE = DEBUG ? (+Q.get('ts') || 1) : 1;   // test hook: speed up time in ?debug
const LAPS = 3;
const MAX_SPEED = 27;                         // m/s at speed stat 1.0 (about 60 mph, kart-fast at this scale)
const ACCEL = 15, BRAKE = 30, DRAG = 0.55, REVERSE_MAX = 7;
const TURN = 2.05;                            // rad/s at handling 1.0
const DRIFT_MIN_SPEED = 12;
const DRIFT_TIERS = [0.75, 1.55, 2.4];        // seconds of drift for blue / orange / purple sparks
const DRIFT_BOOST = [0.65, 1.05, 1.5];        // boost seconds for each tier
const BOOST_MULT = 1.38;
const VERGE = 3.2;                            // sand verge between road edge and barrier (slow)
const KART_R = 1.0;                           // collision radius
const SAMPLE_STEP = 1.0;                      // metres between track samples
const DIFFS = {
  easy:   { label: 'Rust Bucket',  ai: 0.80, rubberBack: 1.05, rubberFront: 0.90, itemSkill: 0.4 },
  normal: { label: 'Road Rash',    ai: 0.92, rubberBack: 1.08, rubberFront: 0.95, itemSkill: 0.7 },
  hard:   { label: 'Full Throttle', ai: 1.01, rubberBack: 1.10, rubberFront: 0.99, itemSkill: 1.0 },
};
const POINTS = [10, 8, 6, 5, 4, 3, 2, 1];

/* ---------------- racers ----------------
   model: GLB in models/ (kart and driver in one). front: which model axis the kart's nose points along.
   size: optional scale correction so drivers come out the same size (karts are fitted to KART_LEN, which over/under-scales unusually short or long karts).
   wheels: add spinning tyres for models whose wheels came out as bare hubs ('front' = front pair only). Racers without a model use
   a hand-built stand-in kart in their colour until their Higgsfield model is made. */
const RACERS = [
  { id: 'scrap',     name: 'Scrap',     tag: 'Tech Prodigy',      color: '#f2c200', model: 'scrap',      front: '-x', wheels: true, stats: { speed: 0.98, accel: 1.08, handling: 1.06, weight: 0.85 }, shout: ['Calculated!', 'Physics says bye!'] },
  { id: 'clyde',     name: 'Clyde',     tag: 'Master Scavenger',  color: '#3d7bd8', model: 'clyde',      front: '+x', wheels: true, size: 1.25, stats: { speed: 1.02, accel: 0.98, handling: 0.98, weight: 1.05 }, shout: ['Mine now!', 'Finders keepers!'] },
  { id: 'dixie',     name: 'Dixie',     tag: 'Sharp-Shooter',     color: '#e3a21a', model: 'dixie',      front: '+z', wheels: 'front', size: 0.75, stats: { speed: 1.0, accel: 1.02, handling: 1.04, weight: 0.9 }, shout: ['Bullseye!', 'Right between the hubcaps!'] },
  { id: 'jebediah',  name: 'Jebediah',  tag: 'Fallen Bodyguard',  color: '#6f8f55', model: 'jebediah',   front: '+z', wheels: true, size: 1.35, stats: { speed: 1.05, accel: 0.92, handling: 0.94, weight: 1.25 }, shout: ['Out of my way.', 'Stand down!'] },
  { id: 'cletus',    name: 'Cletus',    tag: 'Fuel & Chemistry',  color: '#c0803a', model: 'cletus',     front: '+z', wheels: true, size: 1.1, stats: { speed: 1.03, accel: 0.98, handling: 0.96, weight: 1.1 }, shout: ['Hoo-wee!', 'Smell that fuel!'] },
  { id: 'trixie',    name: 'Trixie',    tag: 'Acrobat Scout',     color: '#c2408f', model: 'trixie', front: '+x', wheels: true, size: 0.97, stats: { speed: 0.99, accel: 1.06, handling: 1.1, weight: 0.8 }, unlock: 'boneyard', shout: ['Ta-da!', 'Watch this!'] },
  { id: 'bigma',     name: 'Big Ma',    tag: 'Matriarch Medic',   color: '#9b3b2b', model: 'bigma', front: '+x', wheels: true, size: 0.9, stats: { speed: 1.04, accel: 0.95, handling: 0.95, weight: 1.3 }, unlock: 'chopshop', shout: ['Mind your manners!', 'Eat my dust, sugar.'] },
  { id: 'axel',      name: 'Axel',      tag: 'Pint-Sized Troublemaker', color: '#e2552a', model: 'axel', front: '+x', wheels: true, size: 0.62, stats: { speed: 1.0, accel: 1.1, handling: 1.08, weight: 0.75 }, unlock: 'perimeter', shout: ['Hehehe!', 'Gotcha!'] },
  { id: 'bristleback', name: 'Bristleback', tag: 'Leader of the Razor Boars', color: '#3f6b3a', model: 'bristleback', front: '+z', rival: true, stats: { speed: 1.05, accel: 0.95, handling: 0.95, weight: 1.35 }, shout: ['GRAAAH!', 'The Boars rule this yard!'] },
  { id: 'scorch',    name: 'Scorch',    tag: 'Leader of the Fever Foxes', color: '#ff6a1a', model: 'scorch', front: '+x', wheels: true, rival: true, stats: { speed: 1.04, accel: 1.03, handling: 1.02, weight: 0.95 }, shout: ['Too slow, scrap-heap!', 'Burn rubber!'] },
  { id: 'lurk',      name: 'Lurk',      tag: 'Shadow Bat Leader', color: '#5b3f8c', model: 'lurk', front: '+x', wheels: true, rival: true, stats: { speed: 1.06, accel: 0.98, handling: 1.04, weight: 0.9 }, shout: ['Skreeee!', 'From the shadows!'] },
];
const R = Object.fromEntries(RACERS.map(r => [r.id, r]));

/* ---------------- tracks (stage map) ----------------
   points: closed loop of control points (x, z) in metres, driven in order; the start line sits on the first.
   theme: sky panorama, fog/horizon colour, sun, ambient. props: scattered from the shared junkyard kit. */
const TRACKS = [
  { id: 'boneyard', name: 'Bone Yard GP', blurb: 'Dust, car stacks and the crusher. Where everything that\'s been is still useful.',
    rival: 'bristleback', unlockRacer: 'trixie', width: 16, tex: 'by', card: 'by_card',
    points: [[0, 0], [0, -120], [20, -170], [70, -186], [120, -162], [136, -112], [110, -72], [130, -30], [172, -12], [186, 40], [150, 82], [80, 92], [40, 62], [10, 40]],
    theme: { sky: 'by_sky', skyTop: 0x8d5e86, fog: 0xd9845a, fogNear: 90, fogFar: 520, sun: 0xffc48a, sunI: 3.1, sunDir: [-0.55, 0.32, -0.75], hemiSky: 0xffb48a, hemiGround: 0x6b4a2e, hemiI: 1.05, exposure: 1.0, groundTint: 0xd8a070 },
    crates: [0.16, 0.42, 0.66, 0.86], crane: 0.30, signs: ['byd0', 'byd1', 'byd2', 'byd3', 'byd4', 'byd5'] },
  { id: 'chopshop', name: 'Chop Shop Circuit', blurb: 'Tight and technical, through the workshop yard. If it had wheels, it\'ll have wheels again.',
    rival: 'scorch', unlockRacer: 'bigma', width: 13, tex: 'by', card: 'by_card',
    points: [[0, 0], [0, -80], [-15, -112], [-50, -118], [-72, -92], [-62, -62], [-92, -42], [-114, -62], [-142, -52], [-148, -10], [-122, 16], [-82, 10], [-56, 36], [-30, 42], [-10, 26]],
    theme: { sky: 'by_sky', skyTop: 0x8d5e86, fog: 0xc98a64, fogNear: 70, fogFar: 420, sun: 0xffd2a0, sunI: 2.8, sunDir: [0.5, 0.42, -0.6], hemiSky: 0xffc89a, hemiGround: 0x5a4030, hemiI: 1.0, exposure: 0.98, groundTint: 0xc89870 },
    crates: [0.2, 0.47, 0.72], crane: 0.55, signs: ['byd1', 'byd2', 'byd5', 'byd4'] },
  { id: 'perimeter', name: 'The Perimeter Run', blurb: 'Flat out along the camp fence, past the caravans of The Pits. Last line of defence against the wasteland.',
    rival: 'lurk', unlockRacer: 'axel', width: 18, tex: 'by', card: 'by_card',
    points: [[0, 0], [0, -160], [30, -232], [110, -262], [200, -242], [252, -172], [242, -82], [202, -22], [212, 60], [170, 122], [80, 132], [20, 92]],
    theme: { sky: 'by_sky', skyTop: 0x8d5e86, fog: 0xbfa98e, fogNear: 110, fogFar: 640, sun: 0xfff0d8, sunI: 3.4, sunDir: [0.3, 0.7, 0.4], hemiSky: 0xbfe3ff, hemiGround: 0x7a5a3a, hemiI: 1.2, exposure: 1.02, groundTint: 0xdcae7c, caravans: true },
    crates: [0.14, 0.38, 0.62, 0.84], crane: -1, signs: ['byd3', 'byd0', 'byd2', 'byd1'] },
];
const T = Object.fromEntries(TRACKS.map(t => [t.id, t]));
const START_RACERS = ['scrap', 'clyde', 'dixie', 'jebediah', 'cletus'];

/* ---------------- items ---------------- */
const ITEMS = {
  nitro:    { name: 'Nitro Can',          icon: '⚡', color: '#5fd3ff' },
  slick:    { name: 'Bean Slick',         icon: '🫘', color: '#c47a3a' },
  hubcap:   { name: 'Hubcap',             icon: '⭕', color: '#d9dde2' },
  firework: { name: "Cletus's Firework",  icon: '🎆', color: '#ff5a3a' },
  shield:   { name: 'Scrap Shield',       icon: '🛡️', color: '#ffd166' },
};
// weights by race position band: leaders get defensive items, the back of the pack gets catch-up items
const ITEM_ODDS = [
  { slick: 40, hubcap: 30, shield: 25, nitro: 5, firework: 0 },     // 1st
  { slick: 25, hubcap: 35, shield: 15, nitro: 15, firework: 10 },   // 2nd-3rd
  { slick: 12, hubcap: 30, shield: 10, nitro: 28, firework: 20 },   // 4th-5th
  { slick: 5, hubcap: 20, shield: 5, nitro: 40, firework: 30 },     // 6th-8th
];

/* ---------------- storage ----------------
   Progress, personal-best laps and best-lap ghosts stay on the player's own device. No online leaderboard. */
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
const LB = false;   // no online leaderboard for this game
const NICK_A = ['Rusty', 'Dusty', 'Grimy', 'Wild', 'Scrappy', 'Mighty', 'Rowdy', 'Lucky', 'Feral', 'Gnarly', 'Salty', 'Bent', 'Greasy', 'Speedy', 'Crusty', 'Rattly'];
const NICK_B = ['Hubcap', 'Piston', 'Wrench', 'Muffler', 'Sprocket', 'Bolt', 'Tyre', 'Crankshaft', 'Gasket', 'Bumper', 'Radiator', 'Clutch', 'Jalopy', 'Banger', 'Exhaust', 'Spanner'];
const pick = a => a[Math.floor(Math.random() * a.length)];
const newNick = () => pick(NICK_A) + pick(NICK_B) + String(Math.floor(Math.random() * 100)).padStart(2, '0');
let nick = store.get('fg_jr_nick', null);
if (!nick || !/^[A-Z][a-z]+[A-Z][a-z]+\d{2}$/.test(nick)) { nick = newNick(); store.set('fg_jr_nick', nick); }
const progress = Object.assign({ tracks: ['boneyard'], racers: START_RACERS.slice(), best: {} }, store.get('fg_jr_progress', {}));
function saveProgress() { store.set('fg_jr_progress', progress); }
START_RACERS.forEach(id => { if (!progress.racers.includes(id)) progress.racers.push(id); });   // racers added to the starting line-up after a player's first visit
const unlockedTrack = id => DEBUG || progress.tracks.includes(id);
const unlockedRacer = id => DEBUG || progress.racers.includes(id);

const $ = id => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const wrapAngle = a => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const coarse = matchMedia('(pointer: coarse)').matches;
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

/* ============================================================
   RENDERER + POST
   ============================================================ */
let renderer;
try { renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' }); }
catch (e) { $('err').style.display = 'grid'; throw e; }
const small = Math.min(innerWidth, innerHeight) < 700;
const LOW = small || Q.has('low');
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, LOW ? 1.5 : 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
$('stage').appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(68, innerWidth / innerHeight, 0.1, 1400);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth / 2, innerHeight / 2), LOW ? 0.35 : 0.5, 0.5, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());
let selOffset = false;
function selectFreeRect() {
  const q = id => { const e = document.getElementById(id); return e && e.offsetParent ? e.getBoundingClientRect() : null; };
  const tp = q('trackPicker'), nm = q('racerName'), wt = q('st_weight'), go = q('goBtn'), pv = q('racerPrev');
  if (!tp || !nm || !go) return null;
  const W = innerWidth, H = innerHeight, land = W > H;
  const panelTop = nm.top - 18, panelLeft = Math.min(nm.left, wt ? wt.left : nm.left) - 24;
  let x0 = pv ? pv.right + 6 : 0, x1 = W, y0 = tp.bottom + 8, y1 = land ? go.top - 8 : Math.min(panelTop, go.top) - 8;
  if (land) x1 = panelLeft;
  if (x1 - x0 < 120 || y1 - y0 < 90) return null;
  return { cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: x1 - x0, h: y1 - y0 };
}
function fitView() {
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); drawMinimapBase();
}
function fitSoon() { fitView(); setTimeout(fitView, 120); setTimeout(fitView, 400); setTimeout(fitView, 900); }   // phones report the new size late after rotating
addEventListener('resize', fitSoon);
addEventListener('orientationchange', fitSoon);
if (window.visualViewport) visualViewport.addEventListener('resize', fitSoon);
if (screen.orientation && screen.orientation.addEventListener) screen.orientation.addEventListener('change', fitSoon);

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 3); sun.castShadow = true;
sun.shadow.mapSize.set(LOW ? 1024 : 2048, LOW ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, near: 1, far: 260 });
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);

/* ---------------- loaders ---------------- */
const texLoader = new THREE.TextureLoader();
const gltfLoader = new GLTFLoader();
const texCache = {};
function tex(name, { repeat = null, srgb = true, ext = 'webp' } = {}) {
  const key = name + (repeat ? repeat.join('x') : '');
  if (texCache[key]) return texCache[key];
  const t = texLoader.load(BASE + 'tex/' + name + '.' + ext);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return (texCache[key] = t);
}
const modelCache = {};
function loadModel(name) {
  // the site serves .glb; a host that can't serve .glb (the private test page) sets JR_MODELS = 'json' for glTF JSON
  const url = window.JR_MODELS === 'json' ? BASE + 'models/' + name + '/model.json' : BASE + 'models/' + name + '.glb';
  if (!modelCache[name]) modelCache[name] = gltfLoader.loadAsync(url).then(g => {
    g.scene.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material.map) o.material.map.anisotropy = 8; } });
    return g.scene;
  });
  return modelCache[name];
}

/* ============================================================
   TRACK
   ============================================================ */
let track = null;     // { def, N, L, pos[], tan[], left[], dist[], halfW, group }
const world = new THREE.Group(); scene.add(world);

function buildTrack(def) {
  if (track) { world.remove(track.group); disposeGroup(track.group); }
  const g = new THREE.Group(); world.add(g);
  const th = def.theme;
  // ---- spline samples ----
  const curve = new THREE.CatmullRomCurve3(def.points.map(([x, z]) => new THREE.Vector3(x, 0, z)), true, 'centripetal', 0.5);
  const L = curve.getLength(), N = Math.round(L / SAMPLE_STEP);
  const pos = [], tan = [], left = [], dist = [];
  for (let i = 0; i < N; i++) {
    const u = i / N, p = curve.getPointAt(u), t = curve.getTangentAt(u).setY(0).normalize();
    pos.push(p); tan.push(t); left.push(new THREE.Vector3(t.z, 0, -t.x)); dist.push(u * L);   // left = 90° anticlockwise from forward
  }
  const halfW = def.width / 2;
  track = { def, N, L, pos, tan, left, dist, halfW, group: g, curve };

  // ---- lighting / atmosphere ----
  scene.fog = new THREE.Fog(th.fog, th.fogNear, th.fogFar);
  scene.background = new THREE.Color(th.skyTop || th.fog);
  hemi.color.set(th.hemiSky); hemi.groundColor.set(th.hemiGround); hemi.intensity = th.hemiI;
  sun.color.set(th.sun); sun.intensity = th.sunI;
  track.sunDir = new THREE.Vector3(...th.sunDir).normalize();
  renderer.toneMappingExposure = th.exposure;

  // ---- sky: panorama on a cylinder (mirrored so it wraps without a seam) ----
  const skyT = tex(th.sky); skyT.wrapS = THREE.MirroredRepeatWrapping; skyT.repeat.set(3, 1);
  const sky = new THREE.Mesh(new THREE.CylinderGeometry(900, 900, 520, 64, 1, true),
    new THREE.MeshBasicMaterial({ map: skyT, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.position.y = 150; sky.renderOrder = -1; g.add(sky); track.sky = sky;
  const cap = new THREE.Mesh(new THREE.CircleGeometry(900, 48), new THREE.MeshBasicMaterial({ color: th.skyTop || th.fog, side: THREE.DoubleSide, fog: false, depthWrite: false }));
  cap.rotation.x = Math.PI / 2; cap.position.y = 900; cap.renderOrder = -1; sky.add(cap);
  // above the panorama: a plain band in the sky's top colour, so the edge of the picture never shows
  const band = new THREE.Mesh(new THREE.CylinderGeometry(900, 900, 640, 48, 1, true), new THREE.MeshBasicMaterial({ color: th.skyTop || th.fog, side: THREE.BackSide, fog: false, depthWrite: false }));
  band.position.y = 260 + 320 - 1; band.renderOrder = -1; sky.add(band);

  // ---- ground: big desert plane in the dirt texture, tinted ----
  const gT = tex(def.tex + '_road', { repeat: [90, 90] }), gN = tex(def.tex + '_roadN', { repeat: [90, 90], srgb: false });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1800, 1800),
    new THREE.MeshStandardMaterial({ map: gT, normalMap: gN, normalScale: new THREE.Vector2(0.6, 0.6), color: th.groundTint, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true; g.add(ground);

  // ---- road ribbon (tread-packed dirt, brighter and smoother than the open ground) ----
  const roadGeo = ribbon(i => 0, -halfW, halfW, 0.0, L / 10, 1);
  const rT = tex(def.tex + '_road', { repeat: [1, 1] }), rN = tex(def.tex + '_roadN', { repeat: [1, 1], srgb: false });
  const road = new THREE.Mesh(roadGeo, new THREE.MeshStandardMaterial({ map: rT, normalMap: rN, color: 0xfff2e2, roughness: 0.95 }));
  road.receiveShadow = true; g.add(road);
  // tyre-track darkening down the racing line (subtle, breaks up the tiling)
  const groove = new THREE.Mesh(ribbon(i => 0, -halfW * 0.55, halfW * 0.55, 0.01, 1, 1),
    new THREE.MeshBasicMaterial({ color: 0x3a2412, transparent: true, opacity: 0.12, depthWrite: false }));
  g.add(groove);
  // verge strips: loose sand, darker
  for (const side of [-1, 1]) {
    const v = new THREE.Mesh(ribbon(i => 0, side > 0 ? halfW : -halfW - VERGE, side > 0 ? halfW + VERGE : -halfW, 0.005, L / 4, 0.8),
      new THREE.MeshStandardMaterial({ map: tex(def.tex + '_road', { repeat: [1, 1] }), normalMap: tex(def.tex + '_roadN', { repeat: [1, 1], srgb: false }), color: 0xe6c49c, roughness: 1 }));
    v.receiveShadow = true; g.add(v);
  }
  // ---- barriers: junk walls of car doors, sheet metal and tyres (the junk-wall texture), both sides ----
  const wT = tex(def.tex + '_wall'), wN = tex(def.tex + '_wallN', { srgb: false });
  for (const t of [wT, wN]) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping; }
  const wallMat = new THREE.MeshStandardMaterial({ map: wT, normalMap: wN, roughness: 0.85, metalness: 0.25, side: THREE.DoubleSide });
  for (const side of [-1, 1]) {
    const off = side * (halfW + VERGE);
    const wall = new THREE.Mesh(wallStrip(off, 2.3, 8), wallMat); wall.castShadow = true; wall.receiveShadow = true; g.add(wall);
  }
  // ---- start line, gantry, grid boxes ----
  buildStart(g);
  // ---- props, signs, crane, distance stacks ----
  scatterProps(g, def);
  // ---- item crates ----
  buildCrates(g, def);
  drawMinimapBase();
}

// A flat strip following the track between lateral offsets a..b (left positive), UV v runs along the track.
function ribbon(hFn, a, b, y, vRepeat, uRepeat) {
  const { N, pos, left, L } = track;
  const P = [], UV = [], I = [];
  for (let i = 0; i <= N; i++) {
    const k = i % N, p = pos[k], l = left[k], v = (i / N) * vRepeat;
    P.push(p.x + l.x * a, y, p.z + l.z * a, p.x + l.x * b, y, p.z + l.z * b);
    UV.push(0, v, uRepeat, v);
    if (i < N) { const j = i * 2; I.push(j, j + 2, j + 1, j + 1, j + 2, j + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  geo.setIndex(I); geo.computeVertexNormals();
  // normals straight up (the strip is flat)
  const n = geo.attributes.normal; for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  // tangents for normal maps are derived in the shader from UV derivatives, so no tangent attribute is needed
  return geo;
}
// A vertical wall strip at lateral offset `off`, height h; the texture repeats every `seg` metres along the track.
function wallStrip(off, h, seg) {
  const { N, pos, left, L } = track;
  const P = [], UV = [], I = [];
  for (let i = 0; i <= N; i++) {
    const k = i % N, p = pos[k], l = left[k], u = (i / N) * L / seg;
    const x = p.x + l.x * off, z = p.z + l.z * off;
    P.push(x, 0, z, x, h, z); UV.push(u, 0.02, u, 0.9);
    if (i < N) { const j = i * 2; I.push(j, j + 1, j + 2, j + 2, j + 1, j + 3); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  geo.setIndex(I); geo.computeVertexNormals();
  return geo;
}
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function buildStart(g) {
  const { pos, left, tan, halfW } = track;
  // chequered line painted on the dirt
  const chk = canvasTex(256, 32, (x, w, h) => { for (let i = 0; i < 16; i++) for (let j = 0; j < 2; j++) { x.fillStyle = (i + j) % 2 ? '#f1ece2' : '#1c1a17'; x.fillRect(i * 16, j * 16, 16, 16); } });
  const line = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, 2), new THREE.MeshStandardMaterial({ map: chk, roughness: 0.9, transparent: true, opacity: 0.88 }));
  line.rotation.x = -Math.PI / 2; line.rotation.z = Math.atan2(tan[0].x, tan[0].z) + Math.PI; line.position.set(pos[0].x, 0.02, pos[0].z); g.add(line);
  // gantry: two rusty scaffold posts and a beam carrying the BONE YARD GP sign
  const metal = new THREE.MeshStandardMaterial({ map: tex(track.def.tex + '_metal', { repeat: [1, 3] }), roughness: 0.7, metalness: 0.4 });
  const gant = new THREE.Group();
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.5, 7, 0.5), metal); p.position.set(s * (halfW + 1.5), 3.5, 0); p.castShadow = true; gant.add(p); }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + 3.5, 0.7, 0.6), metal); beam.position.y = 6.8; beam.castShadow = true; gant.add(beam);
  // the Bone Yard has its painted sign; other tracks get a rusty name plate in the same spirit
  const signT = track.def.id === 'boneyard' ? tex('byd0') : canvasTex(1024, 296, (x, w, h) => {
    const r = 26; x.beginPath(); x.moveTo(r, 8); x.arcTo(w - 8, 8, w - 8, h - 8, r); x.arcTo(w - 8, h - 8, 8, h - 8, r); x.arcTo(8, h - 8, 8, 8, r); x.arcTo(8, 8, w - 8, 8, r); x.closePath();
    const gr = x.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#5b3a24'); gr.addColorStop(0.5, '#7a4a2a'); gr.addColorStop(1, '#4a2d1b'); x.fillStyle = gr; x.fill();
    x.lineWidth = 14; x.strokeStyle = '#2a1b12'; x.stroke();
    for (let i = 0; i < 160; i++) { x.fillStyle = `rgba(${150 + Math.random() * 60 | 0},${70 + Math.random() * 40 | 0},20,${Math.random() * 0.18})`; x.beginPath(); x.arc(30 + Math.random() * (w - 60), 30 + Math.random() * (h - 60), 4 + Math.random() * 22, 0, 7); x.fill(); }
    x.fillStyle = '#c9b48a'; for (const [cx, cy] of [[40, 40], [w - 40, 40], [40, h - 40], [w - 40, h - 40]]) { x.beginPath(); x.arc(cx, cy, 10, 0, 7); x.fill(); }
    let fs = 170; const label = track.def.name.toUpperCase(); x.font = `${fs}px "Bebas Neue", Impact, sans-serif`;
    while (x.measureText(label).width > w - 120 && fs > 60) { fs -= 6; x.font = `${fs}px "Bebas Neue", Impact, sans-serif`; }
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillStyle = '#1d1209'; x.fillText(label, w / 2 + 5, h / 2 + 11);
    x.fillStyle = '#f2c200'; x.fillText(label, w / 2, h / 2 + 6);
  }); const sign = new THREE.Mesh(new THREE.PlaneGeometry(9, 2.6), new THREE.MeshStandardMaterial({ map: signT, transparent: true, alphaTest: 0.3, roughness: 0.8, side: THREE.DoubleSide }));
  sign.position.set(0, 5.1, -0.35); sign.rotation.y = Math.PI; gant.add(sign);
  // hanging tyres either side of the sign
  const tyreGeo = new THREE.TorusGeometry(0.45, 0.2, 10, 20), tyreMat = new THREE.MeshStandardMaterial({ color: 0x1b1a19, roughness: 0.9 });
  for (const s of [-1, 1]) { const t = new THREE.Mesh(tyreGeo, tyreMat); t.position.set(s * 6.2, 5.2, 0); t.castShadow = true; gant.add(t); }
  gant.position.copy(pos[0]); gant.rotation.y = Math.atan2(tan[0].x, tan[0].z); g.add(gant);
}

/* ---------------- props ----------------
   The shared junkyard kit (Higgsfield models): caravan, wreck, pickup, junk pile, crane, barrels.
   Placed outside the barriers so they frame the track, plus big stacks on the horizon. */
const PROP_KIT = { caravan: 4.2, wreck: 4.6, pickup: 5.0, junkpile: 5.5, crane: 14, barrels: 2.6 };   // target size (m) along longest axis
function placeModel(g, name, x, z, rotY, size, { shadow = true } = {}) {
  const holder = new THREE.Group(); holder.position.set(x, 0, z); holder.rotation.y = rotY; g.add(holder);
  loadModel(name).then(src => {
    const m = src.clone(true);
    const box = new THREE.Box3().setFromObject(m), s = box.getSize(new THREE.Vector3());
    const k = size / Math.max(s.x, s.y, s.z); m.scale.setScalar(k);
    m.position.y = -box.min.y * k; m.position.x = -(box.min.x + box.max.x) / 2 * k; m.position.z = -(box.min.z + box.max.z) / 2 * k;
    if (!shadow) m.traverse(o => { if (o.isMesh) o.castShadow = false; });
    holder.add(m);
  }).catch(() => {});
  return holder;
}
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
function scatterProps(g, def) {
  const { N, pos, left, tan, halfW } = track;
  const r = rng(def.id.length * 977 + 13);
  const near = def.theme.caravans ? ['caravan', 'caravan', 'wreck', 'barrels', 'pickup', 'junkpile'] : ['wreck', 'barrels', 'junkpile', 'pickup', 'barrels', 'wreck', 'caravan'];
  const occupied = [];
  const free = (x, z, rad) => {
    for (const o of occupied) if ((o[0] - x) ** 2 + (o[1] - z) ** 2 < (o[2] + rad) ** 2) return false;
    // keep clear of the whole track (props must never sit on the racing surface)
    for (let i = 0; i < N; i += 3) { const p = pos[i]; if ((p.x - x) ** 2 + (p.z - z) ** 2 < (halfW + VERGE + rad + 1) ** 2) return false; }
    return true;
  };
  // trackside props every ~22 m, alternating sides
  for (let i = 0; i < N; i += 22) {
    for (const side of [-1, 1]) {
      if (r() < 0.25) continue;
      const type = near[Math.floor(r() * near.length)], size = PROP_KIT[type] * (0.85 + r() * 0.3);
      const off = side * (halfW + VERGE + size * 0.5 + 1.5 + r() * 5);
      const k = (i + Math.floor(r() * 10)) % N, x = pos[k].x + left[k].x * off, z = pos[k].z + left[k].z * off;
      if (!free(x, z, size * 0.5)) continue;
      occupied.push([x, z, size * 0.5]);
      placeModel(g, type, x, z, r() * Math.PI * 2, size);
    }
  }
  // the crane at its spot on the outside of the corner
  if (def.crane >= 0) {
    const k = Math.floor(def.crane * N); const off = halfW + VERGE + 12;
    const x = pos[k].x + left[k].x * off, z = pos[k].z + left[k].z * off;
    if (free(x, z, 6)) { occupied.push([x, z, 6]); placeModel(g, 'crane', x, z, Math.atan2(-left[k].x, -left[k].z), PROP_KIT.crane); }
  }
  // horizon: big junk stacks in a ring well outside the circuit (no shadows, cheap)
  const ctr = new THREE.Vector3(); pos.forEach(p => ctr.add(p)); ctr.multiplyScalar(1 / N);
  let rad = 0; pos.forEach(p => { rad = Math.max(rad, p.distanceTo(ctr)); });
  for (let a = 0; a < Math.PI * 2; a += 0.22) {
    const d = rad + 45 + r() * 60, x = ctr.x + Math.cos(a) * d, z = ctr.z + Math.sin(a) * d;
    if (!free(x, z, 8)) continue;
    placeModel(g, r() < 0.7 ? 'junkpile' : 'wreck', x, z, r() * 6.28, 12 + r() * 14, { shadow: false });
  }
  // hand-painted signs on wooden posts along the barriers (two or three in view at most)
  const signs = def.signs; const postMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.95 });
  signs.forEach((s, n) => {
    const k = Math.floor(((n + 0.5) / signs.length) * N + 30) % N, side = n % 2 ? 1 : -1, off = side * (halfW + VERGE + 0.8);
    const grp = new THREE.Group(); grp.position.set(pos[k].x + left[k].x * off, 0, pos[k].z + left[k].z * off);
    grp.rotation.y = Math.atan2(tan[k].x, tan[k].z) + Math.PI + side * 0.35;   // face oncoming karts
    const t = tex(s), img = t.image;
    const sm = new THREE.Mesh(new THREE.PlaneGeometry(2.8, 1.2), new THREE.MeshStandardMaterial({ map: t, transparent: true, alphaTest: 0.35, roughness: 0.85, side: THREE.DoubleSide }));
    sm.position.y = 3.3; sm.castShadow = true; grp.add(sm);
    t.onUpdate = null; const fix = () => { if (t.image && t.image.width) sm.scale.set(1, (t.image.height / t.image.width) * 2.8 / 1.2, 1); };
    if (img && img.width) fix(); else setTimeout(function w() { if (t.image && t.image.width) fix(); else setTimeout(w, 200); }, 200);
    for (const px of [-0.9, 0.9]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.14, 3.2, 0.14), postMat); p.position.set(px, 1.6, -0.05); p.castShadow = true; grp.add(p); }
    g.add(grp);
  });
}
function disposeGroup(g) {
  g.traverse(o => { if (o.geometry) o.geometry.dispose(); });
}

/* ---------------- nearest-sample lookup ----------------
   Each kart remembers its sample index; we search a window around it, so this stays cheap. */
function locate(p, hint, win = 40) {
  const { N, pos } = track;
  let best = hint, bd = Infinity;
  for (let o = -win; o <= win; o++) {
    const i = (hint + o + N) % N, q = pos[i], d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
function locateGlobal(p) {
  const { N, pos } = track; let best = 0, bd = Infinity;
  for (let i = 0; i < N; i++) { const q = pos[i], d = (q.x - p.x) ** 2 + (q.z - p.z) ** 2; if (d < bd) { bd = d; best = i; } }
  return best;
}
const lateral = (p, i) => { const q = track.pos[i], l = track.left[i]; return (p.x - q.x) * l.x + (p.z - q.z) * l.z; };

/* ============================================================
   KARTS
   ============================================================ */
const karts = [];
let player = null;
const FRONT_YAW = { '-z': 0, '+z': Math.PI, '-x': -Math.PI / 2, '+x': Math.PI / 2 };
const KART_LEN = 2.1;

// Hand-built stand-in kart (used until a racer's Higgsfield model exists, and while a model loads).
function standInKart(color) {
  const g = new THREE.Group();
  const c = new THREE.Color(color);
  const paint = new THREE.MeshStandardMaterial({ color: c, roughness: 0.55, metalness: 0.35 });
  const rust = new THREE.MeshStandardMaterial({ map: tex('by_metal', { repeat: [1, 1] }), roughness: 0.8, metalness: 0.4 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x232120, roughness: 0.85 });
  const tub = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.32, 1.9), rust); tub.position.y = 0.38; g.add(tub);
  const nose = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.28, 0.6), paint); nose.position.set(0, 0.48, -0.85); g.add(nose);
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.5, 0.15), dark); seat.position.set(0, 0.72, 0.42); g.add(seat);
  const cage = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.04, 6, 16, Math.PI), rust); cage.position.set(0, 0.8, 0.5); g.add(cage);
  // driver: body, head, helmet-less wild hair blob in the racer's colour
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.24, 0.35, 4, 10), paint); body.position.set(0, 0.95, 0.2); g.add(body);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 12), new THREE.MeshStandardMaterial({ color: 0xd9a27c, roughness: 0.7 })); head.position.set(0, 1.38, 0.15); g.add(head);
  const hair = new THREE.Mesh(new THREE.SphereGeometry(0.21, 12, 10, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: c.clone().multiplyScalar(0.6), roughness: 0.9 })); hair.position.copy(head.position).add(new THREE.Vector3(0, 0.04, 0.02)); g.add(hair);
  const exhaust = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.5, 8), rust); exhaust.rotation.x = Math.PI / 2; exhaust.position.set(0.35, 0.5, 1.05); g.add(exhaust);
  g.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}
const TYRE_GEO = new THREE.CylinderGeometry(0.32, 0.32, 0.26, 18); TYRE_GEO.rotateZ(Math.PI / 2);
const TYRE_MAT = new THREE.MeshStandardMaterial({ color: 0x1d1c1b, roughness: 0.92 });
const RIM_GEO = new THREE.CylinderGeometry(0.17, 0.17, 0.27, 10); RIM_GEO.rotateZ(Math.PI / 2);
const RIM_MAT = new THREE.MeshStandardMaterial({ color: 0x8a7a66, roughness: 0.5, metalness: 0.7 });
function makeWheel() { const w = new THREE.Group(); const t = new THREE.Mesh(TYRE_GEO, TYRE_MAT), r = new THREE.Mesh(RIM_GEO, RIM_MAT); t.castShadow = true; w.add(t, r); return w; }

class Kart {
  constructor(racer, isPlayer) {
    this.r = racer; this.isPlayer = isPlayer;
    this.root = new THREE.Group();        // position + heading
    this.tilt = new THREE.Group();        // body roll/pitch, hop, spin-out
    this.body = new THREE.Group();        // the visual kart
    this.root.add(this.tilt); this.tilt.add(this.body); world.add(this.root);
    this.wheels = [];
    this.stand = standInKart(racer.color); this.body.add(this.stand);
    if (racer.model) this.stand.visible = false;   // modelled racers never show the blocky stand-in, even while loading
    this.shadowBlob = new THREE.Mesh(new THREE.CircleGeometry(1.25, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.32, depthWrite: false }));
    this.shadowBlob.rotation.x = -Math.PI / 2; this.shadowBlob.position.y = 0.03; this.shadowBlob.scale.set(0.75, 1.1, 1); this.root.add(this.shadowBlob);
    // drift sparks (two small glowing sprites at the rear wheels) and boost flame
    this.sparks = [-1, 1].map(s => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), new THREE.MeshBasicMaterial({ color: 0x5fd3ff, transparent: true, opacity: 0, toneMapped: false })); m.position.set(s * 0.55, 0.18, 0.95); this.root.add(m); return m; });
    this.flame = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.9, 10), new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0, toneMapped: false }));
    this.flame.rotation.x = -Math.PI / 2; this.flame.position.set(0, 0.5, 1.4); this.root.add(this.flame);
    this.shieldMesh = new THREE.Mesh(new THREE.SphereGeometry(1.5, 20, 14), new THREE.MeshBasicMaterial({ color: 0xffd166, transparent: true, opacity: 0.0, depthWrite: false, toneMapped: false }));
    this.shieldMesh.position.y = 0.8; this.root.add(this.shieldMesh);
    this.loaded = !racer.model;
    if (racer.model) this.loadModel();
    this.reset(new THREE.Vector3(), 0, 0);
  }
  loadModel() {
    loadModel(this.r.model).then(src => {
      const m = src.clone(true);
      const box = new THREE.Box3().setFromObject(m), s = box.getSize(new THREE.Vector3());
      const lenAxis = (this.r.front === '+x' || this.r.front === '-x') ? s.x : s.z;
      const sz0 = this.r.size || 1, k = KART_LEN * sz0 / lenAxis; m.scale.setScalar(k);   // size: per-racer correction for unusually tall models
      const ctr = box.getCenter(new THREE.Vector3());
      const holder = new THREE.Group(); holder.rotation.y = FRONT_YAW[this.r.front] || 0;
      m.position.set(-ctr.x * k, -box.min.y * k, -ctr.z * k); holder.add(m);
      if (this.r.wheels) {   // bare hubs: fit spinning tyres at the four corners
        const W = ((this.r.front === '+x' || this.r.front === '-x') ? s.z : s.x) * k;
        for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
          if (this.r.wheels === 'front' && sz > 0) continue;   // model already has rear wheels
          const w = makeWheel(); w.scale.setScalar(sz0); w.position.set(sx * (W / 2 - 0.08 * sz0), 0.32 * sz0, sz * KART_LEN * sz0 * 0.33); this.body.add(w); this.wheels.push(w);
        }
        m.position.y += 0.06 * sz0;
      }
      this.body.remove(this.stand); this.body.add(holder); this.model = holder; this.loaded = true;
    }).catch(e => { this.loaded = true; console.warn('kart model failed, keeping stand-in', this.r.id, e); });
    if (!this.r.model) return;
  }
  reset(p, heading, sIdx) {
    this.pos = p.clone(); this.heading = heading; this.speed = 0; this.vlat = 0; this.vy = 0; this.y = 0;
    this.sIdx = sIdx; this.lap = 0; this.lapStartT = 0; this.lapTimes = []; this.passedHalf = false; this.prog = 0;
    this.finished = false; this.finishT = 0; this.place = 0;
    this.drift = 0; this.driftCharge = 0; this.driftHop = 0; this.boost = 0; this.spin = 0; this.squash = 0;
    this.item = null; this.roulette = 0; this.shield = false; this.offroad = false; this.wallHit = 0; this.lastShout = 0;
    this.input = { throttle: 0, brake: 0, steer: 0, drift: false, item: false };
    this.prevDrift = false; this.prevItem = false; this.airborne = 0;
    this.root.position.copy(this.pos); this.root.rotation.y = heading;
  }
  get fwd() { return new THREE.Vector3(-Math.sin(this.heading), 0, -Math.cos(this.heading)); }
  maxSpeed() {
    const st = this.r.stats; let m = MAX_SPEED * st.speed * (this.skill || 1);
    if (this.offroad && this.boost <= 0) m *= 0.55;
    if (this.boost > 0) m *= BOOST_MULT;
    return m;
  }
}

/* ---------------- physics ---------------- */
function stepKart(k, dt) {
  const inp = k.input, st = k.r.stats;
  // spin-out: no control, bleed speed, rotate the body
  if (k.spin > 0) {
    k.spin -= dt; k.speed *= Math.pow(0.12, dt); k.drift = 0; k.driftCharge = 0;
    k.tilt.rotation.y = (1 - Math.max(0, k.spin) / 1.1) * Math.PI * 4;
    if (k.spin <= 0) k.tilt.rotation.y = 0;
  } else {
    // throttle / brake
    const max = k.maxSpeed();
    if (inp.throttle > 0) k.speed += ACCEL * st.accel * inp.throttle * (k.speed < max ? 1 : -0.6) * dt * (k.speed > max * 0.8 ? 0.6 : 1);
    if (k.speed > max) k.speed = Math.max(max, k.speed - 18 * dt);
    if (inp.brake > 0) k.speed -= (k.speed > 0 ? BRAKE : ACCEL * 0.6) * inp.brake * dt;
    if (inp.throttle <= 0 && inp.brake <= 0) k.speed -= Math.sign(k.speed) * Math.min(Math.abs(k.speed), (4 + DRAG * Math.abs(k.speed)) * dt);
    k.speed = clamp(k.speed, -REVERSE_MAX, max * 1.05);
    // drift: hop on press while steering at speed, hold to charge, release for a mini-turbo
    const pressed = inp.drift && !k.prevDrift;
    if (pressed && k.drift === 0 && k.y <= 0.001) { k.vy = 4.2; k.driftHop = 1; }
    if (k.drift === 0 && inp.drift && k.driftHop && Math.abs(inp.steer) > 0.25 && k.speed > DRIFT_MIN_SPEED) { k.drift = Math.sign(inp.steer); k.driftCharge = 0; }
    if (k.drift !== 0) {
      k.driftCharge += dt * (0.75 + 0.5 * Math.max(0, inp.steer * k.drift));
      if (!inp.drift || k.speed < DRIFT_MIN_SPEED * 0.75 || k.offroad && k.boost <= 0) {
        const tier = DRIFT_TIERS.reduce((t, s, i) => (k.driftCharge >= s ? i : t), -1);
        if (tier >= 0 && inp.drift === false) { k.boost = Math.max(k.boost, DRIFT_BOOST[tier]); if (k.isPlayer) sfx.boost(); }
        k.drift = 0; k.driftCharge = 0;
      }
    }
    if (!inp.drift) k.driftHop = 0;
    // steering
    const sp = Math.abs(k.speed), grip = clamp(sp / 7, 0, 1) * (1 - 0.18 * clamp((sp - 20) / 15, 0, 1));
    let yawRate;
    if (k.drift !== 0) yawRate = k.drift * (0.62 + 0.55 * (inp.steer * k.drift + 1) / 2) * TURN * st.handling;
    else yawRate = -inp.steer * TURN * st.handling * grip * (k.speed < 0 ? -1 : 1);
    if (k.drift !== 0) yawRate = -yawRate;
    k.heading += yawRate * dt;
    // lateral slide while drifting (the back steps out), damped by grip otherwise
    const targetLat = k.drift !== 0 ? k.drift * sp * 0.12 : 0;   // the back steps out: slide to the outside of the turn
    k.vlat = lerp(k.vlat, targetLat, 1 - Math.pow(0.02, dt));
    k.tilt.rotation.y = lerp(k.tilt.rotation.y, k.drift !== 0 ? -k.drift * 0.42 : 0, 1 - Math.pow(0.001, dt));
  }
  k.prevDrift = inp.drift;
  // vertical: hop / jumps
  k.vy -= 26 * dt; k.y += k.vy * dt; if (k.y < 0) { if (k.vy < -3) k.squash = 0.18; k.y = 0; k.vy = 0; }
  // integrate
  const f = k.fwd, l = new THREE.Vector3(f.z, 0, -f.x);   // left of the kart
  k.pos.addScaledVector(f, k.speed * dt).addScaledVector(l, k.vlat * dt);
  if (k.boost > 0) k.boost -= dt;
  if (k.wallHit > 0) k.wallHit -= dt;
  // track bounds
  const prev = k.sIdx;
  k.sIdx = locate(k.pos, k.sIdx);
  const lat = lateral(k.pos, k.sIdx), lim = track.halfW + VERGE - KART_R * 0.8;
  k.offroad = Math.abs(lat) > track.halfW + 0.2;
  if (Math.abs(lat) > lim) {
    const push = Math.sign(lat) * (Math.abs(lat) - lim), L = track.left[k.sIdx];
    k.pos.x -= L.x * push; k.pos.z -= L.z * push;
    // steer the kart back towards parallel and scrub speed (a glancing bounce, not a dead stop)
    const tdir = Math.atan2(-track.tan[k.sIdx].x, -track.tan[k.sIdx].z);
    const into = wrapAngle(tdir - k.heading);
    if (k.wallHit <= 0) { k.speed *= 0.72; k.wallHit = 0.25; if (k.isPlayer) { sfx.thud(); shake(0.25); } k.drift = 0; k.driftCharge = 0; }
    k.heading += into * 0.35; k.vlat = 0;
  }
  // lap counting: must pass the half-way mark before the line counts
  const N = track.N;
  if (k.sIdx > N * 0.45 && k.sIdx < N * 0.55) k.passedHalf = true;
  if (prev > N * 0.9 && k.sIdx < N * 0.1) {
    if (k.passedHalf) { onLap(k); k.passedHalf = false; }
  } else if (prev < N * 0.1 && k.sIdx > N * 0.9 && k.lap > 0 && !k.passedHalf) { k.lap--; k.passedHalf = true; }   // reversed over the line
  // race distance: before the half-way mark the second half of the loop still belongs to the previous lap
  k.prog = k.lap * track.L + track.dist[k.sIdx] - (k.sIdx > N * 0.5 && !k.passedHalf ? track.L : 0);
  // visuals
  k.root.position.set(k.pos.x, k.y, k.pos.z); k.root.rotation.y = k.heading;
  const roll = clamp(-k.input.steer * Math.abs(k.speed) / 60, -0.08, 0.08) + (k.drift ? k.drift * 0.05 : 0);
  k.tilt.rotation.z = lerp(k.tilt.rotation.z, roll, 0.15);
  k.tilt.rotation.x = lerp(k.tilt.rotation.x, k.boost > 0 ? 0.05 : 0, 0.1);
  k.squash = Math.max(0, k.squash - dt); const sq = k.squash > 0 ? Math.sin(k.squash / 0.18 * Math.PI) * 0.12 : 0;
  k.body.scale.set(1 + sq * 0.5, 1 - sq, 1 + sq * 0.5);
  k.shadowBlob.position.y = 0.03 - k.y; k.shadowBlob.material.opacity = 0.32 * (1 - clamp(k.y / 3, 0, 0.8));
  for (const w of k.wheels) w.children[0].rotation.x -= k.speed * dt / 0.32;
  const tier = k.drift ? DRIFT_TIERS.reduce((t, s, i) => (k.driftCharge >= s ? i : t), -1) : -1;
  const sc = [0x5fd3ff, 0xffa03a, 0xd06bff][Math.max(0, tier)];
  k.sparks.forEach((m, i) => { m.material.color.setHex(sc); m.material.opacity = tier >= 0 ? 0.65 + 0.35 * Math.sin(perfNow() * 0.05 + i * 2) : 0; m.scale.setScalar(tier >= 0 ? 1 + tier * 0.5 + Math.random() * 0.6 : 1); });
  k.flame.material.opacity = k.boost > 0 ? 0.85 : 0; k.flame.scale.set(1, 0.7 + Math.random() * 0.6, 1);
  k.shieldMesh.material.opacity = k.shield ? 0.16 + 0.06 * Math.sin(perfNow() * 0.008) : 0;
}
const perfNow = () => performance.now();

// kart-to-kart bumps: separate overlapping karts, heavier karts shove lighter ones
function collideKarts() {
  for (let i = 0; i < karts.length; i++) for (let j = i + 1; j < karts.length; j++) {
    const a = karts[i], b = karts[j], dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d2 = dx * dx + dz * dz, R2 = (KART_R * 2) ** 2;
    if (d2 > R2 || d2 < 1e-6) continue;
    const d = Math.sqrt(d2), o = (KART_R * 2 - d), nx = dx / d, nz = dz / d;
    const wa = a.r.stats.weight, wb = b.r.stats.weight, ta = wb / (wa + wb), tb = wa / (wa + wb);
    a.pos.x -= nx * o * ta; a.pos.z -= nz * o * ta; b.pos.x += nx * o * tb; b.pos.z += nz * o * tb;
    if ((a.isPlayer || b.isPlayer) && o > 0.15) sfx.bump();
  }
}

/* ============================================================
   AI DRIVERS
   ============================================================ */
function aiThink(k, dt) {
  const { N, pos, tan } = track, sp = Math.abs(k.speed);
  k.aiT = (k.aiT || 0) - dt;
  if (k.aiT <= 0) { k.aiT = 1.5 + Math.random() * 2.5; k.aiLane = (Math.random() * 2 - 1) * track.halfW * 0.55; }
  // look ahead along the racing line, further when faster
  const ahead = Math.floor(8 + sp * 0.55), ti = (k.sIdx + ahead) % N, tp = pos[ti].clone().addScaledVector(track.left[ti], k.aiLane || 0);
  // avoid bean slicks lying ahead
  for (const s of slicks) { if (s.pos.distanceTo(tp) < 3.2) tp.addScaledVector(track.left[ti], lateral(s.pos, ti) > 0 ? -3.5 : 3.5); }
  const want = Math.atan2(-(tp.x - k.pos.x), -(tp.z - k.pos.z));
  const diff = wrapAngle(want - k.heading);
  k.input.steer = clamp(-diff * 2.4, -1, 1);
  // corner speed: how sharp is the road further ahead?
  const far = (k.sIdx + ahead * 2) % N, bend = Math.abs(wrapAngle(Math.atan2(tan[far].x, tan[far].z) - Math.atan2(tan[k.sIdx].x, tan[k.sIdx].z)));
  const cornerMax = MAX_SPEED * (1.15 - clamp(bend, 0, 1.3) * 0.38);
  k.input.throttle = sp < cornerMax ? 1 : 0.2; k.input.brake = sp > cornerMax * 1.15 && Math.abs(diff) > 0.3 ? 0.6 : 0;
  // AI drift on long bends for its own mini-turbos (looks right and keeps the pack quick)
  if (!k.aiDrift && bend > 0.55 && sp > 18 && Math.random() < dt * 1.2) { k.aiDrift = 0.9 + Math.random() * 0.9; }
  if (k.aiDrift > 0) { k.aiDrift -= dt; k.input.drift = k.aiDrift > 0; if (k.aiDrift <= 0) k.aiDrift = 0; } else k.input.drift = false;
  // rubber band against the player so races stay close (gentle, and never on Time Trial)
  const d = DIFFS[race.diff];
  k.skill = d.ai * (k.r.id === race.track.rival ? 1.03 : 1) * (k.prog > player.prog + 60 ? d.rubberFront : k.prog < player.prog - 60 ? d.rubberBack : 1) * k.aiBase;
  // items
  k.input.item = false;
  if (k.item && k.roulette <= 0) {
    k.itemWait = (k.itemWait ?? (0.8 + Math.random() * 3)) - dt;
    const behind = karts.some(o => o !== k && o.prog < k.prog && k.prog - o.prog < 14);
    const targetAhead = karts.some(o => o !== k && o.prog > k.prog && o.prog - k.prog < 40);
    const use = k.item === 'slick' ? behind || k.itemWait < -6 : k.item === 'hubcap' ? targetAhead || k.itemWait < -6 : k.item === 'shield' ? k.itemWait < -2 : k.itemWait < 0;
    if (use && Math.random() < d.itemSkill + 0.3) { k.input.item = true; k.itemWait = null; }
  }
}

/* ============================================================
   ITEMS: crates, pickups, projectiles
   ============================================================ */
let crates = [], slicks = [], shots = [];
const CRATE_TEX = canvasTex(256, 256, (x, w, h) => {
  // a rusty supply crate with a spray-painted question mark (the item crate)
  x.fillStyle = '#7a5434'; x.fillRect(0, 0, w, h);
  for (let i = 0; i < 6; i++) { x.fillStyle = i % 2 ? '#6a472b' : '#835c39'; x.fillRect(0, i * h / 6, w, h / 6 - 3); }
  x.strokeStyle = '#3b2a1b'; x.lineWidth = 10; x.strokeRect(5, 5, w - 10, h - 10);
  x.fillStyle = '#ffd23f'; x.font = '900 170px "Barlow Condensed", Impact, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.shadowColor = 'rgba(0,0,0,0.5)'; x.shadowBlur = 8; x.fillText('?', w / 2, h / 2 + 8);
});
const CRATE_GEO = new THREE.BoxGeometry(1.1, 1.1, 1.1);
const CRATE_MAT = new THREE.MeshStandardMaterial({ map: CRATE_TEX, roughness: 0.8, emissive: 0x3a2400, emissiveIntensity: 0.6 });
function buildCrates(g, def) {
  crates = [];
  const { N, pos, left, halfW } = track;
  for (const f of def.crates) {
    const k = Math.floor(f * N);
    for (const o of [-0.6, -0.2, 0.2, 0.6]) {
      const m = new THREE.Mesh(CRATE_GEO, CRATE_MAT); m.castShadow = true;
      const p = pos[k].clone().addScaledVector(left[k], o * halfW); m.position.set(p.x, 0.9, p.z); g.add(m);
      crates.push({ mesh: m, pos: p, respawn: 0, phase: Math.random() * 6 });
    }
  }
}
function rollItem(k) {
  if (race.mode === 'tt') return 'nitro';
  const band = k.place <= 1 ? 0 : k.place <= 3 ? 1 : k.place <= 5 ? 2 : 3;
  const odds = ITEM_ODDS[band]; let tot = 0; for (const v of Object.values(odds)) tot += v;
  let r = Math.random() * tot; for (const [id, v] of Object.entries(odds)) { if ((r -= v) < 0) return id; }
  return 'nitro';
}
function updateCrates(dt, t) {
  for (const c of crates) {
    if (c.respawn > 0) { c.respawn -= dt; c.mesh.visible = c.respawn <= 0; if (c.respawn <= 0) c.mesh.scale.setScalar(0.01); continue; }
    c.mesh.scale.setScalar(Math.min(1, c.mesh.scale.x + dt * 3));
    c.mesh.rotation.y = t * 1.6 + c.phase; c.mesh.rotation.x = 0.3; c.mesh.position.y = 0.95 + Math.sin(t * 2.5 + c.phase) * 0.15;
    for (const k of karts) {
      if ((k.pos.x - c.pos.x) ** 2 + (k.pos.z - c.pos.z) ** 2 > 1.9 ** 2) continue;
      c.respawn = 3; c.mesh.visible = false; burst(c.pos, 0xffd23f, 14);
      if (!k.item && k.roulette <= 0) { k.roulette = k.isPlayer ? 1.2 : 0.6; k.pendingItem = rollItem(k); if (k.isPlayer) sfx.crate(); }
      break;
    }
  }
  for (const k of karts) if (k.roulette > 0) { k.roulette -= dt; if (k.roulette <= 0) { k.item = k.pendingItem; k.itemCharges = race.mode === 'tt' ? k.itemCharges : 1; if (k.isPlayer) sfx.itemGot(); } }
}
function useItem(k) {
  const it = k.item; if (!it || k.roulette > 0) return;
  if (k.isPlayer && Math.random() < 0.5) voice(k.r.id, 'item');
  const f = k.fwd;
  if (it === 'nitro') { k.boost = Math.max(k.boost, 1.6); if (k.isPlayer) sfx.boost(); }
  else if (it === 'shield') { k.shield = true; k.shieldT = 14; if (k.isPlayer) sfx.shield(); }
  else if (it === 'slick') {
    const p = k.pos.clone().addScaledVector(f, -2.4);
    const m = new THREE.Mesh(new THREE.CircleGeometry(1.35, 24), SLICK_MAT); m.rotation.x = -Math.PI / 2; m.position.set(p.x, 0.03, p.z); world.add(m);
    slicks.push({ pos: p, mesh: m, life: 30, owner: k, grace: 0.6 }); if (k.isPlayer) sfx.drop();
  } else if (it === 'hubcap' || it === 'firework') {
    const p = k.pos.clone().addScaledVector(f, 2.0); p.y = 0.6;
    let target = null;
    if (it === 'firework') { const ahead = karts.filter(o => o !== k && o.prog > k.prog).sort((a, b) => a.prog - b.prog); target = ahead[0] || null; }
    const mesh = it === 'hubcap' ? new THREE.Mesh(HUBCAP_GEO, HUBCAP_MAT) : fireworkMesh();
    mesh.castShadow = true; mesh.position.copy(p); world.add(mesh);
    shots.push({ type: it, pos: p, dir: f.clone(), speed: Math.max(k.speed, 0) + (it === 'hubcap' ? 22 : 16), life: it === 'hubcap' ? 4.5 : 7, owner: k, target, mesh, sIdx: k.sIdx, grace: 0.25 });
    if (k.isPlayer) sfx.throw();
  }
  if (race.mode === 'tt' && it === 'nitro') { k.itemCharges--; if (k.itemCharges <= 0) k.item = null; }
  else k.item = null;
  updateItemHud();
}
const SLICK_MAT = new THREE.MeshStandardMaterial({ roughness: 0.25, metalness: 0.1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  map: canvasTex(256, 256, (x, w, h) => {
    const g = x.createRadialGradient(w / 2, h / 2, 10, w / 2, h / 2, w / 2); g.addColorStop(0, 'rgba(120,58,24,0.95)'); g.addColorStop(0.75, 'rgba(98,44,18,0.9)'); g.addColorStop(1, 'rgba(98,44,18,0)');
    x.fillStyle = g; x.beginPath(); x.arc(w / 2, h / 2, w / 2, 0, 7); x.fill();
    for (let i = 0; i < 70; i++) { const a = Math.random() * 7, r = Math.random() * w * 0.36; x.fillStyle = Math.random() < 0.5 ? '#c26a2c' : '#a8521f'; x.beginPath(); x.ellipse(w / 2 + Math.cos(a) * r, h / 2 + Math.sin(a) * r, 9, 6, Math.random() * 3, 0, 7); x.fill(); }
  }) });
const HUBCAP_GEO = (() => { const g = new THREE.CylinderGeometry(0.42, 0.42, 0.08, 20); return g; })();
const HUBCAP_MAT = new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 1, roughness: 0.22 });
function fireworkMesh() {
  const g = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.8, 10), new THREE.MeshStandardMaterial({ color: 0xc8261e, roughness: 0.5 })); body.rotation.x = Math.PI / 2; g.add(body);
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.3, 10), new THREE.MeshStandardMaterial({ color: 0xffd23f, roughness: 0.4 })); tip.rotation.x = -Math.PI / 2; tip.position.z = -0.55; g.add(tip);
  const fire = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffa040, toneMapped: false })); fire.position.z = 0.48; g.add(fire);
  return g;
}
function hitKart(k, by) {
  if (k.spin > 0 || k.finishedSafe) return;
  if (k.shield) { k.shield = false; burst(k.pos, 0xffd166, 16); if (k.isPlayer) sfx.shieldPop(); return; }
  k.spin = 1.1; k.speed *= 0.35; k.vy = 3.2; k.drift = 0; k.driftCharge = 0; k.boost = 0;
  burst(k.pos, 0xd9a070, 22);
  if (k.isPlayer) { sfx.hit(); shake(0.6); }
  if (by && by !== k && by.isPlayer) { sfx.hitOther(); shout(by, 1, 'hit'); }
  else if (by && k.isPlayer && by !== k) shout(by, 0.6, 'hit');
}
function updateShots(dt) {
  for (let i = slicks.length - 1; i >= 0; i--) {
    const s = slicks[i]; s.life -= dt; s.grace -= dt;
    let hit = false;
    if (s.life > 0) for (const k of karts) { if ((s.grace > 0 && k === s.owner) || k.y > 0.6) continue; if (k.pos.distanceTo(s.pos) < 1.7) { hitKart(k, s.owner); hit = true; break; } }
    if (hit || s.life <= 0) { world.remove(s.mesh); slicks.splice(i, 1); }
  }
  for (let i = shots.length - 1; i >= 0; i--) {
    const s = shots[i]; s.life -= dt; s.grace -= dt;
    if (s.type === 'firework') {
      s.sIdx = locate(s.pos, s.sIdx, 30);
      let aim;
      if (s.target && !s.target.finishedSafe && s.target.pos.distanceTo(s.pos) < 28) aim = s.target.pos.clone();
      else { const j = (s.sIdx + 12) % track.N; aim = track.pos[j].clone(); if (s.target) aim.addScaledVector(track.left[j], clamp(lateral(s.target.pos, s.target.sIdx), -track.halfW, track.halfW) * 0.6); }
      const want = aim.sub(s.pos).setY(0).normalize(); s.dir.lerp(want, 1 - Math.pow(0.0005, dt)).normalize();
      s.speed = Math.min(s.speed + 30 * dt, 44);
    }
    s.pos.addScaledVector(s.dir, s.speed * dt);
    // walls: hubcaps bounce, fireworks are steered so rarely touch
    const si = locate(s.pos, s.sIdx, 30); s.sIdx = si;
    const lat = lateral(s.pos, si), lim = track.halfW + VERGE - 0.4;
    if (Math.abs(lat) > lim) {
      const L = track.left[si]; s.pos.addScaledVector(L, -Math.sign(lat) * (Math.abs(lat) - lim));
      const d = s.dir.dot(L); s.dir.addScaledVector(L, -2 * d).normalize();
      if (s.type === 'hubcap') s.speed *= 0.92;
    }
    s.mesh.position.copy(s.pos);
    if (s.type === 'hubcap') s.mesh.rotation.y += dt * 25; else s.mesh.rotation.y = Math.atan2(-s.dir.x, -s.dir.z);
    if (s.type === 'firework' && Math.random() < 0.7) puff(s.pos, 0x9a9a9a, 1);
    let hit = null;
    for (const k of karts) { if (s.grace > 0 && k === s.owner) continue; if (k.pos.distanceTo(new THREE.Vector3(s.pos.x, 0, s.pos.z)) < 1.4) { hit = k; break; } }
    for (const c of crates) if (!hit && c.respawn <= 0 && c.pos.distanceTo(s.pos) < 1) { /* crates stop nothing */ }
    if (hit) hitKart(hit, s.owner);
    if (hit || s.life <= 0) { if (s.type === 'firework') burst(s.pos, 0xff7a2a, 30); world.remove(s.mesh); shots.splice(i, 1); }
  }
  for (const k of karts) if (k.shield) { k.shieldT -= dt; if (k.shieldT <= 0) k.shield = false; }
}

/* ---------------- particles: dust, bursts, smoke ---------------- */
const PMAX = LOW ? 500 : 1100;
const pGeo = new THREE.BufferGeometry();
const pPos = new Float32Array(PMAX * 3), pCol = new Float32Array(PMAX * 3), pSize = new Float32Array(PMAX);
const pVel = new Float32Array(PMAX * 3), pLife = new Float32Array(PMAX), pMax = new Float32Array(PMAX);
pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3)); pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3)); pGeo.setAttribute('size', new THREE.BufferAttribute(pSize, 1));
const pMat = new THREE.ShaderMaterial({
  uniforms: { map: { value: canvasTex(64, 64, (x, w) => { const g = x.createRadialGradient(32, 32, 0, 32, 32, 32); g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.5, 'rgba(255,255,255,0.45)'); g.addColorStop(1, 'rgba(255,255,255,0)'); x.fillStyle = g; x.fillRect(0, 0, w, w); }) }, scale: { value: innerHeight / 2 } },
  vertexShader: 'attribute float size; attribute vec3 color; varying vec3 vC; varying float vA; void main(){ vC = color; vA = clamp(size, 0.0, 1.0); vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = abs(size) * 260.0 / -mv.z; gl_Position = projectionMatrix * mv; }',
  fragmentShader: 'uniform sampler2D map; varying vec3 vC; varying float vA; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * 0.32); }',
  transparent: true, depthWrite: false,
});
const particles = new THREE.Points(pGeo, pMat); particles.frustumCulled = false; scene.add(particles);
let pNext = 0;
function emit(p, vel, color, size, life) {
  const i = pNext; pNext = (pNext + 1) % PMAX;
  pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = p.z;
  pVel[i * 3] = vel.x; pVel[i * 3 + 1] = vel.y; pVel[i * 3 + 2] = vel.z;
  const c = new THREE.Color(color); pCol[i * 3] = c.r; pCol[i * 3 + 1] = c.g; pCol[i * 3 + 2] = c.b;
  pSize[i] = size; pLife[i] = life; pMax[i] = life;
}
const _v = new THREE.Vector3();
function puff(p, color, n) { for (let i = 0; i < n; i++) emit(_v.set(p.x + (Math.random() - 0.5) * 0.4, p.y + Math.random() * 0.3, p.z + (Math.random() - 0.5) * 0.4), new THREE.Vector3((Math.random() - 0.5) * 1.5, 1 + Math.random(), (Math.random() - 0.5) * 1.5), color, 0.5 + Math.random() * 0.5, 0.8); }
function burst(p, color, n) { for (let i = 0; i < n; i++) { const a = Math.random() * 6.28, s = 3 + Math.random() * 5; emit(_v.set(p.x, 0.8, p.z), new THREE.Vector3(Math.cos(a) * s, 2 + Math.random() * 4, Math.sin(a) * s), color, 0.35 + Math.random() * 0.4, 0.7); } }
function updateParticles(dt) {
  for (let i = 0; i < PMAX; i++) {
    if (pLife[i] <= 0) { pSize[i] = 0; continue; }
    pLife[i] -= dt; const k = pLife[i] / pMax[i];
    pPos[i * 3] += pVel[i * 3] * dt; pPos[i * 3 + 1] += pVel[i * 3 + 1] * dt; pPos[i * 3 + 2] += pVel[i * 3 + 2] * dt;
    pVel[i * 3 + 1] -= 1.5 * dt; pVel[i * 3] *= 0.98; pVel[i * 3 + 2] *= 0.98;
    pSize[i] = Math.max(0, pSize[i] + dt * 0.45) * (k > 0 ? 1 : 0);
  }
  pGeo.attributes.position.needsUpdate = true; pGeo.attributes.size.needsUpdate = true; pGeo.attributes.color.needsUpdate = true;
}
function kartDust(k, dt) {
  const sp = Math.abs(k.speed); if (sp < 6 || k.y > 0.3) return;
  const rate = (k.offroad ? 2.2 : 1) * (k.drift ? 2 : 1) * (k.isPlayer ? 1 : 0.45) * sp / 20;
  k.dustAcc = (k.dustAcc || 0) + rate * dt * 30;
  const f = k.fwd, l = new THREE.Vector3(f.z, 0, -f.x);
  while (k.dustAcc > 1) {
    k.dustAcc--; const s = Math.random() < 0.5 ? -1 : 1;
    const p = k.pos.clone().addScaledVector(f, -1.0).addScaledVector(l, s * 0.6); p.y = 0.25;
    emit(p, new THREE.Vector3(-f.x * 2 + (Math.random() - 0.5), 0.5 + Math.random() * 0.6, -f.z * 2 + (Math.random() - 0.5)), k.offroad ? 0xc08a5a : 0xcf9a6a, 0.22 + Math.random() * 0.2, 0.9);
  }
}

/* ============================================================
   RACE FLOW
   ============================================================ */
const race = { state: 'title', mode: 'gp', diff: 'normal', track: TRACKS[0], racer: 'scrap', t: 0, clock: 0, stateT: 0, results: null, ghost: null, ghostRec: [], paused: false };
let ghostKart = null;

function setupRace() {
  // clear previous
  for (const k of karts) world.remove(k.root);
  karts.length = 0; for (const s of slicks) world.remove(s.mesh); for (const s of shots) world.remove(s.mesh); slicks = []; shots = [];
  if (showKart) { world.remove(showKart.root); showKart = null; }
  buildTrack(race.track);
  const def = race.track, { N, pos, left, tan, halfW } = track;
  // grid: rival on pole, the player 6th (Grand Prix) or alone (Time Trial)
  let field;
  if (race.mode === 'tt') field = [race.racer];
  else {
    const others = RACERS.filter(r => r.id !== race.racer && r.id !== def.rival);
    const rivals = others.filter(r => r.rival), crew = others.filter(r => !r.rival).sort(() => Math.random() - 0.5);
    const ai = [def.rival, ...rivals.map(r => r.id), ...crew.map(r => r.id)].slice(0, 7);
    field = ai.slice(0, 5).concat([race.racer], ai.slice(5));
  }
  field.forEach((id, i) => {
    const k = new Kart(R[id], id === race.racer); karts.push(k);
    const row = Math.floor(i / 2), side = i % 2 ? -1 : 1, back = 7 + row * 6.5 + (i % 2) * 3;
    const si = (N - Math.round(back / SAMPLE_STEP)) % N;
    const p = pos[si].clone().addScaledVector(left[si], side * halfW * 0.33);
    k.reset(p, Math.atan2(-tan[si].x, -tan[si].z), si);
    k.aiBase = 0.97 + Math.random() * 0.05;
    if (k.isPlayer) player = k;
  });
  if (race.mode === 'tt') { player.item = 'nitro'; player.itemCharges = 3; }
  // ghost (Time Trial): best lap for this track
  if (ghostKart) { world.remove(ghostKart.root); ghostKart = null; }
  race.ghost = race.mode === 'tt' ? store.get('fg_jr_ghost_' + def.id, null) : null;
  if (race.ghost) {
    ghostKart = { root: standInKart('#e8f4ff') };
    ghostKart.root.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.transparent = true; o.material.opacity = 0.35; o.material.depthWrite = false; o.castShadow = false; } });
    world.add(ghostKart.root); ghostKart.root.visible = false;
  }
  race.ghostRec = []; race.clock = 0; race.results = null;
  $('trackName').textContent = def.name;
  updateItemHud(); updateHud();
}

function startIntro() {
  setupRace();
  race.state = 'intro'; race.stateT = 0; showScreen(null); document.body.classList.add('racing'); $('hud').classList.add('on'); $('skipHint').classList.add('on');
  music.play(0.35);
}
function startCountdown() {
  // never start with stand-in karts on the grid: wait (on the fly-over) until every racer's model is in
  if (!karts.every(k => k.loaded)) { if (!race.waitLoad) { race.waitLoad = true; $('skipHint').textContent = 'Loading the racers…'; $('skipHint').classList.add('on'); } return; }
  if (race.waitLoad) { race.waitLoad = false; $('skipHint').textContent = 'Tap or press Space to skip'; }
  race.state = 'countdown'; race.stateT = 0; $('skipHint').classList.remove('on');
  player.rocket = 0; player.throttleSince = -1;
}
function onLap(k) {
  const lapT = race.clock - k.lapStartT; k.lapTimes.push(lapT); k.lapStartT = race.clock; k.lap++;
  if (k.isPlayer) {
    if (race.mode === 'tt') {
      const best = race.bestLap || Infinity;
      if (lapT < best) { race.bestLap = lapT; race.bestLapGhost = race.ghostRec.slice(); }
      race.ghostRec = [];
      const prevBest = progress.best[race.track.id];
      if (!prevBest || lapT < prevBest) { progress.best[race.track.id] = lapT; saveProgress(); store.set('fg_jr_ghost_' + race.track.id, race.bestLapGhost); toast('New best lap ' + fmt(lapT)); }
      else toast('Lap ' + fmt(lapT));
      race.ghost = store.get('fg_jr_ghost_' + race.track.id, null);
    }
    if (k.lap === LAPS - 1) { toast('Final lap!'); sfx.finalLap(); music.rate(1.06); }
  }
  if (k.lap >= LAPS) { k.finished = true; k.finishT = race.clock; k.finishedSafe = true; if (k.isPlayer) finishRace(); }
}
function finishRace() {
  race.state = 'finish'; race.stateT = 0; sfx.finish(); music.rate(1);
  toast(race.mode === 'tt' ? 'Finished!' : ordinal(player.place) + ' place!');
}
function computeResults() {
  // anyone still racing is placed by distance, with an estimated time
  const order = placings();
  return order.map((k, i) => {
    let t = k.finished ? k.finishT : race.clock + (LAPS * track.L - k.prog) / Math.max(10, MAX_SPEED * 0.85);
    return { k, place: i + 1, time: t, best: k.lapTimes.length ? Math.min(...k.lapTimes) : null };
  });
}
function placings() {
  return karts.slice().sort((a, b) => (a.finished && b.finished) ? a.finishT - b.finishT : a.finished ? -1 : b.finished ? 1 : b.prog - a.prog);
}
function showResults() {
  race.state = 'results'; race.stateT = 0;
  const res = race.results = computeResults();
  if (race.mode !== 'tt' && res[0] && res[0].k.isPlayer) voice(player.r.id, 'win', true);
  const tb = $('resTable'); tb.innerHTML = '';
  if (race.mode === 'tt') {
    const laps = player.lapTimes.map((t, i) => `<li><span>Lap ${i + 1}</span><b>${fmt(t)}</b></li>`).join('');
    const best = Math.min(...player.lapTimes), pb = progress.best[race.track.id];
    tb.innerHTML = `<ol class="laps">${laps}</ol><div class="tt-best">Best lap <b>${fmt(best)}</b>${pb && best <= pb + 1e-6 ? ' <i>Personal best</i>' : pb ? ` · record ${fmt(pb)}` : ''}</div>`;
    $('resTitle').textContent = 'Time Trial'; $('resSub').textContent = race.track.name;
    $('resUnlock').textContent = '';
  } else {
    res.forEach(r => {
      const row = document.createElement('div'); row.className = 'rrow' + (r.k.isPlayer ? ' me' : '');
      row.innerHTML = `<span class="rp">${r.place}</span><span class="dot" style="background:${r.k.r.color}"></span><span class="rn">${r.k.r.name}</span><span class="rt">${fmt(r.time)}</span><span class="rpt">+${POINTS[r.place - 1]}</span>`;
      tb.appendChild(row);
    });
    const p = res.find(r => r.k.isPlayer).place;
    $('resTitle').textContent = p === 1 ? 'Winner!' : ordinal(p) + ' place';
    $('resSub').textContent = race.track.name + ' · ' + DIFFS[race.diff].label;
    // unlocks: a top-3 finish opens the next track and this track's racer
    let msg = '';
    if (p <= 3) {
      const nx = TRACKS[TRACKS.indexOf(race.track) + 1];
      if (nx && !progress.tracks.includes(nx.id)) { progress.tracks.push(nx.id); msg += `Unlocked the ${nx.name}. `; }
      const ur = race.track.unlockRacer;
      if (ur && !progress.racers.includes(ur)) { progress.racers.push(ur); msg += `${R[ur].name} joins the crew!`; }
      saveProgress();
    } else msg = 'Finish in the top 3 to unlock the next track.';
    $('resUnlock').textContent = msg;
  }
  buildPodium();
  $('hud').classList.remove('on'); $('toast').classList.remove('on'); toastT = 0;
  showScreen('resultsScreen');
  music.play(0.55);
}

/* ---------------- podium ---------------- */
let podium = null;
function buildPodium() {
  if (podium) world.remove(podium);
  podium = new THREE.Group();
  const { pos, left, tan, halfW } = track;
  const k0 = 40, base = pos[k0].clone().addScaledVector(left[k0], halfW + VERGE + 14);
  podium.position.copy(base); podium.rotation.y = Math.atan2(left[k0].x, left[k0].z);
  const mat = new THREE.MeshStandardMaterial({ map: tex('by_metal', { repeat: [1, 1] }), roughness: 0.75, metalness: 0.4 });
  const res = race.mode === 'tt' ? [{ k: player }] : race.results.slice(0, 3);
  const spots = [[0, 1.6], [-2.8, 1.1], [2.8, 0.7]];
  res.forEach((r, i) => {
    const [x, h] = spots[i];
    const block = new THREE.Mesh(new THREE.BoxGeometry(2.6, h, 2.6), mat); block.position.set(x, h / 2, 0); block.castShadow = block.receiveShadow = true; podium.add(block);
    const num = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: canvasTex(128, 128, (c) => { c.fillStyle = '#ffd23f'; c.font = '900 110px "Barlow Condensed",Impact'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(String(i + 1), 64, 70); }), transparent: true }));
    num.position.set(x, h * 0.5, 1.31); podium.add(num);
    const k = r.k; k.podium = { x, h, i };
  });
  world.add(podium);
  race.podiumKarts = res.map(r => r.k);
  // park the podium karts on their blocks
  race.podiumKarts.forEach(k => {
    const { x, h } = k.podium; const wp = new THREE.Vector3(x, h, -0.2).applyMatrix4(podium.matrixWorld.clone().compose(podium.position, podium.quaternion, new THREE.Vector3(1, 1, 1)));
    k.pos.set(wp.x, 0, wp.z); k.podiumY = h; k.heading = podium.rotation.y + Math.PI; k.speed = 0; k.spin = 0; k.drift = 0; k.boost = 0;
    k.root.position.set(wp.x, h, wp.z); k.root.rotation.y = k.heading; k.tilt.rotation.set(0, 0, 0);
  });
  for (const k of karts) if (!race.podiumKarts.includes(k)) k.root.visible = false;
}

/* ============================================================
   CAMERA
   ============================================================ */
const cam = { pos: new THREE.Vector3(), look: new THREE.Vector3(), shake: 0, fov: 68 };
function shake(a) { if (!reduceMotion) cam.shake = Math.max(cam.shake, a); }
function updateCamera(dt, t) {
  let wantPos, wantLook, k = 1 - Math.pow(0.0008, dt);
  if (race.state === 'intro' && track) {
    // start fly-over: sweep along the first stretch towards the grid, high and wide, then drop in behind the player
    const u = clamp(race.stateT / 5, 0, 1), e = u * u * (3 - 2 * u);
    const N = track.N, i = Math.floor((1 - e) * N * 0.22 + N * 0.02) % N;
    const p = track.pos[i], l = track.left[i];
    const behind = player.pos.clone().addScaledVector(player.fwd, -6.5).setY(2.6);
    const fly = p.clone().addScaledVector(l, 16 * (1 - e)).setY(lerp(26, 6, e));
    wantPos = fly.lerp(behind, clamp((u - 0.75) / 0.25, 0, 1));
    wantLook = player.pos.clone().setY(1);
    k = 1 - Math.pow(0.02, dt);
  } else if (race.state === 'results' && podium) {
    const a = t * 0.25, c = podium.position;
    const a2 = Math.sin(t * 0.3) * 0.5;   // gentle sway in front of the podium rather than a full orbit
    const fwd = new THREE.Vector3(Math.sin(podium.rotation.y), 0, Math.cos(podium.rotation.y));
    wantPos = c.clone().addScaledVector(fwd, 9).applyAxisAngle(new THREE.Vector3(0, 1, 0), 0).setY(3.6);
    wantPos.sub(c).applyAxisAngle(new THREE.Vector3(0, 1, 0), a2).add(c);
    // on wide screens the results card sits on the right, so frame the podium in the left half
    const right = new THREE.Vector3().subVectors(c, wantPos).cross(new THREE.Vector3(0, 1, 0)).normalize();
    wantLook = c.clone().setY(1.6).addScaledVector(right, innerWidth > 900 ? 3.2 : 0); k = 1 - Math.pow(0.05, dt);
  } else if ((race.state === 'select' || race.state === 'title') && showKart) {
    const a = t * 0.35, c = showKart.root.position, R0 = race.state === 'select' ? 4.6 : 6;
    wantPos = new THREE.Vector3(c.x + Math.sin(a) * R0, 1.9, c.z + Math.cos(a) * R0);
    // in the select screen push the kart left of centre so the racer panel doesn't cover it
    const right = new THREE.Vector3().subVectors(c, wantPos).cross(new THREE.Vector3(0, 1, 0)).normalize();
    wantLook = c.clone().setY(0.7).addScaledVector(right, race.state === 'select' && innerWidth > 640 ? 1.5 : 0); k = 1 - Math.pow(0.05, dt);
    const fr = race.state === 'select' && selectFreeRect();
    if (fr) {   // keep the camera close (nothing can come between it and the kart) and widen/shift the view so the kart lands in the clear gap between the panels
      const W = innerWidth, H = innerHeight, r = 1.55, tv = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
      wantLook = c.clone().setY(0.7);
      const kH = (r / R0) / tv, kW = (r / R0) / (tv * W / H);   // kart half-size as a fraction of the half-screen at normal zoom
      const z = Math.min(1, (fr.h / H) * 0.78 / kH, (fr.w / W) * 0.78 / kW), fw = W * z, fh = H * z;
      camera.setViewOffset(fw, fh, fw / 2 - fr.cx, fh / 2 - fr.cy, W, H); selOffset = true;
    } else if (selOffset) { camera.clearViewOffset(); selOffset = false; }
  } else if (player) {
    if (selOffset) { camera.clearViewOffset(); selOffset = false; }   // racing uses the full, centred view
    const f = player.fwd, sp = Math.abs(player.speed);
    const yawOff = player.drift ? -player.drift * 0.28 : 0;
    const fb = f.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), yawOff);
    wantPos = player.pos.clone().addScaledVector(fb, -(6.2 + sp * 0.03)).setY(2.5 + player.y * 0.6);
    wantLook = player.pos.clone().addScaledVector(f, 3.5).setY(1.1 + player.y * 0.5);
    if (race.state === 'finish') { wantPos = player.pos.clone().addScaledVector(f, 7).setY(2.2); wantLook = player.pos.clone().setY(1); k = 1 - Math.pow(0.05, dt); }
  } else return;
  cam.pos.lerp(wantPos, k); cam.look.lerp(wantLook, k);
  camera.position.copy(cam.pos);
  if (cam.shake > 0) { cam.shake = Math.max(0, cam.shake - dt * 2); camera.position.x += (Math.random() - 0.5) * cam.shake * 0.5; camera.position.y += (Math.random() - 0.5) * cam.shake * 0.4; }
  camera.lookAt(cam.look);
  const wantFov = 68 + (player && race.state === 'race' ? clamp(Math.abs(player.speed) - 18, 0, 14) * 0.45 + (player.boost > 0 ? 6 : 0) : 0);
  cam.fov = lerp(cam.fov, wantFov, 1 - Math.pow(0.02, dt)); if (Math.abs(camera.fov - cam.fov) > 0.05) { camera.fov = cam.fov; camera.updateProjectionMatrix(); }
  // shadows follow the camera target
  if (track) {
    const c = cam.look; sun.position.copy(c).addScaledVector(track.sunDir, 120); sun.target.position.copy(c);
    if (track.sky) track.sky.position.set(camera.position.x, 150, camera.position.z);
  }
}

/* ============================================================
   AUDIO
   ============================================================ */
let muted = store.get('fg_jr_mute', false);
const music = (() => {
  const a = new Audio(); a.loop = true; a.preload = 'auto';
  a.src = BASE + 'audio/theme.' + (a.canPlayType('audio/webm; codecs="opus"') ? 'webm' : 'mp4');
  let vol = 0.5, started = false;
  return {
    play(v) { vol = v; a.volume = muted ? 0 : vol; if (!started) { started = true; } a.play().catch(() => {}); },
    rate(r) { a.playbackRate = r; },
    mute() { a.volume = muted ? 0 : vol; },
  };
})();
let actx = null, eng = null;
function audioCtx() {
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; } }
  if (actx && actx.state === 'suspended') actx.resume();
  return actx;
}
function engineStart() {
  const a = audioCtx(); if (!a || eng) return;
  const o1 = a.createOscillator(), o2 = a.createOscillator(), f = a.createBiquadFilter(), g = a.createGain();
  o1.type = 'sawtooth'; o2.type = 'square'; o2.detune.value = 7; f.type = 'lowpass'; f.frequency.value = 600; g.gain.value = 0;
  o1.connect(f); o2.connect(f); f.connect(g); g.connect(a.destination); o1.start(); o2.start();
  eng = { o1, o2, f, g };
}
function engineUpdate() {
  if (!eng || !player) return;
  const sp = Math.abs(player.speed), on = (race.state === 'race' || race.state === 'countdown' || race.state === 'finish') && !race.paused && !muted;
  const rpm = 48 + sp * 3.4 + (player.boost > 0 ? 30 : 0) + (race.state === 'countdown' && player.input.throttle ? 60 : 0);
  eng.o1.frequency.setTargetAtTime(rpm, actx.currentTime, 0.05); eng.o2.frequency.setTargetAtTime(rpm * 0.5, actx.currentTime, 0.05);
  eng.f.frequency.setTargetAtTime(380 + sp * 40, actx.currentTime, 0.08);
  eng.g.gain.setTargetAtTime(on ? 0.05 + sp * 0.0012 : 0, actx.currentTime, 0.1);
}
function tone(freq, dur, type = 'square', vol = 0.12, slide = 0) {
  const a = audioCtx(); if (!a || muted) return;
  const o = a.createOscillator(), g = a.createGain(), t = a.currentTime;
  o.type = type; o.frequency.setValueAtTime(freq, t); if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur); o.connect(g).connect(a.destination); o.start(t); o.stop(t + dur + 0.02);
}
function noise(dur, vol = 0.2, freq = 800) {
  const a = audioCtx(); if (!a || muted) return;
  const b = a.createBuffer(1, Math.floor(a.sampleRate * dur), a.sampleRate), d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
  const s = a.createBufferSource(), f = a.createBiquadFilter(), g = a.createGain(); s.buffer = b; f.type = 'bandpass'; f.frequency.value = freq; g.gain.value = vol;
  s.connect(f).connect(g).connect(a.destination); s.start();
}
const sfx = {
  beep: () => tone(520, 0.25, 'square', 0.12), go: () => tone(1040, 0.5, 'square', 0.14),
  boost: () => { noise(0.45, 0.25, 1400); tone(220, 0.4, 'sawtooth', 0.06, 400); },
  thud: () => noise(0.18, 0.35, 220), bump: () => noise(0.08, 0.18, 300),
  crate: () => { tone(880, 0.06, 'square', 0.08); setTimeout(() => tone(1320, 0.08, 'square', 0.08), 60); },
  itemGot: () => tone(1500, 0.12, 'triangle', 0.1), throw: () => noise(0.2, 0.2, 2000), drop: () => noise(0.25, 0.25, 400),
  shield: () => tone(660, 0.35, 'triangle', 0.1, 400), shieldPop: () => noise(0.25, 0.3, 1800),
  hit: () => { noise(0.4, 0.4, 260); tone(300, 0.5, 'sawtooth', 0.08, -220); }, hitOther: () => tone(900, 0.15, 'triangle', 0.1, 300),
  finalLap: () => { [660, 880, 1100].forEach((f, i) => setTimeout(() => tone(f, 0.15, 'square', 0.1), i * 120)); },
  finish: () => { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => tone(f, 0.25, 'square', 0.11), i * 130)); },
  click: () => tone(700, 0.05, 'triangle', 0.06),
};

/* ============================================================
   UI: HUD, minimap, toasts, shouts
   ============================================================ */
const fmt = t => { if (t == null || !isFinite(t)) return '--:--.--'; const m = Math.floor(t / 60), s = t - m * 60; return m + ':' + (s < 10 ? '0' : '') + s.toFixed(2); };
const ordinal = n => n + (['th', 'st', 'nd', 'rd'][(n % 100 > 10 && n % 100 < 14) ? 0 : n % 10 < 4 ? n % 10 : 0] || 'th');
let toastT = 0;
function toast(msg) { const el = $('toast'); el.textContent = msg; el.classList.add('on'); toastT = 2; }
let shoutT = 0;
/* character voices (from the voice programme): <id>_<kind>[1|2].mp3 in audio/voice/.
   Only racers listed here have lines; anyone else just shows the text shout. */
const VOICED = { cletus: 1, clyde: 1, dixie: 1, jebediah: 1 };
const VO_VARIANTS = { hit: 2, item: 2, pass: 2, start: 0, win: 0 };
let voBusyUntil = 0;
function voice(id, kind, force) {
  if (!VOICED[id] || muted) return;
  const now = perfNow(); if (!force && now < voBusyUntil) return;
  const n = VO_VARIANTS[kind] ? 1 + Math.floor(Math.random() * VO_VARIANTS[kind]) : '';
  const a = new Audio(BASE + 'audio/voice/' + id + '_' + kind + n + '.mp3'); a.volume = 0.95;
  a.play().then(() => { voBusyUntil = perfNow() + 2600; }).catch(() => {});
}
function shout(k, prob = 1, kind = 'pass') {
  if (Math.random() > prob || race.clock - (k.lastShout || -99) < 6) return; k.lastShout = race.clock;
  if (k.isPlayer || (player && k.pos.distanceTo(player.pos) < 26)) voice(k.r.id, kind);
  const el = $('shout'); el.innerHTML = `<b style="color:${k.r.color}">${k.r.name}</b>${pick(k.r.shout)}`; el.classList.add('on'); shoutT = 1.8;
  // voice shouts from the character voice programme slot in here (audio/voice/<id>-<n>.mp4)
}
function updateItemHud() {
  const box = $('itemBox'), ic = $('itemIcon');
  if (!player) return;
  if (player.roulette > 0) { box.classList.add('rolling'); return; }
  box.classList.remove('rolling');
  ic.textContent = player.item ? ITEMS[player.item].icon : '';
  box.classList.toggle('has', !!player.item);
  $('itemName').textContent = player.item ? ITEMS[player.item].name + (race.mode === 'tt' ? ' ×' + player.itemCharges : '') : '';
}
let lastRouletteIcon = 0;
function updateHud(dt = 0) {
  if (!player) return;
  $('pos').innerHTML = race.mode === 'tt' ? '' : `${player.place}<sup>${ordinal(player.place).slice(-2)}</sup>`;
  $('lap').textContent = `Lap ${Math.min(LAPS, player.lap + 1)}/${LAPS}`;
  $('time').textContent = fmt(race.state === 'race' || race.state === 'finish' ? race.clock : 0);
  if (player.roulette > 0 && perfNow() - lastRouletteIcon > 80) { lastRouletteIcon = perfNow(); const ks = Object.keys(ITEMS); $('itemIcon').textContent = ITEMS[pick(ks)].icon; }
  if (toastT > 0) { toastT -= dt; if (toastT <= 0) $('toast').classList.remove('on'); }
  if (shoutT > 0) { shoutT -= dt; if (shoutT <= 0) $('shout').classList.remove('on'); }
  drawMinimap();
}
let mmBase = null, mmScale = 1, mmOff = [0, 0];
function drawMinimapBase() {
  const c = $('minimap'); if (!c || !track) return;
  const S = c.width = c.height = Math.round(Math.min(180, innerWidth * 0.28)) * (devicePixelRatio > 1 ? 2 : 1);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const p of track.pos) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  mmScale = (S * 0.84) / Math.max(x1 - x0, z1 - z0); mmOff = [S / 2 - (x0 + x1) / 2 * mmScale, S / 2 - (z0 + z1) / 2 * mmScale];
  const off = document.createElement('canvas'); off.width = off.height = S; const x = off.getContext('2d');
  x.lineJoin = x.lineCap = 'round';
  const path = () => { x.beginPath(); track.pos.forEach((p, i) => { const X = p.x * mmScale + mmOff[0], Z = p.z * mmScale + mmOff[1]; i ? x.lineTo(X, Z) : x.moveTo(X, Z); }); x.closePath(); };
  path(); x.strokeStyle = 'rgba(0,0,0,0.55)'; x.lineWidth = S * 0.075; x.stroke();
  path(); x.strokeStyle = '#e9c79a'; x.lineWidth = S * 0.045; x.stroke();
  const s0 = track.pos[0]; x.fillStyle = '#fff'; x.fillRect(s0.x * mmScale + mmOff[0] - S * 0.03, s0.z * mmScale + mmOff[1] - 2, S * 0.06, 4);
  mmBase = off;
}
function drawMinimap() {
  const c = $('minimap'); if (!c || !mmBase) return; const x = c.getContext('2d'), S = c.width;
  x.clearRect(0, 0, S, S); x.drawImage(mmBase, 0, 0);
  for (const k of karts) {
    if (!k.root.visible) continue;
    const X = k.pos.x * mmScale + mmOff[0], Z = k.pos.z * mmScale + mmOff[1];
    x.beginPath(); x.arc(X, Z, S * (k.isPlayer ? 0.042 : 0.03), 0, 7); x.fillStyle = k.r.color; x.fill();
    x.lineWidth = k.isPlayer ? S * 0.016 : S * 0.008; x.strokeStyle = k.isPlayer ? '#fff' : 'rgba(0,0,0,0.6)'; x.stroke();
  }
}

/* ============================================================
   INPUT: keyboard, touch, gamepad
   ============================================================ */
const keys = new Set();
const ctl = { left: false, right: false, up: false, down: false, drift: false, item: false, touch: false };
addEventListener('keydown', e => {
  if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', ' '].includes(e.key)) e.preventDefault();
  keys.add(e.code);
  if ((e.code === 'Escape' || e.code === 'KeyP') && (race.state === 'race' || race.state === 'countdown')) togglePause();
  if ((race.state === 'intro') && (e.code === 'Space' || e.code === 'Enter')) startCountdown();
  firstGesture();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => { keys.clear(); if (race.state === 'race') togglePause(true); });
document.addEventListener('visibilitychange', () => { if (document.hidden && race.state === 'race') togglePause(true); });
function bindTouch(id, prop) {
  const el = $(id); if (!el) return;
  const on = e => { e.preventDefault(); ctl[prop] = true; ctl.touch = true; el.classList.add('down'); firstGesture(); };
  const off = e => { e.preventDefault(); ctl[prop] = false; el.classList.remove('down'); };
  el.addEventListener('pointerdown', on); el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('pointerleave', off);
}
bindTouch('tLeft', 'left'); bindTouch('tRight', 'right'); bindTouch('tDrift', 'drift'); bindTouch('tItem', 'item'); bindTouch('tBrake', 'down');
$('stage').addEventListener('pointerdown', () => { if (race.state === 'intro') startCountdown(); });
let gestured = false;
function firstGesture() { if (gestured) return; gestured = true; audioCtx(); engineStart(); if (race.state === 'title' || race.state === 'select') music.play(0.5); }
function readInput() {
  const gp = (navigator.getGamepads ? [...navigator.getGamepads()] : []).find(g => g && g.connected);
  let steer = 0, thr = 0, brk = 0, drift = false, item = false;
  if (keys.has('ArrowLeft') || keys.has('KeyA') || ctl.left) steer -= 1;
  if (keys.has('ArrowRight') || keys.has('KeyD') || ctl.right) steer += 1;
  if (keys.has('ArrowUp') || keys.has('KeyW')) thr = 1;
  if (keys.has('ArrowDown') || keys.has('KeyS') || ctl.down) brk = 1;
  if (keys.has('Space') || ctl.drift) drift = true;
  if (keys.has('ShiftLeft') || keys.has('ShiftRight') || keys.has('KeyE') || keys.has('KeyX') || ctl.item) item = true;
  if (ctl.touch && !brk) thr = 1;   // phones: accelerate is always on
  if (gp) {
    const ax = gp.axes[0] || 0; if (Math.abs(ax) > 0.15) steer = clamp(steer + ax, -1, 1);
    if (gp.buttons[0]?.pressed || gp.buttons[7]?.value > 0.2) thr = Math.max(thr, gp.buttons[7]?.value || 1);
    if (gp.buttons[1]?.pressed || gp.buttons[6]?.value > 0.3) brk = 1;
    if (gp.buttons[5]?.pressed || gp.buttons[4]?.pressed) drift = true;
    if (gp.buttons[2]?.pressed || gp.buttons[3]?.pressed) item = true;
    if (gp.buttons[9]?.pressed && !readInput.pp && (race.state === 'race')) togglePause();
    readInput.pp = gp.buttons[9]?.pressed;
  }
  return { steer, throttle: thr, brake: brk, drift, item };
}

/* ============================================================
   MENUS + SHOWROOM
   ============================================================ */
let showKart = null;
function showScreen(id) {
  for (const s of document.querySelectorAll('.overlay')) s.classList.toggle('on', s.id === id);
  document.body.classList.toggle('racing', !id && ['intro', 'countdown', 'race', 'finish'].includes(race.state));
  $('touch').classList.toggle('on', !id && (coarse || ctl.touch) && (race.state === 'race' || race.state === 'countdown' || race.state === 'intro'));
}
function enterShowroom(trackDef) {
  for (const k of karts) world.remove(k.root); karts.length = 0; player = null;
  if (podium) { world.remove(podium); podium = null; }
  if (!track || track.def !== trackDef) buildTrack(trackDef);
  if (showKart) world.remove(showKart.root);
  showKart = new Kart(R[race.racer], false);
  const i = 25, p = track.pos[i].clone(); showKart.reset(p, Math.atan2(-track.tan[i].x, -track.tan[i].z), i);
  $('hud').classList.remove('on'); $('touch').classList.remove('on');
}
function goTitle() {
  race.state = 'title'; race.paused = false; enterShowroom(race.track); showScreen('titleScreen'); renderTitle();
  if (gestured) music.play(0.5);
}
function renderTitle() {
  document.querySelectorAll('[data-diff]').forEach(b => b.classList.toggle('sel', b.dataset.diff === race.diff));
  $('controlsHelp').innerHTML = coarse
    ? '<b>Phone</b>: hold ◀ ▶ to steer, accelerate is automatic. Hold <b>DRIFT</b> into a corner and let go for a boost. Tap <b>ITEM</b> to use what you picked up.'
    : '<b>Steer</b> ← → or A D · <b>Accelerate</b> ↑ or W · <b>Brake</b> ↓ or S · <b>Drift</b> hold Space into a corner, let go to boost · <b>Item</b> Shift or E · <b>Pause</b> Esc';
}
function goSelect(mode) {
  race.mode = mode; race.state = 'select'; showScreen('selectScreen'); renderSelect();
}
function renderSelect() {
  $('selMode').textContent = race.mode === 'tt' ? 'Time Trial' : 'Grand Prix · ' + DIFFS[race.diff].label;
  const tp = $('trackPicker'); tp.innerHTML = '';
  TRACKS.forEach((t, i) => {
    const ok = unlockedTrack(t.id), b = document.createElement('button');
    b.className = 'tcard' + (t === race.track ? ' sel' : '') + (ok ? '' : ' locked');
    const best = progress.best[t.id];
    b.innerHTML = `<i style="background-image:url(${BASE}tex/${t.card}.jpg)"></i><b>${t.name}</b><small>${ok ? (race.mode === 'tt' && best ? 'Best lap ' + fmt(best) : 'Rival: ' + R[t.rival].name) : 'Finish top 3 on the ' + TRACKS[i - 1].name + ' to unlock'}</small>`;
    b.onclick = () => { if (!ok) return; sfx.click(); race.track = t; enterShowroom(t); renderSelect(); };
    tp.appendChild(b);
  });
  const r = R[race.racer], ok = unlockedRacer(r.id);
  $('racerName').textContent = r.name; $('racerTag').textContent = r.tag;
  $('racerLock').textContent = ok ? '' : (r.unlock ? `Finish top 3 on the ${T[r.unlock].name} to unlock` : '');
  for (const s of ['speed', 'accel', 'handling', 'weight']) $('st_' + s).style.width = clamp((r.stats[s] - 0.7) / 0.65, 0.05, 1) * 100 + '%';
  $('goBtn').disabled = !ok; $('goBtn').textContent = race.mode === 'tt' ? 'Start Time Trial' : 'Race!';
}
const PLAYABLE = RACERS.filter(r => !r.rival).map(r => r.id);
function cycleRacer(d) {
  sfx.click(); const i = PLAYABLE.indexOf(race.racer); race.racer = PLAYABLE[(i + d + PLAYABLE.length) % PLAYABLE.length];
  enterShowroom(race.track); renderSelect();
}
function togglePause(force) {
  if (race.state !== 'race' && race.state !== 'countdown') return;
  race.paused = force === true ? true : !race.paused;
  showScreen(race.paused ? 'pauseScreen' : null);
}
// wiring
// Junkyard Racers is for fun: no online leaderboard or prizes (monthly prizes are Vent Runner-style games only).
// Time Trial keeps personal bests and the best-lap ghost on the player's own device.
$('gpBtn').onclick = () => { sfx.click(); firstGesture(); goSelect('gp'); };
$('ttBtn').onclick = () => { sfx.click(); firstGesture(); goSelect('tt'); };
document.querySelectorAll('[data-diff]').forEach(b => b.onclick = () => { sfx.click(); race.diff = b.dataset.diff; store.set('fg_jr_diff', race.diff); renderTitle(); });
$('racerPrev').onclick = () => cycleRacer(-1); $('racerNext').onclick = () => cycleRacer(1);
$('goBtn').onclick = () => { if (!unlockedRacer(race.racer)) return; sfx.click(); store.set('fg_jr_racer', race.racer); startIntro(); };
$('backBtn').onclick = () => { sfx.click(); goTitle(); };
$('resumeBtn').onclick = () => togglePause();
$('restartBtn').onclick = () => { race.paused = false; startIntro(); };
$('quitBtn').onclick = () => { race.paused = false; goTitle(); };
$('againBtn').onclick = () => startIntro();
$('nextTrackBtn').onclick = () => { const nx = TRACKS[TRACKS.indexOf(race.track) + 1]; if (nx && unlockedTrack(nx.id)) { race.track = nx; startIntro(); } else goSelect(race.mode); };
$('menuBtn').onclick = () => goTitle();
$('pauseBtn').onclick = () => togglePause();
$('muteBtn').onclick = () => { muted = !muted; store.set('fg_jr_mute', muted); music.mute(); $('muteBtn').classList.toggle('off', muted); };
$('muteBtn').classList.toggle('off', muted);
race.diff = DIFFS[store.get('fg_jr_diff', 'normal')] ? store.get('fg_jr_diff', 'normal') : 'normal';
race.racer = unlockedRacer(store.get('fg_jr_racer', 'scrap')) ? store.get('fg_jr_racer', 'scrap') : 'scrap';

/* ============================================================
   MAIN LOOP
   ============================================================ */
const STEP = 1 / 120;
let last = performance.now(), acc = 0, lastFrame = 0, simT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (FPS_CAP && now - lastFrame < 1000 / FPS_CAP - 1) return;
  lastFrame = now;
  let dt = Math.min(0.1, (now - last) / 1000) * TIMESCALE; last = now;
  const t = now / 1000;
  if (!race.paused) {
    race.stateT += dt;
    if (race.state === 'intro') { if (race.stateT > 5.4 || race.waitLoad) startCountdown(); karts.forEach(k => stepVisualIdle(k, dt)); placings().forEach((k, i) => { k.place = i + 1; }); }
    else if (race.state === 'countdown') {
      const n = 3 - Math.floor(race.stateT);
      const cd = $('countdown');
      if (n !== race.lastCount) { race.lastCount = n; if (n > 0) { cd.textContent = n; cd.className = 'on n' + n; sfx.beep(); } }
      // rocket start: hold accelerate from just after "2"
      const inp = readInput(); player.input = inp;
      if (inp.throttle > 0) { if (player.throttleSince < 0) player.throttleSince = race.stateT; } else player.throttleSince = -1;
      karts.forEach(k => stepVisualIdle(k, dt)); placings().forEach((k, i) => { k.place = i + 1; });
      if (race.stateT >= 3) {
        race.state = 'race'; race.stateT = 0; race.clock = 0; cd.textContent = 'GO!'; cd.className = 'on go'; sfx.go(); voice(player.r.id, 'start', true); setTimeout(() => cd.classList.remove('on'), 700);
        if (player.throttleSince >= 1.9 && player.throttleSince <= 2.8) { player.boost = 0.9; toast('Rocket start!'); sfx.boost(); }
        karts.forEach(k => { if (!k.isPlayer && Math.random() < 0.4) k.boost = 0.5; k.lapStartT = 0; });
        showScreen(null);
      }
    } else if (race.state === 'race' || race.state === 'finish') {
      acc += dt;
      const inp = readInput();
      while (acc >= STEP) {
        acc -= STEP; simT += STEP; race.clock += STEP;
        for (const k of karts) {
          if (k.isPlayer && race.state === 'race' && !window.__jrAutopilot) {
            const used = inp.item && !k.prevItem; k.prevItem = inp.item;
            k.input = { ...inp, item: false }; if (used) useItem(k);
          } else { aiThink(k, STEP); if (k.input.item) useItem(k); }
          stepKart(k, STEP);
        }
        collideKarts();
      }
      karts.forEach(k => kartDust(k, dt));
      updateCrates(dt, t); updateShots(dt);
      placings().forEach((k, i) => { const np = i + 1; if (k.isPlayer && k.place && np < k.place && race.state === 'race' && race.clock > 3) { const passed = placings()[i + 1]; if (passed && passed.r.rival) shout(k, 0.5); } k.place = np; });
      // ghost: record this lap, play back the best lap
      if (race.mode === 'tt') {
        if (!race.ghostRec.length || race.clock - player.lapStartT >= race.ghostRec.length * 0.05) race.ghostRec.push([+player.pos.x.toFixed(2), +player.pos.z.toFixed(2), +player.heading.toFixed(3)]);
        if (ghostKart && race.ghost) {
          const gi = Math.floor((race.clock - player.lapStartT) / 0.05), s = race.ghost[Math.min(gi, race.ghost.length - 1)];
          ghostKart.root.visible = gi < race.ghost.length && race.state === 'race'; if (s) { ghostKart.root.position.set(s[0], 0, s[1]); ghostKart.root.rotation.y = s[2]; }
        }
      }
      if (race.state === 'finish') {
        const allDone = karts.every(k => k.finished) || race.stateT > 9;
        if (allDone || race.stateT > 3.5 && race.mode === 'tt') showResults();
      }
    } else if (race.state === 'results') {
      race.podiumKarts?.forEach((k, i) => {
        if (i === 0) { k.vy -= 20 * dt; k.y += k.vy * dt; if (k.y < 0) { k.y = 0; k.vy = 4.5; } }
        k.root.position.y = (k.podiumY || 0) + k.y; k.root.rotation.y = k.heading + (i === 0 ? Math.sin(t * 3) * 0.15 : 0);
      });
      if (Math.random() < 0.5 && podium) burst(podium.position.clone().add(new THREE.Vector3((Math.random() - 0.5) * 6, 3, 0)), [0xffd23f, 0xff5a3a, 0x5fd3ff, 0xffffff][Math.floor(Math.random() * 4)], 2);
    } else if (showKart) { showKart.root.rotation.y += dt * 0.0; }
  }
  updateParticles(dt);
  updateCamera(dt, t);
  engineUpdate();
  updateHud(dt);
  if (player) updateItemHud();
  composer.render();
}
function stepVisualIdle(k, dt) {
  // engines idling on the grid: a little rumble
  k.tilt.position.y = Math.abs(Math.sin(perfNow() * 0.03 + k.aiBase * 50)) * 0.012;
}

// debug / test hooks (Playwright)
window.__jr = { race, karts, get player() { return player; }, get track() { return track; }, startIntro, startCountdown, goSelect, goTitle, TRACKS, R, useItem, hitKart, showResults };

goTitle();
requestAnimationFrame(frame);
