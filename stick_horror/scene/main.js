// "Never Count the People in the Mirror" - stick-man horror Short.
// Canvas 2D, deterministic: window.renderFrame(t) draws the frame for time t (s).
// All story beats are cued from the narration word timings in build/timeline.json.
const W = 1080, H = 1920, FPS = 30;
const RED = '#ff2a2a';

// ------------------------------------------------------------ helpers
const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const easeInOut = t => { t = clamp(t); return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; };
const easeOut = t => 1 - Math.pow(1 - clamp(t), 3);
const noise = t => (Math.sin(t * 1.0) * 0.5 + Math.sin(t * 2.31 + 1.3) * 0.3 + Math.sin(t * 5.17 + 0.7) * 0.2);
function rng(seed) { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }
const dir = a => [Math.sin(a), Math.cos(a)];          // 0 = straight down, +PI/2 = towards +x

// ------------------------------------------------------------ canvases
const cv = document.getElementById('c'), g = cv.getContext('2d');
const mk = (w = W, h = H) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
const scn = mk(), S = scn.getContext('2d');      // the set, lit
const lit = mk(), L = lit.getContext('2d');      // light map (multiplied)
const tmp = mk(), T = tmp.getContext('2d');
const grain = [];
{ const r = rng(5); for (let k = 0; k < 4; k++) { const c = mk(540, 960), x = c.getContext('2d'); const id = x.createImageData(540, 960); for (let i = 0; i < id.data.length; i += 4) { const v = 128 + (r() - 0.5) * 255; id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255; } x.putImageData(id, 0, 0); grain.push(c); } }

// ------------------------------------------------------------ timeline + cues
let TL, DUR, CUE = {};
const line = i => TL.lines[i];
const clean = s => s.toLowerCase().replace(/[^a-z']/g, '');
const wordT = (i, txt) => { const w = line(i).words.find(w => clean(w.word) === txt); if (!w) throw new Error(`no word ${txt} in line ${i}`); return w.t0; };
function buildCues() {
  CUE.powerOut = wordT(2, 'out') + 0.1;
  CUE.match = line(3).t0 + 0.42;
  CUE.candleOn = CUE.match + 0.3;
  CUE.one = line(4).t0;
  CUE.flick0 = line(6).t0;
  CUE.fig2 = line(7).t0 - 0.1;
  CUE.turn = wordT(8, 'around') - 0.05;
  CUE.cut1 = CUE.turn + 0.3;
  CUE.door = line(9).t0 + 0.15;
  CUE.turnBack = wordT(10, 'looked');
  CUE.cut2 = wordT(10, 'back') + 0.05;
  CUE.fig3 = line(11).t0 - 0.1;
  CUE.closer0 = line(12).t0; CUE.closer1 = line(12).t1 + 0.5;
  CUE.raise = wordT(13, 'raised');
  CUE.smile = line(16).t0 - 0.05;
  CUE.out = wordT(17, 'out') + 0.18;
  CUE.lightBack = wordT(18, 'back') + 0.02;
  CUE.knocks = [line(18).t1 + 0.04, line(19).t1 + 0.06, line(19).t1 + 0.3, line(19).t1 + 0.54];   // in the pauses
  CUE.face = line(20).t0;
  CUE.pickup = line(21).t0 + 0.05;
  CUE.turn2 = line(22).t0 + 0.05;
  CUE.final = line(23).t0;
  CUE.end = DUR - 0.5;
  CUE.finalHit = CUE.final + 0.5;                  // whisper first, then the hit
  CUE.counts = [[CUE.one, '1'], [line(7).t0, '2'], [line(11).t0, '3'], [CUE.final, '1']];
  CUE.stings = [CUE.fig2, CUE.fig3, CUE.smile, CUE.lightBack, CUE.finalHit];
  window.CUE = CUE;
}

// ------------------------------------------------------------ lighting levels
function bulbLevel(t) {
  if (t < CUE.powerOut - 1.0) return 0.95 + 0.05 * noise(t * 9);
  if (t < CUE.powerOut) { const u = t - (CUE.powerOut - 1.0); return (Math.sin(u * 47) * Math.sin(u * 19 + 1) > -0.1 ? 0.9 : 0.12) * (1 - u * 0.4); }
  return 0;
}
function candleLevel(t) {
  if (t < CUE.match) return 0;
  if (t < CUE.candleOn) return 1.5 * Math.exp(-(t - CUE.match) * 4) + 0.3;          // match flare
  if (t >= CUE.out && t < CUE.lightBack) return 0;
  let v = 0.9 + 0.06 * noise(t * 7.3) + 0.04 * noise(t * 17.1);
  if (t > CUE.flick0 && t < CUE.fig2 + 0.05) v *= Math.sin(t * 29) * Math.sin(t * 11 + 2) > 0 ? 1 : 0.35;
  if (t > CUE.fig2 - 0.22 && t < CUE.fig2) v = 0.03;
  if (t > CUE.fig3 - 0.3 && t < CUE.fig3) v = 0.03;
  if (t > CUE.out - 0.35 && t < CUE.out) v *= Math.sin(t * 60) > 0 ? 1 : 0.4;          // dying flame
  if (t >= CUE.lightBack) { const u = t - CUE.lightBack; v *= u < 0.3 ? (Math.sin(u * 70) > 0 ? 1 : 0.2) : 1; }
  if (t >= CUE.final) v *= 0.75 + 0.25 * Math.sin((t - CUE.final) * 40);
  return v * (1 - smooth(CUE.end - 0.3, CUE.end, t));
}

// ------------------------------------------------------------ stick figure
// P: x,y (feet), h (height px), sx (horizontal scale: 1 back view / -1 front view), lean, tilt (head),
//    arms [[a1,a2] screen-left, [a1,a2] screen-right], legs [[a1,a2],[a1,a2]], lw, armLen, legLen,
//    smile 0..1.5, eyes 0..1, palms, finger, color, jitter
function stick(c, P) {
  const h = P.h, lw = (P.lw || 0.03) * h, al = P.armLen || 1, ll = P.legLen || 1;
  const base = c.getTransform();
  c.save();
  c.translate(P.x, P.y); c.rotate(P.lean || 0); c.scale(P.sx ?? 1, 1);
  const local = c.getTransform();
  c.strokeStyle = c.fillStyle = P.color || '#060606';
  c.lineWidth = lw; c.lineCap = 'round'; c.lineJoin = 'round';
  const hip = [0, -0.47 * h], neck = [Math.sin(P.bend || 0) * 0.33 * h, -0.8 * h - (P.breath || 0)];
  const sh = [neck[0], neck[1] + 0.025 * h];
  const seg = (a, len) => [a[0] + dir(len[0])[0] * len[1], a[1] + dir(len[0])[1] * len[1]];
  const J = P.jitter || 0, jr = (k) => J * Math.sin(P.t * 37 + k * 3.1) * Math.sin(P.t * 13 + k);
  const limbs = [];
  for (const [i, leg] of (P.legs || [[-0.12, -0.04], [0.12, 0.04]]).entries()) { const k = seg(hip, [leg[0], 0.245 * h * ll]); const f = seg(k, [leg[1], 0.245 * h * ll]); limbs.push([hip, k, f]); }
  const hands = [];
  for (const [i, arm] of (P.arms || [[-0.15, -0.05], [0.15, 0.05]]).entries()) { const e = seg(sh, [arm[0] + jr(i), 0.18 * h * al]); const hd = seg(e, [arm[1] + jr(i + 2), 0.17 * h * al]); limbs.push([sh, e, hd]); hands.push(hd); }
  c.beginPath(); c.moveTo(hip[0], hip[1]); c.lineTo(neck[0], neck[1]);
  for (const [a, b, d] of limbs) { c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.lineTo(d[0], d[1]); }
  c.stroke();
  if (P.palms) for (const hd of hands) { c.beginPath(); c.arc(hd[0], hd[1], 0.032 * h * P.palms, 0, Math.PI * 2); c.fill(); }
  if (P.finger) { const hd = hands[0]; c.lineWidth = lw * 0.7; c.beginPath(); c.moveTo(hd[0], hd[1]); c.lineTo(hd[0] - 0.01 * h, hd[1] - 0.06 * h * P.finger); c.stroke(); }
  // head
  const r = (P.headR || 0.085) * h;
  c.translate(neck[0], neck[1]); c.rotate(P.tilt || 0);
  c.beginPath(); c.arc(0, -r * 1.12, r, 0, Math.PI * 2); c.fill();
  if ((P.smile || 0) > 0.01 && (P.sx ?? 1) < 0) {           // face only visible from the front
    const sp = 0.25 + 0.75 * clamp(P.smile, 0, 1.6);
    c.strokeStyle = '#f4f1ea'; c.lineWidth = r * 0.1;
    c.beginPath(); c.arc(0, -r * 1.12 + r * 0.05, r * 0.6, Math.PI / 2 - sp, Math.PI / 2 + sp); c.stroke();
    if (P.smile > 0.9) { c.lineWidth = r * 0.05; for (let k = -3; k <= 3; k++) { const a = Math.PI / 2 + k * sp / 4; c.beginPath(); c.moveTo(Math.cos(a) * r * 0.52, -r * 1.07 + Math.sin(a) * r * 0.52); c.lineTo(Math.cos(a) * r * 0.68, -r * 1.07 + Math.sin(a) * r * 0.68); c.stroke(); } }
  }
  if ((P.eyes || 0) > 0.01 && (P.sx ?? 1) < 0) {
    c.fillStyle = '#f4f1ea';
    for (const s of [-1, 1]) { c.beginPath(); c.ellipse(s * r * 0.33, -r * 1.12 - r * 0.22, r * 0.11 * P.eyes, r * 0.13 * P.eyes, 0, 0, Math.PI * 2); c.fill(); }
  }
  c.restore();
  // world positions of the hands (for the candle)
  const toWorld = base.inverse().multiply(local);
  return { hands: hands.map(([x, y]) => { const q = toWorld.transformPoint(new DOMPoint(x, y)); return [q.x, q.y]; }) };
}

// ------------------------------------------------------------ the sets (world coords = 1080x1920 at zoom 1)
const M = { x0: 380, x1: 780, y0: 360, y1: 1450, frame: 30 };            // mirror
M.cx = (M.x0 + M.x1) / 2; M.r = (M.x1 - M.x0) / 2;
function mirrorPath(c, inset = 0) {
  const x0 = M.x0 + inset, x1 = M.x1 - inset, y1 = M.y1 - inset, r = M.r - inset, cy = M.y0 + M.r;
  c.beginPath(); c.moveTo(x0, y1); c.lineTo(x0, cy); c.arc(M.cx, cy, r, Math.PI, 0); c.lineTo(x1, y1); c.closePath();
}
const MAN = { x: 285, y: 1880, h: 830 };          // the man in front of the mirror (back view)
const REF = { x: 515, y: 1415, h: 600 };          // his reflection inside the glass
const CANDLE_H = 0.085;

function wall(c) {
  c.fillStyle = '#5a4c40'; c.fillRect(-300, -300, W + 600, 1460 + 300);
  for (let x = -300; x < W + 300; x += 64) { c.fillStyle = (Math.floor(x / 64) % 2) ? '#544739' : '#5e5042'; c.fillRect(x, -300, 32, 1470); }
  c.fillStyle = 'rgba(40,30,22,0.35)';
  for (let y = 60; y < 1150; y += 120) for (let x = -280; x < W + 300; x += 128) { c.beginPath(); c.ellipse(x + ((y / 120) % 2) * 64, y, 9, 14, 0, 0, Math.PI * 2); c.fill(); }
  c.fillStyle = '#3f3228'; c.fillRect(-300, 1150, W + 600, 310);
  c.strokeStyle = '#2c231c'; c.lineWidth = 6; for (let x = -260; x < W + 300; x += 260) c.strokeRect(x, 1190, 220, 220);
  c.fillStyle = '#2a211a'; c.fillRect(-300, 1440, W + 600, 30);
  c.fillStyle = '#3a2d23'; c.fillRect(-300, 1470, W + 600, 900);
  c.strokeStyle = '#2b2119'; c.lineWidth = 5;
  for (let k = -12; k <= 12; k++) { c.beginPath(); c.moveTo(540 + k * 60, 1470); c.lineTo(540 + k * 260, 2300); c.stroke(); }
}
function portrait(c, t) {
  c.fillStyle = '#5c4426'; c.fillRect(80, 470, 200, 250);
  c.fillStyle = '#a89a7e'; c.fillRect(100, 490, 160, 210);
  stick(c, { t, x: 180, y: 690, h: 175, color: '#3b2f22', lw: 0.035, arms: [[-0.4, 0.3], [0.4, -0.3]] });
  c.fillStyle = '#3b2f22'; c.beginPath(); c.arc(180, 507, 11, 0, Math.PI * 2); c.fill();      // grandma's bun
}
function bulb(c, lvl) {
  c.strokeStyle = '#1b1612'; c.lineWidth = 5; c.beginPath(); c.moveTo(560, -300); c.lineTo(560, 150); c.stroke();
  c.fillStyle = lvl > 0.05 ? '#fff6d8' : '#6b665c'; c.beginPath(); c.ellipse(560, 185, 30, 38, 0, 0, Math.PI * 2); c.fill();
  c.fillStyle = '#2a241e'; c.fillRect(546, 138, 28, 22);
}
function candleAt(c, x, y, s = 1) {          // candle stick (in the lit pass); flame drawn later
  c.fillStyle = '#e9e1cf'; c.fillRect(x - 11 * s, y - 70 * s, 22 * s, 70 * s);
  c.fillStyle = '#2b2520'; c.fillRect(x - 24 * s, y - 4 * s, 48 * s, 10 * s);
  return [x, y - 78 * s];
}
function flame(c, x, y, lvl, s = 1, t = 0) {
  if (lvl <= 0.02) return;
  const k = clamp(lvl, 0, 1.4), wob = Math.sin(t * 13) * 3 * s;
  const gr = c.createRadialGradient(x, y, 0, x, y, 120 * s * k);
  gr.addColorStop(0, `rgba(255,220,150,${0.55 * k})`); gr.addColorStop(1, 'rgba(255,140,60,0)');
  c.fillStyle = gr; c.beginPath(); c.arc(x, y, 120 * s * k, 0, Math.PI * 2); c.fill();
  c.fillStyle = `rgba(255,236,190,${clamp(k)})`;
  c.beginPath(); c.moveTo(x + wob, y - 34 * s * k); c.quadraticCurveTo(x + 13 * s, y - 2 * s, x, y + 8 * s); c.quadraticCurveTo(x - 13 * s, y - 2 * s, x + wob, y - 34 * s * k); c.fill();
  c.fillStyle = `rgba(255,170,70,${0.8 * clamp(k)})`; c.beginPath(); c.ellipse(x, y + 2 * s, 5 * s, 8 * s, 0, 0, Math.PI * 2); c.fill();
}

// ------------------------------------------------------------ characters' animation
function manPose(t, front = false) {
  const fear = smooth(CUE.fig2, CUE.smile, t);
  const P = { t, x: MAN.x, y: MAN.y, h: MAN.h, sx: front ? -1 : 1, breath: 6 * Math.sin(t * 2.2), jitter: 0.03 * fear, lean: 0.01 * noise(t) };
  const hold = t >= CUE.candleOn - 0.25;
  let left = [-0.12, -0.05], right = hold ? [0.35, 2.3] : [0.15, 0.05];
  if (t > CUE.powerOut && t < CUE.match) right = [0.5, 1.0];
  for (const [tc] of CUE.counts.slice(0, 3)) { const u = smooth(tc - 0.25, tc, t) * (1 - smooth(tc + 0.7, tc + 1.1, t)); left = [lerp(left[0], 1.55, u), lerp(left[1], 1.8, u)]; }
  const up = smooth(CUE.raise - 0.05, CUE.raise + 0.45, t);
  left = [lerp(left[0], -2.85, up), lerp(left[1], -3.05, up)];
  P.arms = [left, right];
  // turning around (start in the mirror set, finish in the hall) and back again
  if (!front) {
    const a = smooth(CUE.turn, CUE.cut1, t), b = smooth(CUE.cut2, CUE.cut2 + 0.25, t);
    if (t < CUE.cut2) P.sx = lerp(1, 0.15, a); else P.sx = lerp(0.15, 1, b);
  } else {
    P.sx = t < CUE.turnBack ? -1 : lerp(-1, -0.15, smooth(CUE.turnBack, CUE.cut2, t));
  }
  P.raiseAmt = up; P.hold = hold;
  return P;
}
function reflectionPose(t, man) {
  const P = { ...man, x: REF.x, y: REF.y, h: REF.h, sx: -man.sx, breath: man.breath * 0.7 };
  // stops copying the man once he raises his hand
  const stop = smooth(CUE.raise - 0.1, CUE.raise + 0.1, t);
  P.arms = [[lerp(man.arms[0][0], -0.1, stop), lerp(man.arms[0][1], -0.04, stop)], man.arms[1]];
  P.smile = smooth(CUE.smile, CUE.smile + 0.5, t) * 1.0;
  P.tilt = 0.18 * smooth(CUE.smile - 0.2, CUE.smile + 0.6, t);
  P.jitter = 0;
  return P;
}
function othersPoses(t, swapped) {
  const twitch = (k) => (Math.sin(t * 3.3 + k * 5) > 0.97 ? 0.25 : 0) * Math.sin(t * 50);
  const o1 = { t, color: '#030303', lw: 0.024, armLen: 1.38, legLen: 1.1, x: 655, y: 1335, h: 470, tilt: 0.38 + twitch(1), sx: -1, arms: [[-0.06, -0.02], [0.06, 0.02]] };
  const o2 = { t, color: '#030303', lw: 0.024, armLen: 1.38, legLen: 1.1, x: 395, y: 1350, h: 520, tilt: -0.32 + twitch(2), sx: -1, arms: [[-0.06, -0.02], [0.06, 0.02]] };
  const c1 = smooth(CUE.fig3 - 0.1, CUE.fig3, t), c2 = smooth(CUE.closer0, CUE.closer1, t);
  Object.assign(o1, { x: lerp(lerp(655, 640, c1), 610, c2), y: lerp(lerp(1335, 1370, c1), 1400, c2), h: lerp(lerp(470, 560, c1), 640, c2) });
  Object.assign(o2, { x: lerp(395, 430, c2), y: lerp(1350, 1402, c2), h: lerp(520, 645, c2) });
  o1.eyes = o2.eyes = 0.75;
  const out = [];
  if (t >= CUE.fig2 || swapped) out.push(o1);
  if (t >= CUE.fig3 || swapped) out.push(o2);
  if (swapped) {
    o1.x = 600; o1.y = 1408; o1.h = 650; o2.x = 432; o2.y = 1410; o2.h = 655;
    o1.smile = o2.smile = smooth(CUE.lightBack + 0.6, CUE.lightBack + 1.4, t) * 0.8;
    o1.arms = [[-0.9, -0.5], [0.06, 0.02]]; o2.arms = [[-0.06, -0.02], [0.9, 0.5]];  // hands on his shoulders
  }
  return out;
}
function trappedPose(t) {     // the real man, now inside the glass, pounding on it
  let k = 0; for (const kt of CUE.knocks) k = Math.max(k, Math.exp(-Math.pow((t - kt) / 0.07, 2)));
  return { t, x: REF.x, y: REF.y, h: REF.h, sx: -1, jitter: 0.06, breath: 8 * Math.sin(t * 6), palms: 1 + 0.25 * k,
           arms: [[-2.25 + 0.15 * k, -2.75 + 0.2 * k], [2.25 - 0.15 * k, 2.75 - 0.2 * k]], lean: 0.02 * Math.sin(t * 9) };
}
function copyPose(t) {
  const P = { t, x: MAN.x, y: MAN.y, h: MAN.h, sx: 1, breath: 3 * Math.sin(t * 1.4) };
  const pk = smooth(CUE.pickup, CUE.pickup + 0.9, t), down = Math.sin(Math.PI * clamp((t - CUE.pickup) / 0.9));
  P.arms = [[-0.08, -0.03], [lerp(0.3, 0.35, pk) - 0.15 * down, lerp(0.25, 2.3, pk) - 1.2 * down]];
  P.lean = 0.12 * down;
  // turns to face us
  const tr = clamp((t - CUE.turn2) / 0.9);
  P.sx = tr <= 0 ? 1 : Math.cos(Math.PI * easeInOut(tr));
  P.smile = smooth(CUE.turn2 + 0.4, CUE.turn2 + 1.0, t) * (1 + 0.5 * smooth(CUE.final, CUE.final + 0.5, t));
  P.eyes = smooth(CUE.final, CUE.final + 0.25, t);
  P.tilt = -0.2 * smooth(CUE.turn2 + 0.5, CUE.final + 0.4, t);
  const one = smooth(CUE.final - 0.1, CUE.final + 0.35, t);
  P.arms[0] = [lerp(P.arms[0][0], -2.7, one), lerp(P.arms[0][1], -3.05, one)];
  P.finger = one;
  P.pk = pk;
  return P;
}

// ------------------------------------------------------------ cameras
const CAM_MIRROR = [   // [time cue fn, x, y, zoom]
  [() => 0, 540, 960, 1.0], [() => line(1).t1, 560, 950, 1.07], [() => CUE.candleOn, 520, 1000, 1.08],
  [() => CUE.one, 560, 980, 1.15], [() => CUE.fig2 - 0.05, 585, 950, 1.22], [() => CUE.fig2 + 0.3, 590, 900, 1.45],
  [() => CUE.cut2, 590, 920, 1.32], [() => CUE.fig3 - 0.05, 595, 915, 1.35], [() => CUE.fig3 + 0.3, 590, 900, 1.6],
  [() => CUE.closer1, 585, 890, 1.7], [() => CUE.raise - 0.3, 585, 890, 1.7], [() => CUE.raise + 0.5, 480, 1000, 1.18],
  [() => CUE.smile - 0.25, 520, 960, 1.3], [() => CUE.smile + 0.2, 512, 828, 2.7], [() => CUE.out, 512, 840, 2.85],
  [() => CUE.out + 0.01, 540, 960, 1.0], [() => CUE.lightBack + 0.4, 540, 960, 1.0], [() => line(19).t1, 545, 930, 1.22],
  [() => CUE.face + 0.2, 545, 930, 1.22], [() => CUE.pickup, 380, 1180, 1.35], [() => CUE.turn2, 330, 1160, 1.55],
  [() => CUE.final, 300, 1130, 2.1], [() => CUE.final + 0.35, 290, 1120, 3.1], [() => 999, 290, 1120, 3.2],
];
const CAM_HALL = [[() => 0, 540, 960, 1.05], [() => 999, 540, 940, 1.12]];
function camAt(keys, t) {
  for (let i = 0; i < keys.length - 1; i++) {
    const ta = keys[i][0](), tb = keys[i + 1][0]();
    if (t >= ta && t <= tb) { const u = tb > ta ? easeInOut((t - ta) / (tb - ta)) : 1; return { x: lerp(keys[i][1], keys[i + 1][1], u), y: lerp(keys[i][2], keys[i + 1][2], u), z: lerp(keys[i][3], keys[i + 1][3], u) }; }
  }
  const k = keys[keys.length - 1]; return { x: k[1], y: k[2], z: k[3] };
}
function shakeAt(t) {
  let a = 3;
  for (const s of CUE.stings) a += 22 * Math.exp(-Math.max(0, t - s) * 6) * (t >= s ? 1 : 0);
  for (const k of CUE.knocks) a += 10 * Math.exp(-Math.max(0, t - k) * 12) * (t >= k ? 1 : 0);
  return [a * noise(t * 31), a * noise(t * 27 + 4)];
}
function applyCam(c, cam, sh) { c.setTransform(cam.z, 0, 0, cam.z, W / 2 - cam.x * cam.z + sh[0], H / 2 - cam.y * cam.z + sh[1]); }

// ------------------------------------------------------------ render the mirror room
function renderMirrorSet(t) {
  const swapped = t >= CUE.lightBack;
  const cam = camAt(CAM_MIRROR, t), sh = shakeAt(t);
  const cl = candleLevel(t), bl = bulbLevel(t);
  S.setTransform(1, 0, 0, 1, 0, 0); S.clearRect(0, 0, W, H);
  applyCam(S, cam, sh);
  wall(S); portrait(S, t); bulb(S, bl);
  // mirror frame + glass content
  S.save(); mirrorPath(S, 0); S.fillStyle = '#4a3a22'; S.fill(); S.restore();
  S.save(); mirrorPath(S, M.frame); S.clip();
  S.fillStyle = '#5b544c'; S.fillRect(M.x0, M.y0, M.x1 - M.x0, M.y1 - M.y0);
  S.fillStyle = '#443b33'; S.fillRect(M.x0, 1290, M.x1 - M.x0, 200);                   // reflected floor
  S.fillStyle = '#0a0806'; S.fillRect(600, 960, 120, 330);                                // reflected doorway
  S.strokeStyle = '#2d251e'; S.lineWidth = 6; S.strokeRect(600, 960, 120, 330);
  const man = swapped ? null : manPose(t);
  for (const o of othersPoses(t, swapped)) stick(S, o);
  let refFlame = null;
  if (!swapped) {
    const rp = reflectionPose(t, man); const r = stick(S, rp);
    if (man.hold) { const hd = r.hands[1]; refFlame = candleAt(S, hd[0], hd[1] + 6, 0.72); }
  } else {
    stick(S, trappedPose(t));
  }
  // glass sheen
  const sg = S.createLinearGradient(M.x0, M.y0, M.x1, M.y1);
  sg.addColorStop(0.2, 'rgba(200,220,255,0.0)'); sg.addColorStop(0.45, 'rgba(200,220,255,0.07)'); sg.addColorStop(0.55, 'rgba(200,220,255,0.0)');
  S.fillStyle = sg; S.fillRect(M.x0, M.y0, M.x1 - M.x0, M.y1 - M.y0);
  S.restore();
  S.save(); mirrorPath(S, M.frame - 4); S.strokeStyle = '#8a6e3e'; S.lineWidth = 5; S.stroke(); S.restore();
  // foreground figure: the man (or the thing that took his place) + candle
  let fl = null, flS = 1;
  if (!swapped) {
    const r = stick(S, man);
    if (man.hold) { const hd = r.hands[1]; fl = candleAt(S, hd[0], hd[1] + 8); }
    else if (t >= CUE.match) { const hd = r.hands[1]; fl = [hd[0] + 6, hd[1] - 22]; flS = 0.6; }  // the match
  } else {
    const cp = copyPose(t); const r = stick(S, cp);
    const hd = r.hands[1], floor = [MAN.x + 175, MAN.y - 140];
    const p = cp.pk;
    const cx = lerp(floor[0], hd[0], p), cy = lerp(floor[1], hd[1] + 8, p);
    fl = candleAt(S, cx, cy);
  }
  // light map
  L.setTransform(1, 0, 0, 1, 0, 0);
  const amb = (cl > 0.02 || bl > 0.02) ? 1 : 0.2;                 // real darkness during the blackout
  L.fillStyle = `rgb(${16 * amb},${15 * amb},${19 * amb})`; L.fillRect(0, 0, W, H);
  L.globalCompositeOperation = 'lighter';
  applyCam(L, cam, sh);
  const glow = (x, y, rad, col, a) => { if (a <= 0.003) return; const gr = L.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, `rgba(${col},${a})`); gr.addColorStop(0.45, `rgba(${col},${a * 0.45})`); gr.addColorStop(1, `rgba(${col},0)`); L.fillStyle = gr; L.fillRect(x - rad, y - rad, rad * 2, rad * 2); };
  glow(560, 190, 1750, '248,232,196', 1.2 * bl);
  if (fl) glow(fl[0], fl[1], (swapped ? 1400 : 1150) * (0.75 + 0.25 * Math.min(cl, 1)), '255,176,96', Math.min(1.25, cl) * (swapped ? 1.15 : 1));
  L.save(); mirrorPath(L, M.frame); L.clip();
  if (!swapped && refFlame) glow(refFlame[0], refFlame[1], 620, '255,170,90', 0.9 * cl);
  if (swapped) glow(REF.x, REF.y - 380, 650, '130,160,255', 0.75 * cl);
  L.restore();
  L.globalCompositeOperation = 'source-over';
  S.setTransform(1, 0, 0, 1, 0, 0);
  S.globalCompositeOperation = 'multiply'; S.drawImage(lit, 0, 0); S.globalCompositeOperation = 'source-over';
  // emissive: flames and bulb
  applyCam(S, cam, sh);
  S.globalCompositeOperation = 'lighter';
  if (fl) flame(S, fl[0], fl[1], cl, flS, t);
  if (refFlame) { S.save(); mirrorPath(S, M.frame); S.clip(); flame(S, refFlame[0], refFlame[1], cl * 0.8, 0.72, t + 1); S.restore(); }
  if (bl > 0.05) { const gr = S.createRadialGradient(560, 185, 0, 560, 185, 160); gr.addColorStop(0, `rgba(255,248,220,${0.8 * bl})`); gr.addColorStop(1, 'rgba(255,240,200,0)'); S.fillStyle = gr; S.fillRect(400, 25, 320, 320); }
  S.globalCompositeOperation = 'source-over';
  S.setTransform(1, 0, 0, 1, 0, 0);
}

// ------------------------------------------------------------ render the hallway behind him (reverse shot)
function renderHallSet(t) {
  const cam = camAt(CAM_HALL, t), sh = shakeAt(t), cl = candleLevel(t);
  S.setTransform(1, 0, 0, 1, 0, 0); S.clearRect(0, 0, W, H);
  applyCam(S, cam, sh);
  const VP = [540, 880], E = { x0: 400, x1: 680, y0: 620, y1: 1120 };
  const poly = (pts, col) => { S.fillStyle = col; S.beginPath(); S.moveTo(...pts[0]); for (const p of pts.slice(1)) S.lineTo(...p); S.closePath(); S.fill(); };
  poly([[-300, -300], [E.x0, E.y0], [E.x0, E.y1], [-300, 2300]], '#544638');
  poly([[1380, -300], [E.x1, E.y0], [E.x1, E.y1], [1380, 2300]], '#4d4033');
  poly([[-300, -300], [1380, -300], [E.x1, E.y0], [E.x0, E.y0]], '#3b3129');
  poly([[-300, 2300], [1380, 2300], [E.x1, E.y1], [E.x0, E.y1]], '#3a2d23');
  S.strokeStyle = '#2b2119'; S.lineWidth = 4;
  for (let k = -6; k <= 6; k++) { S.beginPath(); S.moveTo(540 + k * 22, E.y1); S.lineTo(540 + k * 260, 2300); S.stroke(); }
  S.fillStyle = '#4b3e31'; S.fillRect(E.x0, E.y0, E.x1 - E.x0, E.y1 - E.y0);
  // the door at the end: opens a crack when he looks
  const D = { x0: 478, x1: 602, y0: 760, y1: 1120 };
  S.fillStyle = '#020202'; S.fillRect(D.x0, D.y0, D.x1 - D.x0, D.y1 - D.y0);
  const open = 0.22 * smooth(CUE.door, CUE.door + 1.6, t);
  const dw = (D.x1 - D.x0) * (1 - open);
  poly([[D.x0, D.y0], [D.x0 + dw, D.y0 + 8 * open * 6], [D.x0 + dw, D.y1 - 8 * open * 6], [D.x0, D.y1]], '#5e4630');
  S.fillStyle = '#c9a25a'; S.beginPath(); S.arc(D.x0 + dw - 14, 950, 5, 0, Math.PI * 2); S.fill();
  // picture frames on the side walls (perspective)
  poly([[150, 520], [300, 600], [300, 800], [150, 820]], '#5c4426'); poly([[166, 545], [286, 610], [286, 790], [166, 800]], '#2a241c');
  poly([[930, 540], [800, 610], [800, 790], [930, 810]], '#5c4426'); poly([[915, 562], [814, 620], [814, 780], [915, 795]], '#2a241c');
  // the man, facing us, candle in hand
  const P = manPose(t, true); P.x = 830; P.y = 2010; P.h = 1050;
  const r = stick(S, P);
  const hd = r.hands[1]; const fl = candleAt(S, hd[0], hd[1] + 9, 1.15);
  // light
  L.setTransform(1, 0, 0, 1, 0, 0); L.fillStyle = 'rgb(12,11,15)'; L.fillRect(0, 0, W, H);
  L.globalCompositeOperation = 'lighter'; applyCam(L, cam, sh);
  const gr = L.createRadialGradient(fl[0], fl[1], 0, fl[0], fl[1], 1250); gr.addColorStop(0, `rgba(255,176,96,${cl})`); gr.addColorStop(0.45, `rgba(255,176,96,${cl * 0.4})`); gr.addColorStop(1, 'rgba(255,176,96,0)');
  L.fillStyle = gr; L.fillRect(fl[0] - 1250, fl[1] - 1250, 2500, 2500);
  L.globalCompositeOperation = 'source-over';
  S.setTransform(1, 0, 0, 1, 0, 0); S.globalCompositeOperation = 'multiply'; S.drawImage(lit, 0, 0); S.globalCompositeOperation = 'source-over';
  applyCam(S, cam, sh); S.globalCompositeOperation = 'lighter'; flame(S, fl[0], fl[1], cl, 1.15, t); S.globalCompositeOperation = 'source-over';
  S.setTransform(1, 0, 0, 1, 0, 0);
}

// ------------------------------------------------------------ 2D overlay text
function strokeFill(c, text, x, y, fill, stroke, sw) { c.lineJoin = 'round'; if (sw) { c.strokeStyle = stroke; c.lineWidth = sw; c.strokeText(text, x, y); } c.fillStyle = fill; c.fillText(text, x, y); }
function drawTitle(c, t) {
  const a = smooth(0.0, 0.25, t) * (1 - smooth(4.3, 4.9, t));
  if (a <= 0) return;
  c.save(); c.globalAlpha = a * (Math.sin(t * 40) > -0.85 ? 1 : 0.6); c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = `112px Creepster`; c.shadowColor = 'rgba(0,0,0,0.9)'; c.shadowBlur = 24;
  strokeFill(c, 'NEVER COUNT', W / 2, 250, '#d9201f', '#120404', 10);
  c.font = `78px Creepster`; strokeFill(c, 'THE PEOPLE IN THE MIRROR', W / 2, 360, '#efe6d8', '#120404', 9);
  c.restore();
}
function drawCount(c, t) {
  for (const [tc, n] of CUE.counts) {
    const d = t - tc; if (d < -0.05 || d > 1.3) continue;
    const a = smooth(-0.05, 0.08, d) * (1 - smooth(0.6, 1.3, d));
    c.save(); c.globalAlpha = a * 0.9; c.textAlign = 'center'; c.textBaseline = 'middle';
    const s = 1 + 0.25 * Math.exp(-Math.max(0, d) * 6);
    c.translate(W / 2, 300); c.scale(s, s); c.font = '300px Creepster'; c.shadowColor = 'rgba(255,0,0,0.6)'; c.shadowBlur = 40;
    strokeFill(c, n, 0, 0, '#c4161c', '#140303', 12); c.restore();
  }
}
function drawCaptions(c, t) {
  const ls = TL.lines; let cur = -1;
  for (let i = 0; i < ls.length; i++) { const nxt = ls[i + 1] ? ls[i + 1].t0 : 1e9; if (t >= ls[i].t0 - 0.05 && t < Math.min(nxt - 0.05, ls[i].t1 + 0.9)) cur = i; }
  if (cur < 0) return;
  const ln = ls[cur], toks = ln.text.split(' '), ws = ln.words;
  c.save(); c.font = '800 72px Poppins'; c.textBaseline = 'middle'; c.textAlign = 'left';
  const space = c.measureText(' ').width, MAXW = 900, LH = 92;
  const rows = [[]]; let w = 0;
  toks.forEach((tk, i) => { const tw = c.measureText(tk).width; if (rows[rows.length - 1].length && w + space + tw > MAXW) { rows.push([]); w = 0; } w += (rows[rows.length - 1].length ? space : 0) + tw; rows[rows.length - 1].push({ tk, i, tw }); });
  const bottom = 1610, top = bottom - rows.length * LH;
  rows.forEach((row, ri) => {
    const rw = row.reduce((a, b) => a + b.tw, 0) + space * (row.length - 1); let x = W / 2 - rw / 2; const y = top + ri * LH + LH / 2;
    for (const { tk, i, tw } of row) {
      const wd = ws[i]; const shown = wd ? t >= wd.t0 - 0.04 : t >= ln.t0;
      if (shown) {
        const active = wd && t < (ws[i + 1] ? ws[i + 1].t0 : wd.t1 + 0.3);
        const k = wd ? 1 + 0.12 * Math.exp(-Math.max(0, t - wd.t0) * 9) : 1;
        c.save(); c.translate(x + tw / 2, y); c.scale(k, k); c.translate(-(x + tw / 2), -y);
        if (active) { c.shadowColor = 'rgba(255,30,30,0.8)'; c.shadowBlur = 22; }
        strokeFill(c, tk, x, y, active ? RED : '#f3efe8', '#000', 14);
        c.restore();
      }
      x += tw + space;
    }
  });
  c.restore();
}

// ------------------------------------------------------------ frame
function renderFrame(t) {
  const inHall = t >= CUE.cut1 && t < CUE.cut2;
  if (inHall) renderHallSet(t); else renderMirrorSet(t);
  g.setTransform(1, 0, 0, 1, 0, 0); g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  // whip-pan motion blur around the two cuts
  let whip = 0; for (const [c0, d] of [[CUE.cut1, -1], [CUE.cut2, 1]]) { const u = (t - c0) / 0.16; if (Math.abs(u) < 1) whip = d * (1 - Math.abs(u)); }
  if (whip !== 0) {
    const off = whip * 520 * (t < CUE.cut1 + 0.2 || (t >= CUE.cut2 && t < CUE.cut2 + 0.2) ? 1 : -1);
    g.globalAlpha = 1 / 7; for (let k = 0; k < 7; k++) g.drawImage(scn, off * (k / 6 - 0.5) * 0.6 + off * 0.5, 0); g.globalAlpha = 1;
  } else g.drawImage(scn, 0, 0);
  // glitch tearing when the light comes back and on the final "One."
  const gl = Math.max(smooth(0, 0.02, t - CUE.lightBack) * (1 - smooth(0.25, 0.4, t - CUE.lightBack)), smooth(0, 0.02, t - CUE.finalHit) * (1 - smooth(0.15, 0.3, t - CUE.finalHit)));
  if (gl > 0.01) {
    T.setTransform(1, 0, 0, 1, 0, 0); T.clearRect(0, 0, W, H); T.drawImage(cv, 0, 0);
    const r = rng(Math.floor(t * FPS) + 9);
    for (let k = 0; k < 9; k++) { const y = r() * H, h = 20 + r() * 140, dx = (r() - 0.5) * 120 * gl; g.drawImage(tmp, 0, y, W, h, dx, y, W, h); }
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.25 * gl; g.drawImage(tmp, 12 * gl, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
  }
  // sting flash
  let fla = 0; for (const s of CUE.stings) { const d = t - s; if (d >= 0 && d < 0.25) fla = Math.max(fla, 0.22 * (1 - d / 0.25)); }
  if (fla > 0) { g.fillStyle = `rgba(160,10,10,${fla})`; g.fillRect(0, 0, W, H); }
  // vignette
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H / 2, H * 0.72);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.78)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);
  // film grain
  const fi = Math.floor(t * FPS);
  g.save(); g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.13;
  g.drawImage(grain[fi % 4], -(fi * 37) % 200, -(fi * 53) % 300, W + 200, H + 300); g.restore();
  // text
  drawTitle(g, t); drawCount(g, t); drawCaptions(g, t);
  // end: fade to black (the Short loops back to "My grandma had one rule")
  const fb = smooth(CUE.end - 0.25, CUE.end, t);
  if (fb > 0) { g.fillStyle = `rgba(0,0,0,${fb})`; g.fillRect(0, 0, W, H); }
  return true;
}

async function init() {
  TL = await (await fetch('../build/timeline.json')).json();
  DUR = TL.duration; buildCues();
  await document.fonts.load('800 72px Poppins'); await document.fonts.load('112px Creepster');
}
window.renderFrame = renderFrame;
window.ready = init().then(() => { window.META = { W, H, FPS, DURATION: DUR }; const q = new URLSearchParams(location.search); if (q.has('t')) renderFrame(parseFloat(q.get('t'))); return true; });
