import { createCamera } from './camera.js';

const TAU = Math.PI * 2;
const BG = '#000';
const ACCENT = '#ffc83d';           // warm yellow for brows
const INK = '#3b2313';
// browOff/browLen/browW scale brows by the eye's ry/rx; mouthLW scales by ry.
const STYLES = {
  classic: { line: '#f4efe6', brow: ACCENT, z: '#f3e7c9', clock: '255,233,176',
             browOff: 1.22, browLen: 1.05, browW: 0.11, mouthW: 1.6, mouthLW: 0.085 },
  yellow:  { line: INK, brow: INK, z: '#5a4100', clock: '40,26,0', taper: true, archMul: 1.3,
             browOff: 1.12, browLen: 1.75, browW: 0.2, mouthW: 3.0, mouthLW: 0.1 },
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

/* ---------- canvas ---------- */
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
let W = 0, H = 0, DPR = 1;
function resize() {
  DPR = Math.min(window.devicePixelRatio || 1, 1.5);
  W = innerWidth; H = innerHeight;
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
}
addEventListener('resize', resize); resize();

/* ---------- settings ---------- */
const KEY = 'buddy-settings-v2';
let settings = { mood: 'auto', clock: true, h24: false, camera: false, camFlip: false, style: 'classic' };
try { Object.assign(settings, JSON.parse(localStorage.getItem(KEY) || '{}')); } catch (e) {}
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(settings)); } catch (e) {} };
const qp = new URLSearchParams(location.search).get('mood');   // ?mood=happy for testing

/* ---------- moods ----------
 open  : eye height multiplier          up   : upper-lid coverage (0..1)
 tilt  : + lowers inner lid corner       low  : lower-lid smile curve
 pupil : pupil size                      heart: heart pupils
 browY : + lower brow (x eye height)     browA: + lowers inner brow end
 browC : brow arch                       blush: cheek blush
 asym  : left eye wider / right narrower                               */
const DEF = { open:1, up:0.08, tilt:0, low:0, pupil:1, heart:0,
              browY:0, browA:0, browC:0.12, blush:0, asym:0, side:0,   // side: 1 = side-eye gaze
              mW:0.32, mC:0.35, mO:0, mSk:0,   // mouth: width, smile curve (+/-), O-ring, smirk
              // drawn by the Yellow style only:
              mOpen:0, mWave:0, lash:0, shadow:0, ring:0, star:0, sweat:0 };
const M = (o) => Object.assign({}, DEF, o);
const MOODS = {
  normal:    M({}),
  happy:     M({ open:0.85, up:0, low:0.42, pupil:1.05, browY:-0.1, browC:0.3, blush:0.5, mW:0.5, mC:1 }),
  sad:       M({ open:0.85, up:0.28, tilt:-0.35, pupil:0.95, browY:-0.02, browA:-0.4, browC:0.05, mW:0.36, mC:-0.7 }),
  angry:     M({ open:0.8, up:0.36, tilt:0.5, low:0.05, pupil:0.8, browY:0.14, browA:0.5, browC:-0.05, mW:0.42, mC:-0.3 }),
  sleepy:    M({ open:0.5, up:0.52, tilt:-0.08, low:0.1, pupil:0.9, browY:0.06, browA:-0.1, browC:0.05, mW:0.22, mC:0.08 }),
  surprised: M({ open:1.12, up:0, pupil:0.62, browY:-0.28, browC:0.35, mW:0.16, mC:0, mO:1 }),
  love:      M({ up:0, low:0.22, pupil:1.1, heart:1, browY:-0.12, browA:-0.1, browC:0.3, blush:0.7, mW:0.42, mC:0.85 }),
  curious:   M({ up:0.12, pupil:1, browC:0.2, asym:0.16, mW:0.3, mC:0.15, mSk:0.6 }),
  smug:        M({ open:0.72, asym:0.14, pupil:0.95, browY:-0.04, browA:-0.12, browC:0.15, mW:0.34, mC:0.35, mSk:0.9, side:1 }),
  unimpressed: M({ open:0.58, pupil:0.95, browY:0.06, browC:0, mW:0.3, mC:0, side:1 }),
  suspicious:  M({ open:0.52, pupil:0.85, browY:0.1, browA:0.3, browC:0.02, mW:0.24, mC:-0.15, side:1 }),
  skeptical:   M({ open:0.8, asym:0.35, pupil:0.95, browY:-0.12, browC:0.18, mW:0.3, mC:-0.1, mSk:-0.5 }),
  annoyed:     M({ open:0.55, pupil:0.9, browY:0.15, browA:0.35, browC:-0.02, mW:0.3, mC:-0.25, mSk:0.3, side:1 }),
  asleep:    M({ open:0.04, up:0, pupil:0.9, browY:0.08, browC:0.05, mW:0.22, mC:0.3 }),
  excited:   M({ open:1.1, up:0, low:0.2, pupil:1.1, browY:-0.25, browC:0.35, blush:0.4, mW:0.5, mC:1 })
};
// Yellow-only adjustments laid over MOODS, so changing them never touches the Classic face.
const YELLOW = {
  happy:       { open:1, low:0.3, pupil:1.3, browY:-0.18, browC:0.5, blush:0.9, mOpen:1, mW:0.5, mC:0.5 },
  excited:     { star:1, mOpen:1, mW:0.5, mC:0.5, browY:-0.3, browC:0.5, blush:0 },
  surprised:   { open:1.15, pupil:0.36, ring:1, browY:-0.3, browC:0.55, mO:1, sweat:1 },
  love:        { mOpen:0.6, mW:0.42, blush:0.9 },
  smug:        { open:0.66, up:0.12, shadow:1, lash:1, browY:-0.2, browC:0.45, browA:0, mSk:1, mC:0.3, mW:0.3 },
  skeptical:   { open:0.62, up:0.1, shadow:0.5, lash:1, mWave:1, mW:0.45, mC:0, mSk:0 },
  unimpressed: { lash:0.3 },
  suspicious:  { lash:0.7 },
  annoyed:     { lash:0.7 },
  sleepy:      { lash:0.6, mC:-0.3, mW:0.2 },
  asleep:      { lash:1, mC:-0.45, mW:0.2, mSk:0.5 },
};
const MOODS_Y = Object.fromEntries(Object.entries(MOODS).map(([k, v]) => [k, Object.assign({}, v, YELLOW[k])]));
const moodTable = () => (settings.style === 'yellow' ? MOODS_Y : MOODS);
const PICKABLE = ['normal','happy','sad','angry','sleepy','surprised','love','curious',
                  'smug','unimpressed','suspicious','skeptical','annoyed','excited'];
const cur = Object.assign({}, MOODS.normal);
if (qp && MOODS[qp]) Object.assign(cur, moodTable()[qp]);   // snap when previewing a mood

/* ---------- mood state ---------- */
let baseMood = 'normal', tempMood = null, tempUntil = 0, tempNext = null, nextAuto = 0, wakeUntil = 0;
let moodName = 'normal';
const AWAY_SLEEPY_MS = 10 * 60000;
let awaySince = 0;               // set while the camera runs and nobody is in view
const scheduleAuto = (now) => { nextAuto = now + rand(25, 75) * 1000; };
function pickAuto() {
  const pool = ['normal','normal','normal','happy','happy','curious','curious',
                'unimpressed','unimpressed','skeptical','skeptical','smug','suspicious','annoyed',
                'surprised','love','sleepy','sad','angry','excited'];
  let m; do { m = pool[Math.floor(Math.random() * pool.length)]; } while (m === baseMood);
  return m;
}
function nightState() {
  const h = new Date().getHours();
  if (h >= 23 || h < 6) return 'asleep';
  if (h >= 22) return 'sleepy';
  return null;
}
function resolveMood(now) {
  if (qp && MOODS[qp]) return qp;
  if (tempMood && now < tempUntil) return tempMood;
  tempMood = null;
  if (tempNext) { const t = tempNext; tempNext = null; setTemp(t.m, t.ms); return t.m; }
  if (settings.mood !== 'auto') return settings.mood;
  const n = nightState();
  if (n === 'asleep') return now < wakeUntil ? 'sleepy' : 'asleep';
  if (n) return n;
  if (awaySince && now - awaySince >= AWAY_SLEEPY_MS) return 'sleepy';
  if (now > nextAuto) { baseMood = pickAuto(); scheduleAuto(now); }
  return baseMood;
}
const setTemp = (m, ms, next = null) => { tempMood = m; tempUntil = Date.now() + ms; tempNext = next; };
scheduleAuto(Date.now());

/* ---------- gaze & blink ---------- */
const look = { x:0, y:0 }, lookT = { x:0, y:0 };
let nextLook = 0, lookHold = 0;
let blinkStart = -1, nextBlink = Date.now() + 2000, doubleBlinkAt = 0;

/* ---------- particles ---------- */
const hearts = [], zs = [], confetti = [];
let zTimer = 0, tearT = 0, confT = 0, prevMood = '';
const CONFETTI_COLORS = ['#ff4d8d', '#35c4ff', '#8b5cf6', '#22d48a', '#ff9f1c'];
function spawnConfetti(n) {
  for (let i = 0; i < n && confetti.length < 160; i++) {
    const a = rand(0, TAU), sp = rand(H * 0.5, H * 1.1);
    confetti.push({ x: W / 2 + Math.cos(a) * W * 0.12, y: H * 0.4 + Math.sin(a) * H * 0.15,
                    vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, len: rand(H * 0.025, H * 0.05),
                    c: CONFETTI_COLORS[i % CONFETTI_COLORS.length], life: 0, max: rand(0.8, 1.5) });
  }
}
function burstHearts() {
  for (let i = 0; i < 9; i++) hearts.push({
    x: W / 2 + rand(-W * 0.18, W * 0.18), y: H * 0.6 + rand(-10, 20),
    vx: rand(-25, 25), vy: rand(-90, -50), s: rand(14, 30), life: 0, max: rand(1.6, 2.6)
  });
}

/* ---------- geometry ---------- */
function layout(S) {
  if (S === STYLES.yellow) {
    const rx = Math.min(H * 0.18, W * 0.13), ry = rx, gap = rx * 1.55, cy = H * 0.37;
    return { rx, ry, cy, cxL: W / 2 - gap, cxR: W / 2 + gap, my: cy + rx * 1.3 };
  }
  const ry = Math.min(H * 0.18, W * 0.14);
  const rx = ry;
  const gap = ry * 1.45;
  const cy = H * 0.38;
  return { ry, rx, cy, cxL: W / 2 - gap, cxR: W / 2 + gap, my: cy + ry * 1.3 };
}

// The shaded yellow background is cached and redrawn only on resize. Eyelids reuse
// it, so they match the shading behind them.
let skin = null;
function skinSprite() {
  const key = `${W}|${H}|${DPR}`;
  if (skin && skin.key === key) return skin.canvas;
  const oc = document.createElement('canvas');
  oc.width = Math.round(W * DPR); oc.height = Math.round(H * DPR);
  const g = oc.getContext('2d'); g.scale(DPR, DPR);
  const r = Math.hypot(W, H) * 0.6;
  const grad = g.createRadialGradient(W * 0.4, H * 0.25, 0, W / 2, H * 0.45, r);
  grad.addColorStop(0, '#ffe766'); grad.addColorStop(0.5, '#ffcf1f'); grad.addColorStop(1, '#e89c00');
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  skin = { key, canvas: oc };
  return oc;
}
// ox/oy: where the current transform's origin sits on screen.
const drawSkin = (ox = 0, oy = 0) => ctx.drawImage(skinSprite(), -ox, -oy, W, H);
let driftX = 0, driftY = 0;

function heartPath(x, y, s) {
  y -= s * 0.3;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.bezierCurveTo(x, y - s * 0.3, x - s * 0.5, y - s * 0.3, x - s * 0.5, y);
  ctx.bezierCurveTo(x - s * 0.5, y + s * 0.3, x, y + s * 0.55, x, y + s * 0.8);
  ctx.bezierCurveTo(x, y + s * 0.55, x + s * 0.5, y + s * 0.3, x + s * 0.5, y);
  ctx.bezierCurveTo(x + s * 0.5, y - s * 0.3, x, y - s * 0.3, x, y);
  ctx.closePath();
}

function drawEye(i, cx, cy, rx, ry, p, openMul) {
  const open = p.open * openMul * (1 + p.asym * (i === 0 ? 0.25 : -0.25));
  ctx.save();
  ctx.translate(cx, cy);

  if (open < 0.12) {                                // closed: soft curved line
    ctx.strokeStyle = '#f4efe6'; ctx.lineWidth = ry * 0.09; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-rx * 0.8, 0);
    ctx.quadraticCurveTo(0, ry * 0.28, rx * 0.8, 0); ctx.stroke();
    ctx.restore(); return;
  }
  ctx.scale(1, open);

  // eye: plain round white
  ctx.beginPath(); ctx.arc(0, 0, rx, 0, TAU);
  ctx.fillStyle = '#f6f2ea'; ctx.fill();
  ctx.save(); ctx.clip();

  // pupil
  const px = look.x * rx * 0.4, py = look.y * ry * 0.4;
  const pr = rx * 0.48 * p.pupil;
  if (p.heart > 0.5) {
    heartPath(px, py, pr * 2.3); ctx.fillStyle = '#e8344e'; ctx.fill();
  } else {
    ctx.fillStyle = '#17110c';
    ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill();
  }
  ctx.restore(); ctx.restore();
}

// Yellow-style eyes show mood through eyelids rather than squashing the eye: a less
// open mood lowers the upper lid.
function drawEyeLidded(i, cx, cy, rx, ry, p, openMul, t) {
  const s = i === 0 ? 1 : -1;                       // the outer corner is at x = -s * rx
  ctx.save();
  ctx.translate(cx, cy);
  if (p.star > 0.5) { drawStar(rx * 1.05, t + i * 0.7); ctx.restore(); return; }
  const open = p.open * (1 + p.asym * (i === 0 ? 0.25 : -0.25));
  const h = ry * (0.8 + 0.2 * Math.min(open, 1.2)) * openMul;
  ctx.strokeStyle = INK; ctx.lineCap = 'round';
  if (open < 0.12 || h < ry * 0.15) {
    ctx.lineWidth = ry * 0.1;
    ctx.beginPath(); ctx.moveTo(-rx * 0.85, 0);
    ctx.quadraticCurveTo(0, ry * 0.4, rx * 0.85, 0); ctx.stroke();
    if (p.lash > 0.05) {                            // short lashes on the outer half
      ctx.lineWidth = ry * 0.06; ctx.globalAlpha = clamp(p.lash, 0, 1);
      for (const u0 of [0.12, 0.3]) {
        const u = s > 0 ? u0 : 1 - u0, x = rx * 0.85 * (2 * u - 1), y = ry * 0.8 * u * (1 - u);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x - s * rx * 0.1, y + ry * 0.17); ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.restore(); return;
  }
  ctx.beginPath(); ctx.ellipse(0, 0, rx, h, 0, 0, TAU);
  ctx.fillStyle = '#ffffff'; ctx.fill();
  ctx.save();
  ctx.clip();

  // Upper lid; +tilt lowers the inner corner.
  const cover = clamp(p.up + (1 - Math.min(open, 1)) * 0.5, 0, 0.92);
  const dy = p.tilt * h * 0.5 * s;
  const yl = -h + 2 * h * cover;

  // Under a lowered lid the pupil hangs from it, half hidden, instead of following gaze up/down.
  const pr = Math.min(rx * 0.45 * p.pupil, h * 0.9);
  const hang = clamp((cover - 0.1) / 0.2, 0, 1);
  const px = look.x * rx * 0.5, py = look.y * h * 0.4 * (1 - hang) + (yl + pr * 0.45) * hang;
  if (p.heart > 0.5) {
    heartPath(px, py, pr * 2.4); ctx.fillStyle = '#e8344e'; ctx.fill();
  } else {
    ctx.fillStyle = INK; ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill();
    const shine = clamp((p.pupil - 0.8) / 0.25, 0, 1);
    if (shine > 0) {
      ctx.globalAlpha = shine; ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(px - pr * 0.32, py - pr * 0.32, pr * 0.3, 0, TAU); ctx.fill();
      ctx.beginPath(); ctx.arc(px + pr * 0.3, py + pr * 0.3, pr * 0.13, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  ctx.save();
  ctx.beginPath(); ctx.moveTo(-rx - 2, -h - 2); ctx.lineTo(rx + 2, -h - 2);
  ctx.lineTo(rx + 2, yl + dy); ctx.lineTo(-rx - 2, yl - dy); ctx.closePath();
  ctx.clip(); drawSkin(cx + driftX, cy + driftY);
  if (p.shadow > 0.02) {
    const g = ctx.createLinearGradient(0, -h, 0, yl);
    g.addColorStop(0, `rgba(255,120,40,${0.15 * p.shadow})`); g.addColorStop(1, `rgba(255,120,40,${0.6 * p.shadow})`);
    ctx.fillStyle = g; ctx.fillRect(-rx - 2, -h - 2, rx * 2 + 4, yl + h + Math.abs(dy) + 4);
  }
  ctx.restore();
  ctx.lineWidth = ry * 0.08;
  ctx.beginPath(); ctx.moveTo(-rx - 2, yl - dy); ctx.lineTo(rx + 2, yl + dy); ctx.stroke();

  if (p.low > 0.02) {                               // lower lid pushes up for smiling eyes
    ctx.beginPath(); ctx.moveTo(-rx - 2, h + 2);
    ctx.lineTo(-rx - 2, h); ctx.quadraticCurveTo(0, h - 4 * h * p.low, rx + 2, h);
    ctx.lineTo(rx + 2, h + 2); ctx.closePath();
    ctx.clip(); drawSkin(cx + driftX, cy + driftY);
  }
  ctx.restore();

  if (p.low > 0.1) {                                // cheek crease under smiling eyes
    ctx.strokeStyle = `rgba(214,104,16,${clamp(p.low, 0, 0.35)})`; ctx.lineWidth = ry * 0.06;
    ctx.beginPath(); ctx.moveTo(-rx * 0.95, h * 0.95);
    ctx.quadraticCurveTo(0, h - 4 * h * p.low, rx * 0.95, h * 0.95); ctx.stroke();
    ctx.strokeStyle = INK;
  }
  if (p.ring > 0.02) {
    ctx.lineWidth = ry * 0.1 * p.ring;
    ctx.beginPath(); ctx.ellipse(0, 0, rx, h, 0, 0, TAU); ctx.stroke();
  }
  if (p.lash > 0.05 && cover > 0.04) {              // lid line flicks up past the outer corner
    const hw = rx * Math.sqrt(Math.max(0, 1 - (yl / h) ** 2));
    const xo = -s * hw, yo = yl - dy * hw / rx, k = p.lash;
    ctx.lineWidth = ry * 0.08;
    ctx.beginPath(); ctx.moveTo(xo + s * rx * 0.05, yo);
    ctx.quadraticCurveTo(xo - s * rx * 0.2 * k, yo + ry * 0.02, xo - s * rx * 0.3 * k, yo - ry * 0.2 * k);
    ctx.stroke();
  }
  ctx.restore();
}

function starPath(R, ir) {
  ctx.beginPath();
  for (let k = 0; k < 10; k++) {
    const a = -Math.PI / 2 + k * Math.PI / 5, r = k % 2 ? ir : R;
    ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  ctx.closePath();
}

function drawStar(r, t) {
  ctx.save();
  ctx.rotate(Math.sin(t * 3) * 0.12);
  const k = 1 + Math.sin(t * 6) * 0.05; ctx.scale(k, k);
  ctx.lineJoin = 'round';
  starPath(r, r * 0.5); ctx.fillStyle = '#9146ea'; ctx.fill();
  ctx.lineWidth = r * 0.09; ctx.strokeStyle = '#5a1fa6'; ctx.stroke();
  starPath(r * 0.55, r * 0.27); ctx.fillStyle = '#ffd34d'; ctx.fill();
  ctx.restore();
}

function drawBrow(i, cx, cy, rx, ry, p, S) {
  const s = i === 0 ? 1 : -1;
  const asym = p.asym * (i === 0 ? -1.2 : 1.2);
  const by = cy - ry * S.browOff + (p.browY + asym) * ry;
  const len = rx * S.browLen;
  ctx.save();
  ctx.translate(cx, by); ctx.rotate(p.browA * s * 0.55);
  const arch = p.browC * ry * 0.6 * (S.archMul || 1);
  if (S.taper) {                                    // filled shape, thick in the middle, thin ends
    const n = 14, w = ry * S.browW, top = [], bot = [];
    for (let k = 0; k <= n; k++) {
      const u = k / n, x = -len / 2 + len * u, y = -2 * arch * u * (1 - u);
      const sl = -2 * arch * (1 - 2 * u) / len, nl = Math.hypot(sl, 1);
      const th = w * (0.3 + 0.7 * Math.sin(Math.PI * u)) / 2;
      top.push([x + sl / nl * th, y - th / nl]); bot.push([x - sl / nl * th, y + th / nl]);
    }
    ctx.beginPath();
    for (const [x, y] of top) ctx.lineTo(x, y);
    for (const [x, y] of bot.reverse()) ctx.lineTo(x, y);
    ctx.closePath(); ctx.fillStyle = S.brow; ctx.fill();
  } else {
    ctx.strokeStyle = S.brow; ctx.lineWidth = ry * S.browW; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-len / 2, 0);
    ctx.quadraticCurveTo(0, -arch, len / 2, 0); ctx.stroke();
  }
  ctx.restore();
}

function drawBlush(cx, cy, rx, ry, a) {
  if (a < 0.02) return;
  const x = cx, y = cy + ry * 0.98;
  const g = ctx.createRadialGradient(x, y, 0, x, y, rx * 0.7);
  g.addColorStop(0, `rgba(255,105,135,${0.7 * a})`); g.addColorStop(1, 'rgba(255,105,135,0)');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.ellipse(x, y, rx * 0.7, ry * 0.22, 0, 0, TAU); ctx.fill();
}

function drawMouth(x, y, rx, ry, p, S) {
  const w = p.mW * rx * S.mouthW;
  ctx.save(); ctx.translate(x, y);
  ctx.strokeStyle = S.line; ctx.lineWidth = ry * S.mouthLW; ctx.lineCap = 'round';
  // small "o" ring for surprise (stroke only, never filled)
  if (p.mO > 0.02) {
    ctx.globalAlpha = Math.min(1, p.mO * 1.5);
    ctx.beginPath(); ctx.ellipse(0, 0, ry * 0.11 * p.mO + 1, ry * 0.14 * p.mO + 1, 0, 0, TAU);
    ctx.stroke(); ctx.globalAlpha = 1;
    if (p.mO > 0.6) { ctx.restore(); return; }
    ctx.globalAlpha = 1 - p.mO;
  }
  // closed curved line; smirk lifts the right corner
  const d = p.mC * ry * 0.42, yR = -p.mSk * ry * 0.18;
  ctx.beginPath(); ctx.moveTo(-w / 2, 0);
  ctx.bezierCurveTo(-w * 0.2, d, w * 0.2, d + yR * 0.5, w / 2, yR);
  ctx.stroke(); ctx.globalAlpha = 1; ctx.restore();
}

// shape() builds the mouth path; it's called twice because filling the inside replaces the path.
function fillOpenMouth(shape, top, bottom, w) {
  shape();
  ctx.save(); ctx.fillStyle = '#4a1a12'; ctx.fill(); ctx.clip();
  const d = Math.max(0, bottom - top);           // negative while a closing mouth shrinks
  ctx.fillStyle = '#fff6ec';
  ctx.beginPath(); ctx.ellipse(0, top, w * 0.55, d * 0.26, 0, 0, TAU); ctx.fill();
  ctx.fillStyle = '#ff5f78';
  ctx.beginPath(); ctx.ellipse(0, bottom, w * 0.33, d * 0.42, 0, 0, TAU); ctx.fill();
  ctx.restore();
  shape(); ctx.stroke();
}

function drawMouthYellow(x, y, rx, ry, p, S) {
  const w = p.mW * rx * S.mouthW;
  ctx.save(); ctx.translate(x, y);
  ctx.strokeStyle = INK; ctx.lineWidth = ry * S.mouthLW; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  let rest = 1;                                     // how much of the closed-mouth line still shows
  if (p.mO > 0.02) {                                // shocked: tall open oval
    const ow = ry * 0.42 * p.mO, oh = ry * 0.55 * p.mO;
    ctx.globalAlpha = Math.min(1, p.mO * 1.5);
    fillOpenMouth(() => { ctx.beginPath(); ctx.ellipse(0, oh * 0.4, ow, oh, 0, 0, TAU); }, -oh * 0.6, oh * 1.4, ow * 2);
    rest = 1 - p.mO;
  }
  if (p.mOpen > 0.05 && rest > 0.05) {              // open smile with teeth and tongue
    const d = w * 0.5 * p.mOpen;
    ctx.globalAlpha = Math.min(1, p.mOpen * 2) * rest;
    fillOpenMouth(() => {
      ctx.beginPath(); ctx.moveTo(-w / 2, 0); ctx.quadraticCurveTo(0, w * 0.08, w / 2, 0);
      ctx.bezierCurveTo(w * 0.42, d * 1.3, -w * 0.42, d * 1.3, -w / 2, 0); ctx.closePath();
    }, w * 0.04, d, w);
    rest *= 1 - Math.min(1, p.mOpen * 2);
  }
  if (rest > 0.02) {
    const d = p.mC * ry * 0.42, yR = -p.mSk * ry * 0.18;
    ctx.globalAlpha = rest * (1 - p.mWave);
    ctx.beginPath(); ctx.moveTo(-w / 2, 0);
    ctx.bezierCurveTo(-w * 0.2, d, w * 0.2, d + yR * 0.5, w / 2, yR); ctx.stroke();
    if (p.mWave > 0.02) {                           // wavy "confused" mouth
      ctx.globalAlpha = rest * p.mWave;
      ctx.beginPath();
      for (let k = 0; k <= 24; k++) {
        const u = k / 24;
        ctx.lineTo(-w / 2 + w * u, Math.sin(u * TAU * 2.5) * ry * 0.08 * p.mWave);
      }
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1; ctx.restore();
}

function drawCheeks(L, a) {
  if (a < 0.02) return;
  for (const s of [-1, 1]) {
    const x = W / 2 + s * (L.cxR - W / 2 + L.rx * 0.5), y = L.cy + L.ry * 1.25, r = L.rx * 0.42;
    const g = ctx.createRadialGradient(x, y, r * 0.35, x, y, r);
    g.addColorStop(0, `rgba(255,96,96,${0.6 * a})`); g.addColorStop(1, 'rgba(255,96,96,0)');
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  }
}

function dropPath(x, y, sz, tilt = 0) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(tilt);
  ctx.beginPath(); ctx.moveTo(0, -sz * 1.4);
  ctx.quadraticCurveTo(sz, 0, 0, sz * 0.8);
  ctx.quadraticCurveTo(-sz, 0, 0, -sz * 1.4);
  ctx.restore();
}

function drawSweat(L, a, t) {
  if (a < 0.05) return;
  ctx.globalAlpha = clamp(a, 0, 1);
  ctx.fillStyle = '#5cc3ff';
  const bob = Math.sin(t * 5) * L.ry * 0.05;
  for (const [dx, dy, sz, tilt] of [[-1.7, -1.6, 0.2, -0.5], [1.75, -1.7, 0.2, 0.5], [2.1, -0.95, 0.16, 0.9]]) {
    const x = (dx < 0 ? L.cxL : L.cxR) + dx * L.rx, y = L.cy + dy * L.ry + bob;
    dropPath(x, y, L.ry * sz, tilt); ctx.fill();
  }
  const slide = (t * 0.45) % 1;                     // one drop running down the temple
  ctx.globalAlpha = clamp(a, 0, 1) * (1 - slide * 0.7);
  dropPath(L.cxR + L.rx * 1.45, L.cy - L.ry * 0.5 + slide * L.ry * 0.9, L.ry * 0.2); ctx.fill();
  ctx.globalAlpha = 1;
}

/* ---------- update ---------- */
function update(dt, now) {
  moodName = resolveMood(now);
  const tgt = moodTable()[moodName];
  const r = Math.min(1, dt * 6);
  for (const k in tgt) cur[k] += (tgt[k] - cur[k]) * r;
  // snap heart and star flags so the eyes switch cleanly
  cur.heart = tgt.heart; cur.star = tgt.star;

  // gaze
  if (now > lookHold && now > nextLook) {
    if (Math.random() < 0.3) { lookT.x = 0; lookT.y = 0; }
    else { lookT.x = rand(-0.85, 0.85); lookT.y = rand(-0.5, 0.5); }
    if (moodName === 'sad' || moodName === 'sleepy') lookT.y = clamp(lookT.y + 0.4, -1, 1);
    if (moodName === 'curious') lookT.x = Math.sign(lookT.x || 1) * 0.9;
    if (MOODS[moodName].side) {                       // side-eye: hold a glance to one side
      lookT.x = (Math.random() < 0.5 ? -1 : 1) * rand(0.8, 0.95);
      lookT.y = moodName === 'suspicious' ? rand(-0.1, 0.1) : rand(0, 0.25);
    }
    if (moodName === 'asleep') { lookT.x = 0; lookT.y = 0.2; }
    nextLook = now + (MOODS[moodName].side ? rand(2500, 5000) : rand(800, 3400));
  }
  const lr = Math.min(1, dt * 14);
  look.x += (lookT.x - look.x) * lr; look.y += (lookT.y - look.y) * lr;

  // blink
  if (moodName !== 'asleep') {
    if (now > nextBlink) {
      blinkStart = now; nextBlink = now + rand(1800, 6000);
      if (Math.random() < 0.2) doubleBlinkAt = now + 260;
    }
    if (doubleBlinkAt && now > doubleBlinkAt) { blinkStart = now; doubleBlinkAt = 0; }
  }

  // particles
  for (let i = hearts.length - 1; i >= 0; i--) {
    const h = hearts[i]; h.life += dt; h.x += h.vx * dt; h.y += h.vy * dt;
    if (h.life > h.max) hearts.splice(i, 1);
  }
  if (moodName === 'sleepy' || moodName === 'asleep') {
    zTimer += dt;
    if (zTimer > 1.8) { zTimer = 0; zs.push({ t: 0 }); }
  }
  for (let i = zs.length - 1; i >= 0; i--) { zs[i].t += dt; if (zs[i].t > 3) zs.splice(i, 1); }
  tearT = moodName === 'sad' ? tearT + dt : 0;

  if (moodName === 'excited') {
    if (prevMood !== 'excited') spawnConfetti(40);
    confT += dt;
    if (confT > 0.25) { confT = 0; spawnConfetti(6); }
  }
  prevMood = moodName;
  for (let i = confetti.length - 1; i >= 0; i--) {
    const c = confetti[i]; c.life += dt;
    c.x += c.vx * dt; c.y += c.vy * dt; c.vy += H * 0.8 * dt; c.vx *= 0.98;
    if (c.life > c.max) confetti.splice(i, 1);
  }
}

/* ---------- draw ---------- */
function blinkMul(now) {
  if (blinkStart < 0) return 1;
  const e = (now - blinkStart) / 160;
  if (e >= 1) { blinkStart = -1; return 1; }
  const a = e < 0.5 ? e * 2 : (1 - e) * 2;
  return 1 - 0.95 * a;
}

function draw(now) {
  const t = now / 1000;
  const S = STYLES[settings.style] || STYLES.classic;
  if (S === STYLES.yellow) drawSkin(); else { ctx.fillStyle = BG; ctx.fillRect(0, 0, W, H); }
  ctx.save();
  // slow drift of the whole face
  driftX = Math.sin(t * 0.07) * W * 0.012 + Math.sin(t * 0.031) * W * 0.008;
  driftY = Math.sin(t * 0.05) * H * 0.012;
  ctx.translate(driftX, driftY);

  const L = layout(S), bm = blinkMul(now);
  const mx = W / 2 + look.x * L.rx * 0.12;
  if (S === STYLES.yellow) {
    drawCheeks(L, cur.blush);
    drawEyeLidded(0, L.cxL, L.cy, L.rx, L.ry, cur, bm, t);
    drawEyeLidded(1, L.cxR, L.cy, L.rx, L.ry, cur, bm, t);
  } else {
    drawEye(0, L.cxL, L.cy, L.rx, L.ry, cur, bm);
    drawEye(1, L.cxR, L.cy, L.rx, L.ry, cur, bm);
  }
  drawBrow(0, L.cxL, L.cy, L.rx, L.ry, cur, S);
  drawBrow(1, L.cxR, L.cy, L.rx, L.ry, cur, S);
  if (S === STYLES.yellow) {
    drawMouthYellow(mx, L.my, L.rx, L.ry, cur, S);
    drawSweat(L, cur.sweat, t);
  } else {
    drawMouth(mx, L.my, L.rx, L.ry, cur, S);
  }

  // tear
  if (tearT > 0) {
    const prog = (tearT % 2.8) / 1.4;
    if (prog < 1) {
      const x = L.cxL - L.rx * 0.55, y = L.cy + L.ry * 0.75 + prog * L.ry * 1.1;
      const sz = L.ry * 0.12;
      ctx.globalAlpha = 1 - prog * 0.6;
      ctx.fillStyle = '#7cc8ff';
      dropPath(x, y, sz); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // hearts
  for (const h of hearts) {
    ctx.globalAlpha = clamp(1 - h.life / h.max, 0, 1);
    heartPath(h.x + Math.sin(h.life * 4) * 8, h.y, h.s);
    ctx.fillStyle = '#ff4d6d'; ctx.fill();
  }
  ctx.globalAlpha = 1;

  ctx.lineCap = 'round'; ctx.lineWidth = H * 0.008;
  for (const c of confetti) {
    const sp = Math.hypot(c.vx, c.vy) || 1;
    ctx.globalAlpha = clamp(1 - c.life / c.max, 0, 1); ctx.strokeStyle = c.c;
    ctx.beginPath(); ctx.moveTo(c.x, c.y); ctx.lineTo(c.x - c.vx / sp * c.len, c.y - c.vy / sp * c.len); ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // z's
  for (const z of zs) {
    const k = z.t / 3;
    ctx.globalAlpha = Math.sin(k * Math.PI) * 0.8;
    ctx.fillStyle = S.z;
    ctx.font = `600 ${L.ry * (0.18 + k * 0.22)}px system-ui,sans-serif`;
    ctx.fillText('z', L.cxR + L.rx * (0.9 + k * 0.9), L.cy - L.ry * (0.9 + k * 0.9));
  }
  ctx.globalAlpha = 1;

  // clock
  if (settings.clock) {
    const d = new Date();
    let h = d.getHours(); const m = String(d.getMinutes()).padStart(2, '0');
    if (!settings.h24) h = h % 12 || 12;
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = `rgba(${S.clock},0.78)`;
    ctx.font = `600 ${H * 0.075}px system-ui,-apple-system,sans-serif`;
    ctx.fillText(`${h}:${m}`, W / 2, H * 0.875);
    ctx.fillStyle = `rgba(${S.clock},0.5)`;
    ctx.font = `500 ${H * 0.036}px system-ui,-apple-system,sans-serif`;
    ctx.fillText(d.toLocaleDateString(undefined, { weekday:'short', day:'numeric', month:'short' }),
                 W / 2, H * 0.94);
    ctx.textAlign = 'start';
  }
  ctx.restore();

  // in-page dimming while asleep
  if (moodName === 'asleep') { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H); }
}

/* ---------- loop: 30 fps, 8 fps asleep ---------- */
let last = 0;
function frame(ts) {
  requestAnimationFrame(frame);
  const interval = 1000 / (moodName === 'asleep' ? 8 : 30);
  if (ts - last < interval - 1) return;
  const dt = Math.min(0.1, (ts - last) / 1000 || 0.033);
  last = ts;
  const now = Date.now();
  try {
    update(dt, now); draw(now);
  } catch (e) {
    // A throw mid-draw leaves canvas save()s unrestored, so the leftover transform and clip
    // would skew every later frame. Resizing the canvas resets that state.
    cv.width = cv.width; ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    console.error(e);
  }
}
requestAnimationFrame(frame);

/* ---------- touch ---------- */
let down = null, lpTimer = 0, lastTap = 0, pokes = 0, lastPoke = 0;
cv.addEventListener('pointerdown', (e) => {
  down = { x: e.clientX, y: e.clientY, t: Date.now(), moved: false };
  lpTimer = setTimeout(openPanel, 800);
  lockScreen();
});
cv.addEventListener('pointermove', (e) => {
  if (!down) return;
  if (Math.hypot(e.clientX - down.x, e.clientY - down.y) > 12) { down.moved = true; clearTimeout(lpTimer); }
  if (down.moved) {
    lookT.x = clamp((e.clientX - W / 2) / (W * 0.4), -1, 1);
    lookT.y = clamp((e.clientY - H * 0.38) / (H * 0.4), -1, 1);
    lookHold = Date.now() + 1500;
  }
});
const endPointer = () => {
  clearTimeout(lpTimer);
  if (down && !down.moved && Date.now() - down.t < 300) onTap();
  down = null;
};
cv.addEventListener('pointerup', endPointer);
cv.addEventListener('pointercancel', () => { clearTimeout(lpTimer); down = null; });

function onTap() {
  const now = Date.now();
  if (moodName === 'asleep') { wakeUntil = now + 10000; setTemp('surprised', 1500); return; }
  if (now - lastPoke > 1500) pokes = 0;
  pokes++; lastPoke = now;
  if (pokes >= 6) { setTemp('angry', 4000); pokes = 0; return; }
  if (now - lastTap < 320) { setTemp('love', 4000); burstHearts(); lastTap = 0; return; }
  lastTap = now; setTemp('happy', 3000);
}

/* ---------- settings panel (long-press) ---------- */
const panel = document.getElementById('panel');
const moodsEl = document.getElementById('moods');
['auto', ...PICKABLE].forEach((m) => {
  const b = document.createElement('button'); b.textContent = m; b.dataset.m = m;
  b.onclick = () => { settings.mood = m; tempMood = null; tempNext = null; save(); refresh(); };
  moodsEl.appendChild(b);
});
const optClock = document.getElementById('optClock'), opt24 = document.getElementById('opt24');
const optStyle = document.getElementById('optStyle');
optStyle.onchange = () => { settings.style = optStyle.value; save(); };
optClock.onchange = () => { settings.clock = optClock.checked; save(); };
opt24.onchange = () => { settings.h24 = opt24.checked; save(); };
document.getElementById('close').onclick = () => { panel.hidden = true; };
function refresh() {
  moodsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.m === settings.mood));
  optClock.checked = settings.clock; opt24.checked = settings.h24; optStyle.value = settings.style;
  optCam.checked = settings.camera; optFlip.checked = settings.camFlip;
}
function openPanel() { if (down) down.moved = true; refresh(); panel.hidden = false; }

/* ---------- camera ---------- */
const optCam = document.getElementById('optCam'), optFlip = document.getElementById('optFlip');
const camMsg = document.getElementById('camMsg'), camDot = document.getElementById('camDot');
const CLOSE_SIZE = 0.45, CLOSE_COOLDOWN = 20000;
const LONG_SESSION_MS = 50 * 60000, NUDGE_EVERY_MS = 30 * 60000;
const PHONE_AFTER_MS = 10000, PHONE_COOLDOWN = 120000, PHONE_LOOK_MS = 5000;
let present = false, presentSince = 0, lastClose = -Infinity, lastNudge = -Infinity;
let phoneSince = 0, phoneReacted = false, lastPhone = -Infinity, phoneLookUntil = 0;
let camStarting = false;

const cam = createCamera({
  onLive: (on) => { camDot.hidden = !on; },
  onError: (e) => camFailed(e && e.name === 'NotAllowedError'
    ? 'Camera permission was denied.' : 'Camera or face detection failed to start.'),
  onUpdate: onCamera,
});

function onCamera({ present: p, x, y, size, phone }) {
  const now = Date.now();
  if (p && !present) { presentSince = now; awaySince = 0; setTemp('surprised', 1200, { m: 'excited', ms: 3000 }); }
  else if (!p && present) { awaySince = now; phoneSince = 0; phoneReacted = false; setTemp('sad', 2500); }
  present = p;
  if (!p) return;

  if (size > CLOSE_SIZE && now - lastClose > CLOSE_COOLDOWN) { lastClose = now; setTemp('curious', 2500); }
  if (now - presentSince >= LONG_SESSION_MS && now - lastNudge >= NUDGE_EVERY_MS) {
    lastNudge = now; setTemp('unimpressed', 4000);
  }
  if (phone) {
    if (!phoneSince) phoneSince = now;
    if (!phoneReacted && now - phoneSince >= PHONE_AFTER_MS && now - lastPhone >= PHONE_COOLDOWN) {
      phoneReacted = true; lastPhone = now; phoneLookUntil = now + PHONE_LOOK_MS;
      setTemp('unimpressed', PHONE_LOOK_MS);
    }
  } else {
    if (phoneReacted) setTemp('happy', 2000);
    phoneSince = 0; phoneReacted = false;
  }

  // Front-camera frames aren't mirrored: a person on the screen's right shows up on the image's left.
  const fx = settings.camFlip ? x : 1 - x;
  lookT.x = clamp((2 * fx - 1) * 1.6, -1, 1);
  lookT.y = now < phoneLookUntil ? 0.7 : clamp((2 * y - 1) * 1.6, -1, 1);
  lookHold = now + 1500;
}

function camAllowed() {
  const h = new Date().getHours();
  return settings.camera && document.visibilityState === 'visible' && h >= 7 && h < 22 && moodName !== 'asleep';
}

function stopCamera(userOff) {
  cam.stop();
  present = false; phoneSince = 0; phoneReacted = false;
  awaySince = userOff ? 0 : (awaySince || Date.now());
}

function camFailed(msg) {
  settings.camera = false; save();
  optCam.checked = false;
  stopCamera(true);
  camMsg.textContent = msg;
}

// Only a tap on the toggle may trigger the permission prompt; automatic starts
// (load, unhide, morning) go ahead only if access was already granted.
async function syncCamera(fromTap = false) {
  if (!camAllowed()) { if (cam.running) stopCamera(false); return; }
  if (cam.running || camStarting) return;
  if (!fromTap) {
    camStarting = true;
    let state = 'prompt';
    try { state = (await navigator.permissions.query({ name: 'camera' })).state; } catch (e) {}
    camStarting = false;
    if (state !== 'granted') { camFailed('Turn Camera on again to allow camera access.'); return; }
    if (!camAllowed() || cam.running) return;
  }
  if (!present && !awaySince) awaySince = Date.now();
  cam.start();
}

optCam.onchange = () => {
  camMsg.textContent = '';
  settings.camera = optCam.checked; save();
  if (!settings.camera) { stopCamera(true); return; }
  if (!camAllowed()) { camMsg.textContent = 'The camera stays off from 22:00 to 7:00.'; return; }
  syncCamera(true);
};
optFlip.onchange = () => { settings.camFlip = optFlip.checked; save(); };
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') stopCamera(false); else syncCamera();
});
addEventListener('pagehide', () => stopCamera(false));
setInterval(syncCamera, 5000);
syncCamera();

/* ---------- keep the screen on ---------- */
async function lockScreen() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible') {
      await navigator.wakeLock.request('screen');
    }
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') lockScreen(); });
lockScreen();
