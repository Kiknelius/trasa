// Little Duck - deterministic three.js scene. Every frame is a pure function of time t (seconds),
// so the headless renderer can render any frame in any order: window.renderFrame(t).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const W = 1080, H = 1920, FPS = 30, DURATION = 22.8;
const COL = { body: '#FFD63A', beak: '#FF8C1E', hood: '#3470DE', hoodTrim: '#FFFFFF', ink: '#14213D' };
const LYRICS = [
  'Little Duck, Little Duck, splash, splash, splash!',
  'Jumping in puddles, make a big dash!',
  'Little Duck, Little Duck, quack, quack, quack!',
  'Waddle to the pond and then waddle back!',
  'Rain goes plop, plop, plop,',
  'Hop, hop, hop, hop, hop!',
  'Little Duck, Little Duck, time for bed,',
  'Sleepy little feathers on your sleepy little head.',
];
const END_CARD = ['Goodnight,', 'Little', 'Duck!'];

// ---------------------------------------------------------------- helpers
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const easeInOut = t => { t = clamp(t); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
const easeOutBack = (t, s = 1.9) => { t = clamp(t); return 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2); };
const bump = (t, c, w) => Math.exp(-Math.pow((t - c) / w, 2));               // gaussian bump
function rng(seed) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const C = c => new THREE.Color(c);
function mix3(day, rain, night, ph) { const c = C(day); c.lerp(C(rain), ph.rainLook); c.lerp(C(night), ph.night); return c; }
const mixN = (day, rain, night, ph) => lerp(lerp(day, rain, ph.rainLook), night, ph.night);

function phases(t) {
  return {
    rain: smooth(10.45, 11.25, t) * (1 - smooth(15.3, 16.1, t)),   // rain activity (drops, clouds, ripples)
    rainLook: smooth(10.45, 11.25, t),                              // colour grading: storm hands over to night
    night: smooth(15.3, 16.4, t),
  };
}

// ---------------------------------------------------------------- timeline (from the fitted voice)
let WORDS = [];
const wt = (line, i) => WORDS.find(w => w.line === line && w.i === i).t0;
let EV = {};      // event times
let HOPS = [];    // jump schedule
let SPLASHES = []; // {t,x,z,k}
let RIPPLES = [];  // {t,x,z,a}
let PLOPS = [];    // big raindrops hitting the duck

const PUDDLE = { rx: 0.95, rz: 0.62 };
const inPuddle = (x, z) => Math.hypot(x / PUDDLE.rx, z / PUDDLE.rz) < 0.92;

function buildTimeline() {
  EV.splash = [wt(0, 4), wt(0, 5), wt(0, 6)];
  EV.puddles = wt(1, 2);
  EV.dash = wt(1, 6);
  EV.quack = [wt(2, 4), wt(2, 5), wt(2, 6)];
  EV.plop = [wt(4, 2), wt(4, 3), wt(4, 4)];
  EV.hop = [0, 1, 2, 3, 4].map(i => wt(5, i));
  EV.bed = wt(6, 4);
  const hx = [0, -0.22, 0.22, -0.22, 0.22, 0];
  HOPS = [
    { t0: 1.24, t1: 1.74, x0: -1.3, x1: -1.0, h: 0.30, k: 0 },
    { t0: EV.splash[0] - 0.36, t1: EV.splash[0], x0: -1.0, x1: -0.5, h: 0.40, k: 0.8 },
    { t0: EV.splash[1] - 0.33, t1: EV.splash[1], x0: -0.5, x1: 0.0, h: 0.36, k: 0.8 },
    { t0: EV.splash[2] - 0.33, t1: EV.splash[2], x0: 0, x1: 0, h: 0.42, k: 0.9 },
    { t0: EV.puddles - 0.42, t1: EV.puddles, x0: 0, x1: 0, h: 0.48, k: 0.95 },
    { t0: EV.dash - 0.72, t1: EV.dash, x0: 0, x1: 0, h: 0.95, k: 1.7, spin: 1 },
    ...EV.hop.map((tl, i) => ({ t0: tl - 0.32, t1: tl, x0: hx[i], x1: hx[i + 1], h: 0.36, k: 0.75 })),
  ];
  SPLASHES = HOPS.filter(h => h.k > 0).map(h => ({ t: h.t1, x: h.x1, z: 0.05, k: h.k }));
  RIPPLES = SPLASHES.map(s => ({ t: s.t, x: s.x, z: s.z, a: 0.9 * Math.min(1.3, s.k) }));
  // footsteps while waddling through the puddle
  for (let ts = 6.0; ts < 10.8; ts += 0.3) {
    const p = waddlePos(ts + 0.001);
    if (inPuddle(p.x, 0)) RIPPLES.push({ t: ts, x: p.x + (Math.round(ts / 0.3) % 2 ? 0.09 : -0.09), z: 0.08, a: 0.35 });
  }
  PLOPS = EV.plop.map(t => ({ t, fall: 0.42 }));
  RIPPLES.sort((a, b) => a.t - b.t);
}

// ---------------------------------------------------------------- duck motion
const WADDLE = [ // [time, x]  piecewise path (eased per segment)
  [6.0, 0.0], [7.12, -1.12], [8.42, -1.12], [9.6, 0.42], [9.72, 0.42], [10.74, 0.0],
];
function waddlePos(t) {
  for (let i = 0; i < WADDLE.length - 1; i++) {
    const [ta, xa] = WADDLE[i], [tb, xb] = WADDLE[i + 1];
    if (t >= ta && t <= tb) {
      const u = (t - ta) / (tb - ta);
      const moving = Math.abs(xb - xa) > 0.01;
      // constant speed with short ease in/out
      const e = moving ? clamp(u < 0.08 ? (u * u) / 0.16 : u > 0.92 ? 1 - ((1 - u) * (1 - u)) / 0.16 : u) : 0;
      return { x: lerp(xa, xb, e), moving, dir: Math.sign(xb - xa), u };
    }
  }
  return { x: 0, moving: false, dir: 0, u: 0 };
}

function hopState(t) {
  // returns {x, y, sx, sy, spin, flap} from the hop schedule
  let x = -1.3, y = 0, sq = 0, spin = 0, flap = 0, air = false;
  for (const h of HOPS) {
    if (t >= h.t1) x = h.x1;
    if (t >= h.t0 && t < h.t1) {
      const u = (t - h.t0) / (h.t1 - h.t0);
      x = lerp(h.x0, h.x1, easeInOut(u));
      y = h.h * 4 * u * (1 - u);
      air = true;
      sq += -0.12 * Math.abs(Math.cos(Math.PI * u));          // stretch while rising/falling, round at apex
      flap = Math.max(flap, Math.sin(Math.PI * u) * (h.h > 1 ? 1 : 0.7));
      if (h.spin) spin = Math.PI * 2 * easeInOut(clamp((u - 0.08) / 0.84));
    }
    // anticipation crouch
    const a = t - (h.t0 - 0.14);
    if (a >= 0 && a < 0.14) sq += 0.2 * Math.sin((a / 0.14) * Math.PI * 0.5) * (h.h > 1 ? 1.3 : 1);
    // landing squash with a damped wobble
    const l = t - h.t1;
    if (l >= 0 && l < 0.6) sq += 0.28 * Math.min(1.3, h.k + 0.3) * Math.exp(-l * 9) * Math.cos(l * 26);
  }
  return { x, y, sq, spin, flap, air };
}

function duckPose(t) {
  const ph = phases(t);
  let x = -1.3, y = 0, sq = 0, yaw = 0.25, roll = 0, spin = 0, flap = 0;
  let headPitch = 0, headYaw = 0, lid = 0, breathe = 0, sit = 0;
  const hs = hopState(t);

  if (t < 6.0) {                                   // intro + puddle hops
    x = hs.x; y = hs.y; sq = hs.sq; spin = hs.spin; flap = hs.flap;
    yaw = lerp(0.55, 0.12, smooth(3.2, 3.6, t));
    if (t < 1.2) sq += 0.06 * Math.pow(Math.max(0, Math.cos(Math.PI * 2 * t / 0.6)), 6);  // bob on the beat
    // shake off water after the big splash
    const s = t - EV.dash;
    if (s > 0.15 && s < 0.7) { roll = 0.12 * Math.sin(s * 40) * Math.exp(-(s - 0.15) * 5); flap = Math.max(flap, 0.5 * Math.exp(-(s - 0.15) * 6)); }
  } else if (t < 10.8) {                           // waddle left / quack / waddle right and back
    const p = waddlePos(t);
    x = p.x;
    const k = Math.floor((t - 6.0) / 0.3), u = ((t - 6.0) % 0.3) / 0.3;
    if (p.moving) {
      roll = 0.17 * Math.sin(Math.PI * (t - 6.0) / 0.3);
      y = 0.045 * Math.abs(Math.sin(Math.PI * (t - 6.0) / 0.3));
      sq = 0.05 * Math.pow(Math.cos(Math.PI * u), 8);
    }
    // facing: walk direction, face camera while quacking
    const targetYaw = t < 7.12 ? -0.95 : t < 8.36 ? 0.18 : t < 9.62 ? 0.95 : -0.95;
    const prevYaw = t < 7.12 ? 0.12 : t < 8.36 ? -0.95 : t < 9.62 ? 0.18 : 0.95;
    const segStart = t < 7.12 ? 6.0 : t < 8.36 ? 7.12 : t < 9.62 ? 8.36 : 9.62;
    yaw = lerp(prevYaw, targetYaw, smooth(segStart, segStart + 0.25, t));
    if (t > 10.45) yaw = lerp(yaw, 0, smooth(10.45, 10.8, t));
    for (const q of EV.quack) {                   // quack: head up, wings out, little hop of the body
      const d = t - q;
      if (d > -0.05 && d < 0.35) { headPitch -= 0.32 * Math.sin(clamp((d + 0.05) / 0.3) * Math.PI); flap = Math.max(flap, 0.6 * Math.sin(clamp((d + 0.05) / 0.3) * Math.PI)); sq -= 0.07 * Math.sin(clamp((d + 0.05) / 0.3) * Math.PI); }
    }
  } else if (t < 15.6) {                           // rain: look up at the plops, then 5 hops
    x = hs.x; y = hs.y; sq = hs.sq; flap = hs.flap;
    yaw = 0.0;
    headPitch = -0.22 * smooth(10.9, 11.25, t) * (1 - smooth(12.75, 13.0, t));
    for (const pl of PLOPS) {
      const d = t - pl.t;
      if (d > 0 && d < 0.45) { headPitch += 0.3 * Math.exp(-d * 10) * Math.sin(Math.min(1, d * 8) * Math.PI * 0.5); sq += 0.12 * Math.exp(-d * 9) * Math.cos(d * 25); lid = Math.max(lid, 0.85 * Math.exp(-d * 7)); }
    }
    roll = 0.06 * Math.sin((t - 13.2) * Math.PI / 0.45) * smooth(12.9, 13.1, t) * (1 - smooth(15.0, 15.3, t));
  } else {                                         // night: wonder, yawn, sit, sleep
    x = 0;
    yaw = 0.35 * smooth(15.8, 16.3, t) * (1 - smooth(16.9, 17.5, t));
    headPitch = -0.25 * smooth(15.8, 16.3, t) * (1 - smooth(16.6, 17.0, t));
    // yawn
    const yw = smooth(16.75, 17.05, t) * (1 - smooth(17.35, 17.7, t));
    headPitch -= 0.38 * yw; flap = 0.7 * yw; sq -= 0.08 * yw; lid = Math.max(lid, 0.95 * yw);
    // sit down
    sit = smooth(17.7, 18.3, t);
    sq += 0.1 * sit + 0.08 * bump(t, 18.15, 0.12);
    // sleepy eyes and drooping head
    const sleepy = 0.45 * smooth(17.5, 18.2, t);
    const heavy = 0.5 * (bump(t, 18.45, 0.13) + bump(t, 18.95, 0.16));
    lid = Math.max(lid, Math.min(1, sleepy + heavy + smooth(19.0, 19.45, t)));
    headPitch += 0.42 * smooth(18.9, 19.9, t);
    headYaw = 0.12 * smooth(19.0, 19.9, t);
    breathe = smooth(19.4, 20.0, t);
  }
  // regular blinks while awake (not during plops/sleep)
  if (t < 17.4) for (const b of [0.55, 4.7, 7.0, 9.0, 10.4, 14.2, 16.2]) lid = Math.max(lid, Math.exp(-Math.pow((t - b) / 0.045, 2)));

  // breathing while asleep, in time with the bar (2.4 s)
  const br = breathe * Math.sin((t - 19.4) * Math.PI * 2 / 2.4);
  return { x, y, z: 0.05, sq, yaw: yaw + spin, roll, flap, headPitch, headYaw, lid: clamp(lid), breathe: br, sit, ph };
}

// smoothed duck x for the camera (pure function of t)
function camFollowX(t) { let s = 0; for (let i = -4; i <= 4; i++) s += duckPose(t + i * 0.1).x; return s / 9; }

// ---------------------------------------------------------------- renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
document.body.appendChild(renderer.domElement);
const overlay = document.createElement('canvas');
overlay.width = W; overlay.height = H;
document.body.appendChild(overlay);
const ctx = overlay.getContext('2d');

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(31, W / H, 0.1, 200);

// sky dome
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false,
  uniforms: { uTop: { value: C('#4fb6f2') }, uHor: { value: C('#c4ecff') }, uLow: { value: C('#dff5ff') } },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: `uniform vec3 uTop, uHor, uLow; varying vec3 vDir;
    void main(){ float h = vDir.y; vec3 c = h > 0.0 ? mix(uHor, uTop, pow(smoothstep(0.0, 0.55, h), 0.8)) : mix(uHor, uLow, smoothstep(0.0,-0.2,h));
    gl_FragColor = vec4(c, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    }`,
});
skyMat.toneMapped = false;
const sky = new THREE.Mesh(new THREE.SphereGeometry(90, 32, 16), skyMat);
scene.add(sky);

// lights
const hemi = new THREE.HemisphereLight(0xffffff, 0x88aa55, 1.5);
scene.add(hemi);
const sunLight = new THREE.DirectionalLight(0xffffff, 2.2);
sunLight.position.set(-4, 8, 6);
scene.add(sunLight);
const duckSpot = new THREE.SpotLight('#fff0c8', 0, 0, 0.2, 0.9, 0);
duckSpot.position.set(1.6, 5.0, 4.0); scene.add(duckSpot); scene.add(duckSpot.target);
const rimLight = new THREE.DirectionalLight(0xffffff, 1.0);
rimLight.position.set(3, 4, -6);
scene.add(rimLight);

// ---------- canvas textures
function canvasTex(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
const glowTex = canvasTex(256, 256, (g, w) => {
  const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,0.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, w);
});
const sunTex = canvasTex(512, 512, (g, w) => {
  const c = w / 2;
  const gr = g.createRadialGradient(c, c, 0, c, c, c);
  gr.addColorStop(0, 'rgba(255,250,215,1)'); gr.addColorStop(0.34, 'rgba(255,236,140,1)'); gr.addColorStop(0.36, 'rgba(255,225,120,0.55)'); gr.addColorStop(1, 'rgba(255,220,120,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, w);
});
const raysTex = canvasTex(512, 512, (g, w) => {
  const c = w / 2; g.translate(c, c);
  for (let i = 0; i < 12; i++) {
    g.rotate(Math.PI / 6);
    const gr = g.createLinearGradient(0, 0, 0, -c);
    gr.addColorStop(0.3, 'rgba(255,230,120,0.75)'); gr.addColorStop(1, 'rgba(255,230,120,0)');
    g.fillStyle = gr; g.beginPath(); g.moveTo(-14, -60); g.lineTo(0, -c * 0.98); g.lineTo(14, -60); g.closePath(); g.fill();
  }
});
const moonTex = canvasTex(512, 512, (g, w) => {
  const c = w / 2;
  g.fillStyle = '#FFF3BF'; g.beginPath(); g.arc(c, c, c * 0.42, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'destination-out';
  g.beginPath(); g.arc(c + c * 0.24, c - c * 0.12, c * 0.38, 0, Math.PI * 2); g.fill();
  g.globalCompositeOperation = 'source-over';
});
const starTex = canvasTex(128, 128, (g, w) => {
  const c = w / 2; g.translate(c, c);
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, c); gr.addColorStop(0, 'rgba(255,255,240,1)'); gr.addColorStop(0.2, 'rgba(255,250,210,0.8)'); gr.addColorStop(1, 'rgba(255,250,210,0)');
  g.fillStyle = gr; g.beginPath();
  for (let i = 0; i < 8; i++) { const r = i % 2 ? c * 0.18 : c * 0.95; const a = i * Math.PI / 4 - Math.PI / 2; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); }
  g.closePath(); g.fill();
});
const shadowTex = canvasTex(256, 256, (g, w) => {
  const gr = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  gr.addColorStop(0, 'rgba(20,30,20,0.75)'); gr.addColorStop(0.6, 'rgba(20,30,20,0.35)'); gr.addColorStop(1, 'rgba(20,30,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, w);
});

function sprite(tex, opts = {}) {
  const m = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, blending: opts.additive ? THREE.AdditiveBlending : THREE.NormalBlending, color: opts.color || 0xffffff, fog: false });
  m.toneMapped = false;
  return new THREE.Sprite(m);
}

// sun, rays, moon, stars
const sun = sprite(sunTex); sun.position.set(-1.6, 3.55, -16); sun.scale.setScalar(2.6); scene.add(sun);
const rays = sprite(raysTex); rays.position.set(-1.6, 3.55, -16.1); rays.scale.setScalar(4.6); scene.add(rays);
const moonGlow = sprite(glowTex, { color: '#d9e4ff', additive: true }); moonGlow.scale.setScalar(3.4); scene.add(moonGlow);
const moon = sprite(moonTex); moon.scale.setScalar(2.6); scene.add(moon);
const stars = [];
{
  const r = rng(7);
  for (let i = 0; i < 70; i++) {
    const s = sprite(starTex, { additive: true });
    const x = (r() - 0.5) * 11, y = 1.6 + r() * 4.6;
    s.position.set(x, y, -18 - r() * 2);
    s.userData = { base: 0.12 + r() * 0.2, ph: r() * 6.28, sp: 1.5 + r() * 3, at: 16.0 + r() * 1.2 };
    scene.add(s); stars.push(s);
  }
}

// clouds
const cloudMat = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 1, transparent: true });
const clouds = [];
function makeCloud(seed, scale) {
  const g = new THREE.Group(); const r = rng(seed);
  const n = 6 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14), cloudMat);
    const a = (i / (n - 1) - 0.5) * 2;
    m.position.set(a * 1.7, (1 - Math.abs(a)) * 0.6 + r() * 0.3, r() * 0.4);
    m.scale.setScalar(0.75 + (1 - Math.abs(a)) * 0.55 + r() * 0.2);
    g.add(m);
  }
  g.scale.setScalar(scale);
  return g;
}
[[-4.2, 3.0, -18, 0.45, 1], [1.6, 4.3, -20, 0.55, 2], [4.6, 2.7, -19, 0.42, 3], [-1.2, 5.3, -22, 0.5, 4]].forEach(([x, y, z, s, seed]) => {
  const c = makeCloud(seed, s); c.position.set(x, y, z); c.userData = { x, y, s, rain: false }; scene.add(c); clouds.push(c);
});
const rainCloudMat = new THREE.MeshStandardMaterial({ color: '#8d99ab', roughness: 1, transparent: true, opacity: 0 });
[[-2.6, 3.9, -15, 0.75, 11], [0.6, 4.6, -16, 0.85, 12], [3.2, 3.6, -15, 0.7, 13], [-0.8, 3.0, -17, 0.8, 14]].forEach(([x, y, z, s, seed]) => {
  const c = makeCloud(seed, s); c.traverse(o => { if (o.isMesh) o.material = rainCloudMat; });
  c.position.set(x, y + 3, z); c.userData = { x, y, s, rain: true }; scene.add(c); clouds.push(c);
});

// ground, hills, trees, bushes, flowers, reeds, rocks
{
  const g = new THREE.PlaneGeometry(90, 90, 160, 160); g.rotateX(-Math.PI / 2);
  const pos = g.attributes.position, colr = [], r = rng(3), cA = C('#7ccf5c'), cB = C('#68bd4b'), tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i), d = Math.hypot(x, z);
    const hill = smooth(4, 14, d) * (0.6 * Math.sin(x * 0.35) * Math.cos(z * 0.3) + 0.4);
    pos.setY(i, hill * (z < 0 ? 1 : 0.2) - 0.02);
    tmp.copy(cA).lerp(cB, 0.5 + 0.5 * Math.sin(x * 1.3 + Math.cos(z * 1.1) * 2) * 0.6 + (r() - 0.5) * 0.25);
    colr.push(tmp.r, tmp.g, tmp.b);
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colr, 3)); g.computeVertexNormals();
  scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 })));
  const hillMat = (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 1 });
  [[-9, -0.9, -24, 12, 2.4, 7, '#86d062'], [8, -1.0, -26, 13, 2.7, 7, '#77c556'], [0, -1.6, -34, 22, 3.6, 8, '#93d86d']].forEach(([x, y, z, sx, sy, sz, c]) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 40, 20), hillMat(c)); m.position.set(x, y, z); m.scale.set(sx, sy, sz); scene.add(m);
  });
  const trunkMat = new THREE.MeshStandardMaterial({ color: '#8b5a2b', roughness: 0.9 });
  const leafMats = ['#4fae4a', '#5cc055', '#43a047'].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.85 }));
  const rt = rng(21);
  [[-3.3, -12], [-2.6, -17], [2.9, -12.5], [3.9, -17], [-5.5, -15], [1.0, -21], [-1.0, -24]].forEach(([x, z], i) => {
    const t = new THREE.Group();
    const tr = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.6, 10), trunkMat); tr.position.y = 0.8; t.add(tr);
    const lf = new THREE.Mesh(new THREE.SphereGeometry(1.05, 24, 16), leafMats[i % 3]); lf.position.y = 2.1; lf.scale.set(1, 1.1, 1); t.add(lf);
    const lf2 = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 14), leafMats[(i + 1) % 3]); lf2.position.set(0.55, 1.7, 0.3); t.add(lf2);
    t.position.set(x, 0, z); t.scale.setScalar(0.85 + rt() * 0.35); scene.add(t);
  });
  const bushMat = new THREE.MeshStandardMaterial({ color: '#57b84a', roughness: 0.9 });
  [[-1.9, -2.6], [-1.2, -3.4], [1.5, -2.8], [2.3, -3.6], [0.2, -4.6]].forEach(([x, z], i) => {
    for (let k = 0; k < 3; k++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.3 - k * 0.05, 18, 12), bushMat); m.position.set(x + (k - 1) * 0.27, 0.16, z + (k % 2) * 0.1); scene.add(m); }
  });
  const rockMat = new THREE.MeshStandardMaterial({ color: '#a7aab3', roughness: 0.8 });
  [[-1.05, -0.38, 0.12], [1.04, -0.3, 0.1], [0.8, 0.5, 0.08], [-0.72, 0.55, 0.07], [0.15, -0.72, 0.09]].forEach(([x, z, s]) => {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), rockMat); m.position.set(x, 0.02, z); m.scale.set(s * 1.4, s * 0.7, s); scene.add(m);
  });
}
// flowers (sway with time)
const flowers = [];
{
  const r = rng(99);
  const stemMat = new THREE.MeshStandardMaterial({ color: '#3f9b3a', roughness: 0.9 });
  const petalCols = ['#ff7eb6', '#ffffff', '#b388ff', '#ff8a65', '#ffd1e8'].map(c => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
  const centerMat = new THREE.MeshStandardMaterial({ color: '#ffcf33', roughness: 0.6 });
  let placed = 0, tries = 0;
  while (placed < 34 && tries < 2000) {
    tries++;
    const x = (r() - 0.5) * 4.4, z = -2.8 + r() * 4.4;
    if (Math.hypot(x / (PUDDLE.rx + 0.3), z / (PUDDLE.rz + 0.25)) < 1.0) continue;      // keep the puddle clear
    if (Math.abs(z) < 0.45 && x > -1.6 && x < 0.8) continue;                             // keep the duck's path clear
    const f = new THREE.Group(); const h = 0.16 + r() * 0.16;
    const st = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.016, h, 6), stemMat); st.position.y = h / 2; f.add(st);
    const head = new THREE.Group(); head.position.y = h;
    const pm = petalCols[Math.floor(r() * petalCols.length)];
    for (let k = 0; k < 5; k++) { const p = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), pm); const a = k * Math.PI * 2 / 5; p.position.set(Math.cos(a) * 0.055, 0, Math.sin(a) * 0.055); p.scale.set(1, 0.45, 1); head.add(p); }
    const cm = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), centerMat); cm.position.y = 0.012; head.add(cm);
    head.rotation.x = 0.5; f.add(head);
    f.position.set(x, 0, z); f.userData = { ph: r() * 6.28 }; scene.add(f); flowers.push(f); placed++;
  }
}
// reeds / cattails at the back of the puddle
{
  const reedMat = new THREE.MeshStandardMaterial({ color: '#4c9a3f', roughness: 0.9 });
  const tailMat = new THREE.MeshStandardMaterial({ color: '#7a4a24', roughness: 0.8 });
  const r = rng(5);
  [[-0.78, -0.72], [-0.58, -0.8], [0.68, -0.74], [0.88, -0.62], [0.78, -0.86]].forEach(([x, z]) => {
    const h = 0.45 + r() * 0.25; const g = new THREE.Group();
    const s = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, h, 6), reedMat); s.position.y = h / 2; g.add(s);
    const tl = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.12, 4, 8), tailMat); tl.position.y = h - 0.02; g.add(tl);
    g.position.set(x, 0, z); g.rotation.z = (r() - 0.5) * 0.25; g.userData = { ph: r() * 6.28 }; scene.add(g); flowers.push(g);
  });
}

// puddle with analytic ripples (impacts + procedural rain rings)
const MAXR = 24;
const waterMat = new THREE.ShaderMaterial({
  transparent: false,
  uniforms: {
    uTime: { value: 0 }, uRain: { value: 0 }, uNight: { value: 0 },
    uDeep: { value: C('#3d9be0') }, uShallow: { value: C('#7fcaf5') }, uSky: { value: C('#c9eeff') }, uRim: { value: C('#e9f8ff') },
    uRip: { value: Array.from({ length: MAXR }, () => new THREE.Vector4(0, 0, -99, 0)) },
    uSun: { value: 1 },
  },
  vertexShader: `varying vec2 vXZ; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vXZ = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: `
    uniform float uTime, uRain, uNight, uSun; uniform vec3 uDeep, uShallow, uSky, uRim; uniform vec4 uRip[${MAXR}];
    varying vec2 vXZ;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    void main(){
      vec2 p = vXZ;
      float ang = atan(p.y, p.x);
      float rb = 1.0 + 0.06*sin(3.0*ang+1.3) + 0.04*sin(5.0*ang+0.4) + 0.025*sin(9.0*ang+2.0);
      float d = length(p / vec2(${PUDDLE.rx.toFixed(2)}, ${PUDDLE.rz.toFixed(2)})) / rb;
      if (d > 1.0) discard;
      float h = 0.0;
      for (int i = 0; i < ${MAXR}; i++) {
        vec4 r = uRip[i]; float age = uTime - r.z;
        if (age < 0.0 || age > 2.4) continue;
        float dist = length((p - r.xy) * vec2(1.0, 1.25));
        float fade = exp(-age * 1.5) / (1.0 + dist * 1.2);
        float f1 = 0.10 + age * 0.85;
        h += r.w * fade * exp(-pow((dist - f1) / 0.045, 2.0));
        float f2 = age * 0.85 - 0.16;
        if (f2 > 0.0) h += 0.6 * r.w * fade * exp(-pow((dist - f2) / 0.035, 2.0));
        float f3 = age * 0.85 - 0.32;
        if (f3 > 0.0) h += 0.35 * r.w * fade * exp(-pow((dist - f3) / 0.03, 2.0));
      }
      if (uRain > 0.01) {
        vec2 g = p * 2.6; vec2 id = floor(g);
        for (int j = -1; j <= 1; j++) for (int k = -1; k <= 1; k++) {
          vec2 cid = id + vec2(float(j), float(k));
          float rnd = hash(cid);
          vec2 c = (cid + vec2(hash(cid + 3.1), hash(cid + 7.7))) / 2.6;
          float per = 0.7 + rnd * 0.6;
          float cyc = uTime / per + rnd;
          float age = fract(cyc) * per;
          float on = step(hash(cid + floor(cyc) * 1.37), 0.8);
          float dist = length((p - c) * vec2(1.0, 1.25));
          float fr = age * 0.5;
          h += on * uRain * 0.75 * exp(-pow((dist - fr) / 0.022, 2.0)) * exp(-age * 2.8);
        }
      }
      float edge = smoothstep(0.55, 1.0, d);
      vec3 col = mix(uDeep, uShallow, edge * 0.8);
      col = mix(col, uSky, 0.28 + 0.22 * (1.0 - d));
      // soft sky/moon reflection highlight
      float hl = exp(-pow(length((p - vec2(-0.35, -0.35)) * vec2(1.0, 2.2)) / 0.35, 2.0));
      col += hl * mix(vec3(0.25), vec3(0.45, 0.45, 0.35), uNight) * (0.6 + 0.4 * uSun);
      col += vec3(1.0) * clamp(h, 0.0, 1.2) * 0.5;
      col = mix(col, uRim, smoothstep(0.88, 1.0, d) * 0.75);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const water = new THREE.Mesh(new THREE.PlaneGeometry(PUDDLE.rx * 2.6, PUDDLE.rz * 2.6), waterMat);
water.rotation.x = -Math.PI / 2; water.position.y = 0.006; scene.add(water);

// blob shadow
const blob = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.5 }));
blob.rotation.x = -Math.PI / 2; blob.position.y = 0.012; scene.add(blob);

// splash droplets + crowns
const dropMat = new THREE.MeshStandardMaterial({ color: '#aee3ff', roughness: 0.1, metalness: 0.0, transparent: true, opacity: 0.9, emissive: '#3a8fd0', emissiveIntensity: 0.25 });
const MAXD = 420;
const drops = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 10, 8), dropMat, MAXD);
drops.frustumCulled = false; scene.add(drops);
const crownMat = new THREE.MeshStandardMaterial({ color: '#d6f1ff', roughness: 0.1, transparent: true, opacity: 0.32, side: THREE.DoubleSide, emissive: '#5aa9e0', emissiveIntensity: 0.25, depthWrite: false });
const crowns = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 0.8, 1, 28, 1, true), crownMat, 24);
crowns.frustumCulled = false; scene.add(crowns);

// big raindrops ("plop") falling on the duck
const bigDropGeo = (() => { const g = new THREE.SphereGeometry(0.07, 18, 14); const p = g.attributes.position; for (let i = 0; i < p.count; i++) { const y = p.getY(i); if (y > 0) { const k = y / 0.07; p.setX(i, p.getX(i) * (1 - k * 0.85)); p.setZ(i, p.getZ(i) * (1 - k * 0.85)); p.setY(i, y * 2.2); } } g.computeVertexNormals(); return g; })();
const bigDrops = PLOPS_MESHES();
function PLOPS_MESHES() { const a = []; for (let i = 0; i < 3; i++) { const m = new THREE.Mesh(bigDropGeo, dropMat); m.visible = false; scene.add(m); a.push(m); } return a; }

// rain streaks
const MAXRAIN = 900;
const rainMat = new THREE.MeshBasicMaterial({ color: '#dcecff', transparent: true, opacity: 0.55, depthWrite: false });
const rain = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.006, 0.006, 0.34, 4), rainMat, MAXRAIN);
rain.frustumCulled = false; scene.add(rain);
const RAINP = (() => { const r = rng(42); return Array.from({ length: MAXRAIN }, () => [(r() - 0.5) * 5, r() * 8, -8 + r() * 10, r()]); })();

// fireflies
const fireflies = [];
{ const r = rng(77); for (let i = 0; i < 14; i++) { const s = sprite(glowTex, { color: '#e9ff8a', additive: true }); s.userData = { x: (r() - 0.5) * 3.2, y: 0.3 + r() * 1.5, z: -2.6 + r() * 2.8, ph: r() * 6.28, sp: 0.4 + r() * 0.6 }; scene.add(s); fireflies.push(s); } }

// butterflies (daytime)
const butterflies = [];
{
  const wingMat = (c) => new THREE.MeshStandardMaterial({ color: c, side: THREE.DoubleSide, roughness: 0.6 });
  [['#ff7eb6', 0], ['#b388ff', 2.1]].forEach(([c, ph]) => {
    const b = new THREE.Group();
    const wg = new THREE.CircleGeometry(0.09, 16); wg.scale(1, 1.35, 1); wg.translate(0.085, 0, 0);
    const l = new THREE.Mesh(wg, wingMat(c)), r = new THREE.Mesh(wg, wingMat(c));
    const lp = new THREE.Group(), rp = new THREE.Group(); lp.add(l); rp.add(r); r.rotation.y = Math.PI;
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.014, 0.08, 4, 8), new THREE.MeshStandardMaterial({ color: '#4a3a5a' }));
    body.rotation.x = Math.PI / 2;
    b.add(lp, rp, body); b.userData = { lp, rp, ph }; scene.add(b); butterflies.push(b);
  });
}

// ---------------------------------------------------------------- the duck
const duck = new THREE.Group();          // world placement, yaw/roll, squash (pivot = feet)
duck.rotation.order = 'YXZ';
scene.add(duck);
const head = new THREE.Group();          // follows the head rotation of the vertex shader
head.rotation.order = 'YXZ';
duck.add(head);
const duckUniforms = { uHeadPitch: { value: 0 }, uHeadYaw: { value: 0 }, uFlap: { value: 0 }, uNeck: { value: new THREE.Vector3() } };
let eyeRig = [];

function patchDuckMaterial(mat, extra = null) {
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, duckUniforms, extra ? extra.uniforms : {});
    sh.vertexShader = `uniform float uHeadPitch; uniform float uHeadYaw; uniform float uFlap; uniform vec3 uNeck;
      ${extra ? extra.vary : ''}
      vec3 duckDeform(vec3 v, float hw){
        vec3 q = v - uNeck;
        float a = uHeadPitch * hw; float ca = cos(a), sa = sin(a);
        q = vec3(q.x, q.y*ca - q.z*sa, q.y*sa + q.z*ca);
        float b = uHeadYaw * hw; float cb = cos(b), sb = sin(b);
        q = vec3(q.x*cb + q.z*sb, q.y, -q.x*sb + q.z*cb);
        return q + uNeck;
      }
    ` + sh.vertexShader;
    sh.vertexShader = sh.vertexShader.replace('#include <beginnormal_vertex>', `
      vec3 objectNormal = vec3( normal );
      #ifdef USE_TANGENT
        vec3 objectTangent = vec3( tangent.xyz );
      #endif
      { float hwN = smoothstep(uNeck.y - 0.06, uNeck.y + 0.10, position.y);
        objectNormal = duckDeform(objectNormal + uNeck, hwN) - duckDeform(uNeck, hwN); }
    `).replace('#include <begin_vertex>', `
      vec3 transformed = vec3( position );
      ${extra ? extra.vtx : ''}
      float hw = smoothstep(uNeck.y - 0.06, uNeck.y + 0.10, transformed.y);
      float ww = smoothstep(0.20, 0.27, abs(transformed.x)) * smoothstep(0.60, 0.42, transformed.y) * smoothstep(0.10, 0.22, transformed.y);
      transformed.x += sign(transformed.x) * uFlap * 0.11 * ww;
      transformed.y += uFlap * 0.07 * ww * smoothstep(0.2, 0.34, abs(transformed.x));
      transformed = duckDeform(transformed, hw);
    `);
    if (extra) {
      sh.fragmentShader = extra.frag + '\n' + sh.fragmentShader;
      sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', '#include <color_fragment>\n' + extra.color);
    }
  };
  mat.customProgramCacheKey = () => 'duck-deform' + (extra ? '-hood' : '');
}

async function buildDuck() {
  const gltf = await new GLTFLoader().loadAsync('../assets/baby_duck.glb');
  gltf.scene.updateMatrixWorld(true);
  // Bake the file's node transforms, then: feet to y=0, face +Z (towards camera), height = 1.0
  const RAW_H = 0.3575 + 0.2074, S = 1.0 / RAW_H;
  const M = new THREE.Matrix4().makeScale(S, S, S)
    .multiply(new THREE.Matrix4().makeTranslation(0, 0.2074, 0))
    .multiply(new THREE.Matrix4().makeRotationY(Math.PI / 2));
  const toModel = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix4(M);
  const dirModel = (x, y, z) => new THREE.Vector3(x, y, z).applyMatrix3(new THREE.Matrix3().setFromMatrix4(M)).normalize();

  const bodyMat = new THREE.MeshStandardMaterial({ color: COL.body, roughness: 0.5, metalness: 0 });
  patchDuckMaterial(bodyMat);
  let orangeMat, bodyGeo;
  gltf.scene.traverse(o => {
    if (!o.isMesh) return;
    const g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld); g.applyMatrix4(M); g.computeBoundingSphere();
    let mat;
    if (o.material.name === 'yellow') {
      mat = bodyMat; bodyGeo = g;            // painted dot eyes are replaced by 3D eyes below
    } else {
      // recolor the beak/feet texture to #FF8C1E, keeping its shading (luminance ratio)
      const img = o.material.map.image; const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const cx = c.getContext('2d'); cx.drawImage(img, 0, 0); const id = cx.getImageData(0, 0, c.width, c.height); const d = id.data;
      const base = 0.3 * 236 + 0.59 * 99 + 0.11 * 26, tgt = C(COL.beak); const tr = 255, tg = 140, tb = 30;
      for (let i = 0; i < d.length; i += 4) { const k = Math.min(1.25, (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / base); d[i] = Math.min(255, tr * k); d[i + 1] = Math.min(255, tg * k); d[i + 2] = Math.min(255, tb * k); }
      cx.putImageData(id, 0, 0);
      const tex = new THREE.CanvasTexture(c); tex.flipY = false; tex.colorSpace = THREE.SRGBColorSpace;
      orangeMat = mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0 });
      patchDuckMaterial(mat);
    }
    const m = new THREE.Mesh(g, mat); duck.add(m);
  });

  // pivots measured on the raw model (see README): neck, head centre, painted eye spots + normals
  const neck = toModel(0.0, 0.125, 0); duckUniforms.uNeck.value.copy(neck); head.position.copy(neck);
  const eyeSpots = [[[-0.1469, 0.2800, -0.0439], [-0.852, 0.401, -0.331]], [[-0.1466, 0.2783, 0.0469], [-0.844, 0.404, 0.350]]];
  const eyeWhite = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.25 });
  const pupilMat = new THREE.MeshStandardMaterial({ color: '#16110f', roughness: 0.2 });
  const shineMat = new THREE.MeshBasicMaterial({ color: '#ffffff' });
  const lidMat = new THREE.MeshStandardMaterial({ color: COL.body, roughness: 0.5 });
  const lashMat = new THREE.MeshBasicMaterial({ color: '#4a3110' });
  const RE = 0.056;
  eyeSpots.forEach(([p, n]) => {
    const pos = toModel(...p).sub(neck), nrm = dirModel(...n);
    const look = nrm.clone().multiplyScalar(0.45).add(new THREE.Vector3(0, -0.05, 0.6)).normalize();
    const z = look, y = new THREE.Vector3(0, 1, 0).sub(z.clone().multiplyScalar(z.y)).normalize(), x = new THREE.Vector3().crossVectors(y, z);
    const frame = new THREE.Group(); frame.matrixAutoUpdate = false;
    frame.matrix.makeBasis(x, y, z).setPosition(pos.clone().sub(nrm.clone().multiplyScalar(0.018)));
    head.add(frame);
    const white = new THREE.Mesh(new THREE.SphereGeometry(RE, 28, 20), eyeWhite); frame.add(white);
    const pupil = new THREE.Mesh(new THREE.SphereGeometry(RE * 0.6, 24, 16), pupilMat); pupil.position.z = RE * 0.42; frame.add(pupil);
    const shine = new THREE.Mesh(new THREE.SphereGeometry(RE * 0.17, 12, 8), shineMat); shine.position.set(RE * 0.2 * Math.sign(x.x || 1), RE * 0.28, RE * 0.94); frame.add(shine);
    const shine2 = new THREE.Mesh(new THREE.SphereGeometry(RE * 0.08, 10, 6), shineMat); shine2.position.set(-RE * 0.16, -RE * 0.2, RE * 0.98); frame.add(shine2);
    const LR = RE * 1.2;
    const capGeo = new THREE.SphereGeometry(LR, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);
    const upper = new THREE.Group(); upper.add(new THREE.Mesh(capGeo, lidMat)); frame.add(upper);
    const lower = new THREE.Group(); const lm = new THREE.Mesh(capGeo, lidMat); lm.rotation.x = Math.PI; lower.add(lm); frame.add(lower);
    const lash = new THREE.Mesh(new THREE.TorusGeometry(LR, RE * 0.08, 8, 40, Math.PI), lashMat);
    lash.rotation.x = Math.PI / 2; lash.rotation.z = Math.PI; upper.add(lash);
    eyeRig.push({ upper, lower, lash, pupil, shine, shine2 });
  });

  // blue rain hood, built from the duck's own head triangles pushed out along their normals,
  // so it hugs the head like fabric and bends with the same neck/head deformation shader.
  // The face opening and the neck edge are cut per pixel (smooth edges) with a painted white piping band.
  const hc = toModel(-0.0178, 0.2447, 0), face = new THREE.Vector3(0, 0.3, 1).normalize();
  const OPEN = Math.cos(55 * Math.PI / 180), HEM = neck.y + 0.075;
  const P = bodyGeo.attributes.position, N = bodyGeo.attributes.normal, IDX = bodyGeo.index;
  const keepV = (i) => { const v = new THREE.Vector3().fromBufferAttribute(P, i); return v.y > HEM - 0.04 && v.sub(hc).normalize().dot(face) < OPEN + 0.12; };
  const flag = new Uint8Array(P.count); for (let i = 0; i < P.count; i++) flag[i] = keepV(i) ? 1 : 0;
  const OFF = 0.024, remap = new Map(), hp = [], hi = [];
  const vid = (i) => { if (!remap.has(i)) { remap.set(i, hp.length / 3); const v = new THREE.Vector3().fromBufferAttribute(P, i), n = new THREE.Vector3().fromBufferAttribute(N, i).normalize(); v.addScaledVector(n, OFF); hp.push(v.x, v.y, v.z); } return remap.get(i); };
  for (let f = 0; f < IDX.count; f += 3) {
    const a = IDX.getX(f), b = IDX.getX(f + 1), c = IDX.getX(f + 2);
    if (flag[a] && flag[b] && flag[c]) hi.push(vid(a), vid(b), vid(c));
  }
  const hoodGeo = new THREE.BufferGeometry(); hoodGeo.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3)); hoodGeo.setIndex(hi); hoodGeo.computeVertexNormals();
  const hoodMat = new THREE.MeshStandardMaterial({ color: COL.hood, roughness: 0.3, metalness: 0.0, side: THREE.DoubleSide });
  patchDuckMaterial(hoodMat, {
    vary: 'varying vec3 vHood;', vtx: 'vHood = position;',
    frag: `uniform vec3 uHC; uniform vec3 uFace; uniform float uOpen; uniform float uHem; uniform vec3 uTrim; varying vec3 vHood;`,
    color: `{ float hd = dot(normalize(vHood - uHC), uFace);
              if (hd > uOpen || vHood.y < uHem) discard;
              float band = max(smoothstep(uOpen - 0.075, uOpen - 0.062, hd), 1.0 - smoothstep(uHem + 0.016, uHem + 0.022, vHood.y));
              diffuseColor.rgb = mix(diffuseColor.rgb, uTrim, band); }`,
    uniforms: { uHC: { value: hc }, uFace: { value: face }, uOpen: { value: OPEN }, uHem: { value: HEM }, uTrim: { value: C(COL.hoodTrim) } },
  });
  duck.add(new THREE.Mesh(hoodGeo, hoodMat));
  const HR = hc.y + 0.235 - neck.y;
  duck.userData.headTop = neck.clone().add(new THREE.Vector3(0, HR + 0.02, 0));
}

function setEyes(lid, lookX = 0) {
  for (const e of eyeRig) {
    const up = lerp(-1.05, 0.0, lid);
    const lo = lerp(1.05, 0.0, smooth(0.45, 1.0, lid));
    e.upper.rotation.x = up; e.lower.rotation.x = lo;
    e.lash.visible = lid > 0.82;
    e.shine.visible = e.shine2.visible = lid < 0.75;
    e.pupil.position.x = lookX * 0.012;
  }
}

// ---------------------------------------------------------------- frame update
const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpV = new THREE.Vector3(), tmpS = new THREE.Vector3();
function update(t) {
  const ph = phases(t), day = 1 - Math.max(ph.rain, ph.night);
  // sky + lights
  skyMat.uniforms.uTop.value.copy(mix3('#45aef0', '#6d88a5', '#0b1a4a', ph));
  skyMat.uniforms.uHor.value.copy(mix3('#bfeaff', '#b4c3d2', '#2f4f93', ph));
  skyMat.uniforms.uLow.value.copy(mix3('#dff5ff', '#c8d3dc', '#3a5aa0', ph));
  hemi.color.copy(mix3('#e6f6ff', '#c9d4df', '#6b80c8', ph));
  hemi.groundColor.copy(mix3('#7aa34a', '#6a8052', '#1b2547', ph));
  hemi.intensity = mixN(1.6, 1.35, 0.5, ph);
  duckSpot.intensity = 3.0 * ph.night; duckSpot.target.position.set(0, 0.5, 0);
  sunLight.color.copy(mix3('#fff0cf', '#e8eef5', '#b8c8ff', ph));
  sunLight.intensity = mixN(2.3, 1.0, 0.45, ph);
  sunLight.position.copy(new THREE.Vector3(-4, 8, 6).lerp(new THREE.Vector3(5, 8, 5), ph.night));
  rimLight.color.copy(mix3('#ffffff', '#e0e8f0', '#9db8ff', ph));
  rimLight.intensity = mixN(1.0, 0.8, 1.6, ph);

  // sun / rays / moon / stars / clouds
  const sunVis = 1 - smooth(10.45, 11.0, t);
  sun.material.opacity = sunVis; rays.material.opacity = sunVis * 0.8; rays.material.rotation = t * 0.25;
  sun.scale.setScalar(4.2 * (1 + 0.03 * Math.sin(t * 2.6)));
  const mr = smooth(15.8, 17.0, t);
  moon.position.set(1.5, lerp(1.6, 3.5, easeInOut(mr)), -16); moonGlow.position.copy(moon.position).add(tmpV.set(-0.08, 0.03, -0.1));
  moon.material.opacity = mr; moonGlow.material.opacity = 0.55 * mr;
  for (const s of stars) {
    const u = s.userData; const a = smooth(u.at, u.at + 0.6, t);
    s.material.opacity = a * (0.65 + 0.35 * Math.sin(t * u.sp + u.ph));
    s.scale.setScalar(u.base * (0.85 + 0.25 * Math.sin(t * u.sp * 1.3 + u.ph)) * (a > 0 ? 1 : 0.001));
  }
  for (const c of clouds) {
    const u = c.userData;
    if (u.rain) { const a = smooth(10.3, 11.1, t) * (1 - smooth(15.4, 16.2, t)); c.position.set(u.x + Math.sin(t * 0.2 + u.x) * 0.2, lerp(u.y + 2.5, u.y, easeInOut(a)), c.position.z); c.visible = a > 0.001; }
    else { c.position.x = u.x + t * 0.05; c.position.y = u.y + Math.sin(t * 0.5 + u.x) * 0.04; }
  }
  cloudMat.color.copy(mix3('#ffffff', '#c3cbd6', '#5a6a9c', ph)); cloudMat.opacity = 1 - ph.night * 0.75;
  rainCloudMat.opacity = Math.min(1, smooth(10.3, 11.0, t) * (1 - smooth(15.4, 16.2, t)) * 1.2);

  // flowers + reeds sway, butterflies, fireflies
  for (const f of flowers) f.rotation.z = 0.06 * Math.sin(t * 1.7 + f.userData.ph) + (ph.rain * 0.05 * Math.sin(t * 7 + f.userData.ph));
  butterflies.forEach((b, i) => {
    const u = b.userData; const vis = 1 - smooth(9.8, 10.6, t);
    b.visible = vis > 0.01;
    const a = t * 0.55 + u.ph;
    b.position.set(Math.sin(a) * 1.1 + (i ? 0.35 : -0.35), 1.0 + 0.3 * Math.sin(a * 2.3) + (1 - vis) * 3, -1.2 + Math.cos(a * 0.8) * 0.6);
    b.rotation.y = -a + Math.PI / 2;
    const fl = Math.sin(t * 40 + u.ph) * 1.0; u.lp.rotation.y = fl; u.rp.rotation.y = -fl;
  });
  fireflies.forEach(f => {
    const u = f.userData; const a = ph.night * smooth(16.8, 17.8, t);
    f.position.set(u.x + Math.sin(t * u.sp + u.ph) * 0.5, u.y + Math.sin(t * u.sp * 1.4 + u.ph) * 0.25, u.z + Math.cos(t * u.sp + u.ph) * 0.3);
    f.material.opacity = a * (0.4 + 0.6 * Math.pow(0.5 + 0.5 * Math.sin(t * 3 + u.ph * 3), 2));
    f.scale.setScalar(0.22);
  });

  // water
  waterMat.uniforms.uTime.value = t; waterMat.uniforms.uRain.value = ph.rain; waterMat.uniforms.uNight.value = ph.night; waterMat.uniforms.uSun.value = sunVis;
  waterMat.uniforms.uDeep.value.copy(mix3('#2f8fd8', '#4a7aa5', '#1a2c5e', ph));
  waterMat.uniforms.uShallow.value.copy(mix3('#7cc9f5', '#86a9c6', '#2c4a88', ph));
  waterMat.uniforms.uSky.value.copy(mix3('#c9eeff', '#b8c7d4', '#3f5aa0', ph));
  waterMat.uniforms.uRim.value.copy(mix3('#eafaff', '#d5e1ea', '#6d85c4', ph));
  const active = RIPPLES.filter(r => t >= r.t && t - r.t < 2.4).slice(-MAXR);
  waterMat.uniforms.uRip.value.forEach((v, i) => { const r = active[i]; if (r) v.set(r.x, r.z, r.t, r.a); else v.set(0, 0, -99, 0); });

  // duck
  const p = duckPose(t);
  const sitDrop = 0.05 * p.sit;
  duck.position.set(p.x, p.y - sitDrop, p.z);
  duck.rotation.set(0, p.yaw, p.roll);
  const sy = (1 - p.sq) * (1 + 0.025 * p.breathe), sxz = 1 + p.sq * 0.55 - 0.01 * p.breathe;
  duck.scale.set(sxz, sy, sxz);
  duckUniforms.uHeadPitch.value = p.headPitch; duckUniforms.uHeadYaw.value = p.headYaw; duckUniforms.uFlap.value = p.flap;
  head.rotation.set(p.headPitch, p.headYaw, 0);
  setEyes(p.lid, 0);
  const hsc = 1 / (1 + p.y * 1.1);
  blob.position.set(p.x, 0.012, p.z + 0.02); blob.scale.set(0.95 * hsc * sxz, 0.62 * hsc * sxz, 1); blob.material.opacity = 0.42 * hsc * (1 - 0.4 * ph.night);

  duck.updateMatrixWorld(true);
  const headTopW = duck.userData.headTop.clone().applyMatrix4(duck.matrixWorld);

  // splash droplets & crowns (deterministic ballistic particles)
  let n = 0, nc = 0;
  const allSplashes = SPLASHES.concat(PLOPS.map(pl => ({ t: pl.t, x: 0, z: 0.05, k: 0.45, head: true })));
  allSplashes.forEach((s, si) => {
    const dt = t - s.t;
    if (dt < 0 || dt > 1.2) return;
    const r = rng(1000 + si * 77);
    const count = s.head ? 14 : Math.round(16 + 14 * s.k);
    const origin = s.head ? headTopW : new THREE.Vector3(s.x, 0.04, s.z);
    for (let i = 0; i < count && n < MAXD; i++) {
      const a = r() * Math.PI * 2, sp = (0.7 + r() * 1.0) * (s.head ? 0.8 : Math.sqrt(s.k)), vy = (1.4 + r() * 1.7) * (s.head ? 0.7 : Math.sqrt(s.k)), sz = 0.022 + r() * 0.028;
      const x = origin.x + Math.cos(a) * sp * dt, z = origin.z + Math.sin(a) * sp * dt * 0.8, y = origin.y + vy * dt - 4.9 * dt * dt;
      if (y < 0.0 || dt > 0.95) continue;
      tmpM.compose(tmpV.set(x, y, z), tmpQ.identity(), tmpS.setScalar(sz * (1 - dt * 0.6)));
      drops.setMatrixAt(n++, tmpM);
    }
    if (!s.head && dt < 0.38 && nc < 24) {
      const u = dt / 0.38;
      tmpM.compose(tmpV.set(s.x, 0.0, s.z), tmpQ.identity(), tmpS.set(0.14 + u * 0.42 * s.k, Math.max(0.001, 0.13 * s.k * Math.sin(Math.PI * u)), (0.14 + u * 0.42 * s.k) * 0.75));
      tmpM.multiply(new THREE.Matrix4().makeTranslation(0, 0.5, 0));
      crowns.setMatrixAt(nc++, tmpM);
    }
  });
  drops.count = n; drops.instanceMatrix.needsUpdate = true;
  crowns.count = nc; crowns.instanceMatrix.needsUpdate = true;

  // big falling raindrops (plop!)
  PLOPS.forEach((pl, i) => {
    const m = bigDrops[i]; const d = pl.t - t;
    m.visible = d > 0 && d < pl.fall;
    if (m.visible) { const u = 1 - d / pl.fall; m.position.set(headTopW.x, headTopW.y + 4.2 * (1 - u * u), headTopW.z); m.scale.setScalar(1.6); }
  });

  // rain streaks
  const rc = Math.floor(MAXRAIN * smooth(10.6, 11.4, t) * (1 - smooth(15.3, 16.0, t)));
  for (let i = 0; i < rc; i++) {
    const [x, y0, z, ph2] = RAINP[i];
    const y = 8 - ((y0 + t * 9.5 + ph2 * 3) % 8);
    tmpM.compose(tmpV.set(x + (8 - y) * 0.06, y, z), tmpQ.setFromAxisAngle(tmpV.clone().set(0, 0, 1), 0.06), tmpS.set(1, 1, 1));
    rain.setMatrixAt(i, tmpM);
  }
  rain.count = rc; rain.instanceMatrix.needsUpdate = true;

  // camera
  const fx = camFollowX(t);
  const push = easeInOut(clamp(t / 1.2));
  const nightPush = easeInOut(smooth(17.0, 22.8, t));
  const camZ = lerp(6.5, 5.6, push) - 1.0 * nightPush;
  const camY = lerp(1.3, 1.16, push) - 0.1 * nightPush;
  const bigJump = bump(t, EV.dash - 0.36, 0.22);
  camera.position.set(fx * 0.72, camY, camZ);
  camera.lookAt(fx * 0.8, lerp(0.51, 0.44, nightPush) + 0.42 * bigJump, 0);
  camera.updateMatrixWorld(); camera.updateProjectionMatrix();
  return p;
}

// ---------------------------------------------------------------- 2D overlay
const FONT = 'Poppins';
function strokeFill(g, text, x, y, fill, stroke, sw) {
  g.lineJoin = 'round'; g.miterLimit = 2;
  if (sw > 0) { g.strokeStyle = stroke; g.lineWidth = sw; g.strokeText(text, x, y); }
  g.fillStyle = fill; g.fillText(text, x, y);
}
function roundRect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }

function project(v) { const p = v.clone().project(camera); return { x: (p.x * 0.5 + 0.5) * W, y: (-p.y * 0.5 + 0.5) * H }; }

function drawTitle(g, t) {
  if (t > 1.45) return;
  const text = 'Little Duck';
  const alpha = 1 - smooth(1.08, 1.4, t);
  g.save(); g.globalAlpha = alpha;
  g.font = `800 150px ${FONT}`; g.textBaseline = 'alphabetic';
  const widths = [...text].map(ch => g.measureText(ch).width); const total = widths.reduce((a, b) => a + b, 0);
  let x = W / 2 - total / 2; const y0 = 400;
  [...text].forEach((ch, i) => {
    const ti = 0.05 + i * 0.045; const u = clamp((t - ti) / 0.32);
    const s = easeOutBack(u, 2.4) * (1 + 0.05 * Math.sin(t * 9 + i)); const dy = -14 * Math.sin(t * 6 + i * 0.7);
    if (u > 0) {
      g.save(); g.translate(x + widths[i] / 2, y0 + dy); g.scale(s, s);
      g.shadowColor = 'rgba(10,20,60,0.45)'; g.shadowOffsetY = 10; g.shadowBlur = 0;
      strokeFill(g, ch, -widths[i] / 2, 0, COL.body, '#1d3f9a', 26);
      g.shadowColor = 'transparent';
      strokeFill(g, ch, -widths[i] / 2, 0, COL.body, '#ffffff', 0);
      g.restore();
    }
    x += widths[i];
  });
  // small sub-line
  g.font = `700 54px ${FONT}`; g.textAlign = 'center';
  const su = clamp((t - 0.5) / 0.3);
  if (su > 0) { g.globalAlpha = alpha * su; strokeFill(g, 'a nursery rhyme', W / 2, 490, '#ffffff', '#1d3f9a', 12); }
  g.restore();
}

function wrapTokens(g, tokens, maxW) {
  const space = g.measureText(' ').width; const lines = [[]]; let w = 0;
  tokens.forEach((tk, i) => {
    const tw = g.measureText(tk).width;
    if (lines[lines.length - 1].length && w + space + tw > maxW) { lines.push([]); w = 0; }
    const ln = lines[lines.length - 1]; w += (ln.length ? space : 0) + tw; ln.push({ tk, i, tw });
  });
  return { lines, space };
}

function drawCaptions(g, t) {
  if (t < 1.2 || t >= 20.4) return;
  const L = Math.min(7, Math.floor((t - 1.2) / 2.4));
  const tokens = LYRICS[L].split(' ');
  const ws = WORDS.filter(w => w.line === L);
  const slotT = t - (1.2 + L * 2.4);
  let active = -1;
  ws.forEach((w, i) => { const next = ws[i + 1] ? ws[i + 1].t0 : w.t1 + 0.25; if (t >= w.t0 - 0.03 && t < Math.max(next - 0.03, w.t1)) active = i; });
  const FS = 66, LH = 88, MAXW = 940;
  g.save();
  g.font = `700 ${FS}px ${FONT}`; g.textBaseline = 'middle'; g.textAlign = 'left';
  const { lines, space } = wrapTokens(g, tokens, MAXW);
  const blockH = lines.length * LH;
  const bottom = 1600;                        // bottom 15% (y > 1632) stays clear
  const top = bottom - blockH;
  const pop = easeOutBack(clamp(slotT / 0.18), 2.0);
  const cx = W / 2, cy = top + blockH / 2;
  g.translate(cx, cy); g.scale(0.9 + 0.1 * pop, 0.9 + 0.1 * pop); g.translate(-cx, -cy);
  g.globalAlpha = clamp(slotT / 0.1);
  const maxLineW = Math.max(...lines.map(l => l.reduce((a, b) => a + b.tw, 0) + space * (l.length - 1)));
  g.fillStyle = 'rgba(16,26,64,0.38)'; roundRect(g, cx - maxLineW / 2 - 34, top - 14, maxLineW + 68, blockH + 28, 34); g.fill();
  lines.forEach((ln, li) => {
    const lw = ln.reduce((a, b) => a + b.tw, 0) + space * (ln.length - 1);
    let x = cx - lw / 2; const y = top + LH * li + LH / 2;
    ln.forEach(({ tk, i, tw }) => {
      const isA = i === active;
      const sung = i < active || (active === -1 && ws[i] && t > ws[i].t1);
      g.save();
      if (isA) {
        const w = ws[i]; const k = 1 + 0.09 * Math.exp(-Math.max(0, t - w.t0) * 7);
        g.translate(x + tw / 2, y - 6); g.scale(k, k); g.translate(-(x + tw / 2), -(y - 6));
        strokeFill(g, tk, x, y - 6, COL.body, COL.ink, 13);
      } else {
        strokeFill(g, tk, x, y, sung ? '#ffffff' : 'rgba(255,255,255,0.92)', COL.ink, 13);
      }
      g.restore();
      x += tw + space;
    });
  });
  g.restore();
}

function drawBubble(g, t, anchor) {
  const t0 = EV.quack[0] - 0.1, t1 = EV.quack[2] + 0.42;
  if (t < t0 || t > t1 + 0.2) return;
  const sIn = easeOutBack(clamp((t - t0) / 0.22), 2.2), sOut = 1 - smooth(t1, t1 + 0.18, t);
  let pulse = 1; for (const q of EV.quack) { const d = t - q; if (d >= 0) pulse += 0.14 * Math.exp(-d * 9); }
  const s = sIn * sOut * pulse; if (s <= 0.01) return;
  const bx = anchor.x + 200, by = anchor.y - 300;
  g.save(); g.translate(bx, by); g.scale(s, s);
  g.font = `800 98px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  const tw = g.measureText('Quack!').width; const bw = tw + 90, bh = 160;
  g.fillStyle = '#ffffff'; g.strokeStyle = COL.ink; g.lineWidth = 9;
  roundRect(g, -bw / 2, -bh / 2, bw, bh, 70); g.fill(); g.stroke();
  // tail pointing at the duck's beak
  g.beginPath(); g.moveTo(-bw * 0.28, bh / 2 - 6); g.lineTo(-bw * 0.42 - 30, bh / 2 + 70); g.lineTo(-bw * 0.08, bh / 2 - 6); g.closePath();
  g.fill(); g.stroke(); g.fillRect(-bw * 0.28 + 2, bh / 2 - 14, bw * 0.2, 14);
  strokeFill(g, 'Quack!', 0, 6, COL.beak, COL.ink, 12);
  g.restore();
}

function drawZs(g, t, anchor) {
  if (t < 19.25) return;
  g.save(); g.textAlign = 'center'; g.textBaseline = 'middle';
  for (let k = 0; k < 6; k++) {
    const born = 19.25 + k * 0.75, age = t - born; if (age < 0 || age > 2.4) continue;
    const u = age / 2.4;
    const x = anchor.x + 90 + 190 * u + 20 * Math.sin(age * 3 + k);
    const y = anchor.y - 60 - 230 * u;
    const size = 56 + 66 * u;
    g.globalAlpha = smooth(0, 0.15, u) * (1 - smooth(0.7, 1, u));
    g.font = `800 ${size}px ${FONT}`;
    g.save(); g.translate(x, y); g.rotate(-0.18 + 0.1 * Math.sin(age * 2 + k));
    strokeFill(g, 'Z', 0, 0, '#eaf1ff', '#2b3f7a', 10);
    g.restore();
  }
  g.restore();
}

function drawEndCard(g, t) {
  if (t < 20.3) return;
  const ws = WORDS.filter(w => w.line === 8);
  g.save(); g.textAlign = 'center'; g.textBaseline = 'middle';
  const rows = [[END_CARD[0]], [END_CARD[1], END_CARD[2]]];
  let wi = 0;
  rows.forEach((row, ri) => {
    const u = clamp((t - 20.3 - ri * 0.2) / 0.4);
    const s = easeOutBack(u, 1.8); if (u <= 0) { wi += row.length; return; }
    g.font = `800 ${ri === 0 ? 124 : 132}px ${FONT}`;
    const y = 330 + ri * 150;
    const space = g.measureText(' ').width;
    const widths = row.map(w => g.measureText(w).width); const total = widths.reduce((a, b) => a + b, 0) + space * (row.length - 1);
    let x = W / 2 - total / 2;
    g.save(); g.translate(W / 2, y); g.scale(s, s); g.translate(-W / 2, -y);
    row.forEach((wd, k) => {
      const w = ws[wi]; const lit = w && t >= w.t0 - 0.03;
      const pop = w && lit ? 1 + 0.12 * Math.exp(-(t - w.t0) * 6) : 1;
      g.save(); g.translate(x + widths[k] / 2, y); g.scale(pop, pop);
      g.shadowColor = lit ? 'rgba(255,214,58,0.65)' : 'rgba(180,200,255,0.5)'; g.shadowBlur = 34;
      strokeFill(g, wd, 0, 0, lit ? COL.body : '#ffffff', COL.ink, 18);
      g.restore();
      x += widths[k] + space; wi++;
    });
    g.restore();
  });
  g.restore();
}

function drawOverlay(t) {
  ctx.clearRect(0, 0, W, H);
  duck.updateMatrixWorld(true);
  const headW = head.getWorldPosition(new THREE.Vector3()).add(new THREE.Vector3(0, 0.25, 0));
  const anchor = project(headW);
  drawTitle(ctx, t);
  drawCaptions(ctx, t);
  drawBubble(ctx, t, anchor);
  drawZs(ctx, t, anchor);
  drawEndCard(ctx, t);
  const dim = 0.32 * smooth(22.25, 22.8, t);
  if (dim > 0) { ctx.fillStyle = `rgba(5,10,30,${dim})`; ctx.fillRect(0, 0, W, H); }
}

// ---------------------------------------------------------------- API for the headless renderer
async function init() {
  WORDS = await (await fetch('../build/words.json')).json();
  buildTimeline();
  await buildDuck();
  await document.fonts.load(`700 76px ${FONT}`); await document.fonts.load(`800 150px ${FONT}`);
  renderer.compile(scene, camera);
}
window.renderFrame = (t) => { update(t); renderer.render(scene, camera); drawOverlay(t); return true; };
window.META = { W, H, FPS, DURATION };
window.ready = init().then(() => {
  const q = new URLSearchParams(location.search);
  if (q.has('t')) window.renderFrame(parseFloat(q.get('t')));
  return true;
});
