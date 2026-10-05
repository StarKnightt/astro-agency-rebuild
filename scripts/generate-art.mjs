// Generates every image on the site from code: SVG scenes rasterised with sharp,
// plus a light film grain so gradients do not band. Run with `npm run art`.
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const artDir = path.join(root, 'src', 'assets', 'art');
const publicDir = path.join(root, 'public');

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function valueNoise(rand, cells) {
  const v = Array.from({ length: cells + 2 }, () => rand());
  return (t) => {
    const p = Math.max(0, Math.min(1, t)) * cells;
    const i = Math.floor(p);
    const f = p - i;
    const s = f * f * (3 - 2 * f);
    return v[i] * (1 - s) + v[i + 1] * s;
  };
}

function fbm(rand, cells, octaves) {
  const layers = Array.from({ length: octaves }, (_, o) => valueNoise(rand, cells * 2 ** o));
  return (t) => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (const n of layers) {
      sum += n(t) * amp;
      norm += amp;
      amp *= 0.5;
    }
    return sum / norm;
  };
}

function noise2d(seed, cells) {
  const rand = rng(seed);
  const size = cells + 2;
  const grid = Array.from({ length: size * size }, () => rand());
  return (x, y) => {
    const px = x * cells;
    const py = y * cells;
    const ix = Math.floor(px);
    const iy = Math.floor(py);
    const fx = px - ix;
    const fy = py - iy;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const at = (gx, gy) => grid[Math.min(gy, size - 1) * size + Math.min(gx, size - 1)];
    const a = at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx;
    const b = at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx;
    return a * (1 - sy) + b * sy;
  };
}

const f1 = (n) => n.toFixed(1);

function linear(id, [x1, y1, x2, y2], stops) {
  const s = stops
    .map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`)
    .join('');
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">${s}</linearGradient>`;
}

function radial(id, [cx, cy, r], stops) {
  const s = stops
    .map(([o, c, a = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${a}"/>`)
    .join('');
  return `<radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${cy}" r="${r}">${s}</radialGradient>`;
}

const blur = (id, sd) =>
  `<filter id="${id}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${sd}"/></filter>`;

const doc = (w, h, defs, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`;

function vignette(w, h, strength = 0.32, color = '#0b1013') {
  const id = `vig${Math.round(strength * 100)}`;
  return {
    def: radial(id, [w / 2, h / 2, Math.hypot(w, h) * 0.62], [
      [0.55, color, 0],
      [1, color, strength],
    ]),
    body: `<rect width="${w}" height="${h}" fill="url(#${id})"/>`,
  };
}

function ridge({ w, base, peaks, jitter = 0.11, seed = 1, step = 5 }) {
  const rand = rng(seed);
  const coarse = fbm(rand, 9, 3);
  const fine = fbm(rand, 40, 3);
  const maxH = Math.max(...peaks.map((p) => p[1]));
  const pts = [];
  for (let x = 0; x <= w + step; x += step) {
    const cx = Math.min(x, w);
    let y = 0;
    for (const [px, ph, hw, e = 1.2] of peaks) {
      const d = Math.abs(cx - px) / hw;
      if (d < 1) y = Math.max(y, ph * Math.pow(1 - d, e));
    }
    const rough = ((coarse(cx / w) - 0.5) * 2 * 0.75 + (fine(cx / w) - 0.5) * 2 * 0.25) * jitter * maxH;
    y += rough * (0.2 + 0.8 * (y / maxH));
    pts.push([cx, base - Math.max(-2, y)]);
  }
  return pts;
}

const fillBelow = (pts, bottom, w) =>
  `M0 ${bottom} ` + pts.map(([x, y]) => `L${x} ${f1(y)}`).join(' ') + ` L${w} ${bottom} Z`;

const mirrored = (pts, axis, k, w) =>
  `M0 ${axis} ` + pts.map(([x, y]) => `L${x} ${f1(axis + (axis - y) * k)}`).join(' ') + ` L${w} ${axis} Z`;

function gable({ x, y, w, h, roof, fill, extra = '' }) {
  return `<path d="M${x} ${y} L${x} ${y - h} L${x + w / 2} ${y - h - roof} L${x + w} ${y - h} L${x + w} ${y} Z" fill="${fill}" ${extra}/>`;
}

function glowWindow(x, y, w, h, { core = '#ffd99a', glow = '#f2a54c', spread, opacity = 0.6 } = {}) {
  const large = Math.max(w, h) > 90;
  const s = spread ?? (large ? 1.7 : 2.4);
  const gw = w * s;
  const gh = h * s;
  return (
    `<rect x="${f1(x - (gw - w) / 2)}" y="${f1(y - (gh - h) / 2)}" width="${f1(gw)}" height="${f1(gh)}" fill="${glow}" opacity="${large ? opacity * 0.75 : opacity}" filter="url(#${large ? 'glowL' : 'glow'})"/>` +
    `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${core}"/>`
  );
}

function spruce(x, baseY, height, width, fill, rand, { snow = false } = {}) {
  const tiers = 9;
  const left = [];
  const right = [];
  const tips = [];
  for (let i = 0; i < tiers; i++) {
    const t = i / tiers;
    const y = baseY - height * (0.06 + 0.9 * t);
    const half = (width / 2) * Math.pow(1 - t, 0.95) * (0.85 + rand() * 0.3);
    const notch = height * 0.045;
    left.push(`${f1(x - half)} ${f1(y)}`, `${f1(x - half * 0.38)} ${f1(y - notch)}`);
    right.push(`${f1(x + half * 0.38)} ${f1(y - notch)}`, `${f1(x + half)} ${f1(y)}`);
    tips.push([x - half, y], [x + half, y]);
  }
  const trunkW = Math.max(6, width * 0.05);
  let out =
    `<rect x="${f1(x - trunkW / 2)}" y="${f1(baseY - height * 0.1)}" width="${f1(trunkW)}" height="${f1(height * 0.1)}" fill="${fill}"/>` +
    `<path d="M${f1(x - trunkW / 2)} ${f1(baseY - height * 0.06)} L${left.join(' L')} L${x} ${f1(baseY - height)} L${right.reverse().join(' L')} L${f1(x + trunkW / 2)} ${f1(baseY - height * 0.06)} Z" fill="${fill}"/>`;
  if (snow) {
    out += tips
      .filter(() => rand() > 0.35)
      .map(
        ([tx, ty]) =>
          `<ellipse cx="${f1(tx + (tx < x ? 10 : -10))}" cy="${f1(ty - 4)}" rx="${f1(10 + rand() * 12)}" ry="${f1(3 + rand() * 3)}" fill="#f1f4f5" opacity="0.9"/>`,
      )
      .join('');
  }
  return out;
}

function birch(x, top, bottom, w, rand) {
  let out = `<path d="M${f1(x - w / 2)} ${bottom} L${f1(x - w * 0.36)} ${top} L${f1(x + w * 0.36)} ${top} L${f1(x + w / 2)} ${bottom} Z" fill="#e9e6df"/>`;
  out += `<path d="M${f1(x + w * 0.08)} ${bottom} L${f1(x + w * 0.06)} ${top} L${f1(x + w * 0.36)} ${top} L${f1(x + w / 2)} ${bottom} Z" fill="#b9bab4" opacity="0.55"/>`;
  const marks = Math.round((bottom - top) / 38);
  for (let i = 0; i < marks; i++) {
    const y = top + rand() * (bottom - top);
    const t = (y - top) / (bottom - top);
    const width = w * (0.36 + 0.14 * t) * 2;
    const mw = width * (0.18 + rand() * 0.45);
    const mx = x - width / 2 + rand() * (width - mw);
    out += `<rect x="${f1(mx)}" y="${f1(y)}" width="${f1(mw)}" height="${f1(3 + rand() * 9)}" rx="2" fill="#262422" opacity="${f1(0.55 + rand() * 0.4)}"/>`;
  }
  return out;
}

function ripples(rand, { count, x0, x1, y0, y1, color, max = 0.3, minW = 20, maxW = 180 }) {
  let out = '';
  for (let i = 0; i < count; i++) {
    const t = rand();
    const y = y0 + Math.pow(t, 1.6) * (y1 - y0);
    const width = minW + rand() * (maxW - minW) * (0.4 + Math.pow(t, 1.4));
    const x = x0 + rand() * (x1 - x0) - width / 2;
    out += `<rect x="${f1(x)}" y="${f1(y)}" width="${f1(width)}" height="${f1(1.5 + t * 3)}" fill="${color}" opacity="${f1(max * (1 - t * 0.6) * (0.4 + rand() * 0.6))}"/>`;
  }
  return out;
}

const COMMON_DEFS = blur('glow', 18) + blur('glowL', 46) + blur('soft', 6) + blur('haze', 34) + blur('fine', 2.2);

function sceneHero() {
  const w = 1600;
  const h = 2000;
  const horizon = 1230;
  const rand = rng(11);
  const far = ridge({ w, base: horizon, peaks: [[160, 300, 360, 1.1], [560, 430, 420, 1.3], [980, 330, 330, 1.2], [1420, 390, 380, 1.25]], seed: 3 });
  const mid = ridge({ w, base: horizon, peaks: [[40, 190, 360, 0.9], [420, 250, 300, 1.1], [1300, 210, 420, 1], [1650, 260, 300, 1.1]], seed: 9 });
  const vig = vignette(w, h, 0.34);
  const defs =
    COMMON_DEFS +
    linear('sky', [0, 0, 0, horizon], [[0, '#7c92a1'], [0.55, '#b9c2c1'], [0.86, '#e2d3bc'], [1, '#f1d5ad']]) +
    radial('sun', [1150, 1010, 620], [[0, '#fff3dc', 0.9], [0.22, '#fbe2bb', 0.45], [1, '#f1d5ad', 0]]) +
    linear('hazeFar', [0, horizon - 460, 0, horizon], [[0, '#e7d5bb', 0], [1, '#e7d5bb', 0.6]]) +
    linear('hazeMid', [0, horizon - 260, 0, horizon], [[0, '#e1cfb6', 0], [1, '#e1cfb6', 0.32]]) +
    linear('water', [0, horizon, 0, h], [[0, '#e0d0b6'], [0.1, '#aab0aa'], [0.45, '#5f6b6d'], [1, '#232f36']]) +
    linear('land', [0, 1460, 0, h], [[0, '#2c373c'], [1, '#10171a']]) +
    vig.def;
  const body =
    `<rect width="${w}" height="${horizon + 2}" fill="url(#sky)"/>` +
    `<rect width="${w}" height="${horizon}" fill="url(#sun)"/>` +
    `<circle cx="1150" cy="1010" r="36" fill="#fff6e6"/>` +
    `<path d="${fillBelow(far, horizon + 2, w)}" fill="#8b99a0"/>` +
    `<rect y="${horizon - 460}" width="${w}" height="462" fill="url(#hazeFar)"/>` +
    `<path d="${fillBelow(mid, horizon + 2, w)}" fill="#5e6d74"/>` +
    `<rect y="${horizon - 260}" width="${w}" height="262" fill="url(#hazeMid)"/>` +
    `<rect y="${horizon}" width="${w}" height="${h - horizon}" fill="url(#water)"/>` +
    `<path d="${mirrored(far, horizon, 0.5, w)}" fill="#8b99a0" opacity="0.22" filter="url(#fine)"/>` +
    `<path d="${mirrored(mid, horizon, 0.55, w)}" fill="#4b585e" opacity="0.38" filter="url(#fine)"/>` +
    `<ellipse cx="1150" cy="${horizon + 250}" rx="64" ry="270" fill="#ffe5bb" opacity="0.5" filter="url(#glow)"/>` +
    ripples(rand, { count: 170, x0: 780, x1: 1520, y0: horizon + 8, y1: h - 200, color: '#fff0d4', max: 0.42 }) +
    ripples(rand, { count: 120, x0: 0, x1: w, y0: horizon + 30, y1: h - 150, color: '#1c262b', max: 0.22 }) +
    `<rect y="${horizon - 70}" width="${w}" height="150" fill="#f3e3cc" opacity="0.28" filter="url(#haze)"/>` +
    `<path d="M0 1500 C 220 1468, 430 1466, 600 1500 C 820 1540, 1000 1620, 1180 1720 C 1330 1800, 1480 1880, 1600 1930 L1600 ${h} L0 ${h} Z" fill="url(#land)"/>` +
    `<ellipse cx="400" cy="1494" rx="190" ry="26" fill="#f1ad5c" opacity="0.28" filter="url(#soft)"/>` +
    gable({ x: 280, y: 1488, w: 270, h: 150, roof: 118, fill: '#12181b' }) +
    glowWindow(352, 1388, 62, 76) +
    glowWindow(470, 1404, 34, 46, { opacity: 0.45 }) +
    vig.body;
  return { w, h, svg: doc(w, h, defs, body) };
}

function sceneFjordhuset() {
  const w = 2400;
  const h = 1600;
  const horizon = 860;
  const rand = rng(21);
  const far = ridge({ w, base: horizon, peaks: [[200, 250, 420, 1], [760, 340, 520, 1.15], [1500, 300, 480, 1.1], [2150, 360, 460, 1.2]], seed: 21 });
  const vig = vignette(w, h, 0.26);
  const x = 1260;
  const gy = 1128;
  const hw = 600;
  const hh = 250;
  const roof = 170;
  const trees = [
    [130, 1215, 430, 150], [270, 1190, 520, 170], [400, 1180, 380, 140], [540, 1160, 470, 160], [660, 1150, 340, 120],
    [2050, 1105, 470, 160], [2190, 1090, 400, 140], [2320, 1070, 540, 180],
  ];
  const defs =
    COMMON_DEFS +
    linear('sky', [0, 0, 0, horizon], [[0, '#a7bac4'], [0.75, '#cfd9db'], [1, '#e7eae5']]) +
    radial('bright', [1900, 160, 900], [[0, '#ffffff', 0.45], [1, '#ffffff', 0]]) +
    linear('haze', [0, horizon - 380, 0, horizon], [[0, '#e7eae5', 0], [1, '#e7eae5', 0.7]]) +
    linear('water', [0, horizon, 0, 1250], [[0, '#d6dddb'], [1, '#8d9ea2']]) +
    linear('slope', [0, 1080, 0, h], [[0, '#6c7a69'], [0.5, '#3d4a40'], [1, '#1d2722']]) +
    linear('glass', [0, gy - hh - roof, 0, gy], [[0, '#e3e9e8'], [0.6, '#aebec1'], [1, '#7d9195']]) +
    `<clipPath id="house"><path d="M${x} ${gy} L${x} ${gy - hh} L${x + hw / 2} ${gy - hh - roof} L${x + hw} ${gy - hh} L${x + hw} ${gy} Z"/></clipPath>` +
    vig.def;
  let cladding = '';
  for (let cx = x; cx < x + hw; cx += 18) cladding += `<rect x="${cx}" y="${gy - hh - roof}" width="3" height="${hh + roof}" fill="#353b3f" opacity="0.8"/>`;
  const gi = 56;
  const glassPath = `M${x + gi} ${gy - 18} L${x + gi} ${gy - hh + 12} L${x + hw / 2} ${gy - hh - roof + 40} L${x + hw - gi} ${gy - hh + 12} L${x + hw - gi} ${gy - 18} Z`;
  const body =
    `<rect width="${w}" height="${horizon + 2}" fill="url(#sky)"/>` +
    `<rect width="${w}" height="${horizon}" fill="url(#bright)"/>` +
    `<path d="${fillBelow(far, horizon + 2, w)}" fill="#96a6ac"/>` +
    `<rect y="${horizon - 380}" width="${w}" height="382" fill="url(#haze)"/>` +
    `<rect y="${horizon}" width="${w}" height="${h - horizon}" fill="url(#water)"/>` +
    `<path d="${mirrored(far, horizon, 0.45, w)}" fill="#96a6ac" opacity="0.3" filter="url(#fine)"/>` +
    ripples(rand, { count: 140, x0: 0, x1: w, y0: horizon + 6, y1: 1120, color: '#f5f7f5', max: 0.35 }) +
    `<rect y="${horizon - 40}" width="${w}" height="90" fill="#f4f6f3" opacity="0.45" filter="url(#haze)"/>` +
    trees.slice(0, 5).map(([tx, ty, th, tw]) => spruce(tx + 90, ty - 30, th * 0.7, tw * 0.8, '#47584f', rand)).join('') +
    `<path d="M0 1200 C 500 1150, 900 1122, 1200 1126 L 1900 1126 C 2100 1120, 2250 1090, 2400 1060 L2400 ${h} L0 ${h} Z" fill="url(#slope)"/>` +
    `<rect x="${x - 70}" y="${gy}" width="${hw + 160}" height="20" fill="#8a8075"/>` +
    `<rect x="${x - 60}" y="${gy + 20}" width="${hw + 140}" height="26" fill="#1b2420" opacity="0.6" filter="url(#soft)"/>` +
    gable({ x, y: gy, w: hw, h: hh, roof, fill: '#262c2f' }) +
    `<g clip-path="url(#house)">${cladding}</g>` +
    `<path d="${glassPath}" fill="url(#glass)"/>` +
    `<rect x="${x + gi}" y="${gy - 120}" width="${hw - gi * 2}" height="102" fill="#e9c38c" opacity="0.32"/>` +
    [0.25, 0.5, 0.75].map((t) => `<rect x="${f1(x + gi + (hw - gi * 2) * t - 3)}" y="${gy - hh - roof + 40}" width="6" height="${hh + roof - 58}" fill="#1b1f22"/>`).join('') +
    `<rect x="${x + gi}" y="${gy - 132}" width="${hw - gi * 2}" height="6" fill="#1b1f22"/>` +
    `<path d="M${x - 14} ${gy - hh + 6} L${x + hw / 2} ${gy - hh - roof - 8} L${x + hw + 14} ${gy - hh + 6}" fill="none" stroke="#15181a" stroke-width="12"/>` +
    trees.map(([tx, ty, th, tw]) => spruce(tx, ty, th, tw, '#1f2c26', rand)).join('') +
    `<path d="M0 1420 C 600 1380, 1200 1400, 1800 1440 C 2100 1460, 2300 1470, 2400 1470 L2400 ${h} L0 ${h} Z" fill="#17201c" opacity="0.85"/>` +
    vig.body;
  return { w, h, svg: doc(w, h, defs, body) };
}

function sceneSjobuene() {
  const w = 2400;
  const h = 1600;
  const horizon = 930;
  const water = 1068;
  const rand = rng(31);
  const peak = ridge({ w, base: horizon, peaks: [[1250, 720, 760, 1.35], [420, 430, 520, 1.2], [2050, 520, 560, 1.3], [2400, 300, 300, 1]], seed: 33, jitter: 0.06 });
  const vig = vignette(w, h, 0.36, '#070a12');
  const cabins = [
    { x: 500, w: 280, h: 170, roof: 120, fill: '#8b2f25' },
    { x: 850, w: 300, h: 182, roof: 130, fill: '#b5813a' },
    { x: 1220, w: 270, h: 166, roof: 116, fill: '#7f2a22' },
    { x: 1580, w: 310, h: 186, roof: 134, fill: '#8b2f25' },
  ];
  const base = 1010;
  let stars = '';
  for (let i = 0; i < 70; i++) {
    stars += `<circle cx="${f1(rand() * w)}" cy="${f1(rand() * 520)}" r="${f1(0.8 + rand() * 1.4)}" fill="#e8ecf5" opacity="${f1(0.25 + rand() * 0.55)}"/>`;
  }
  const cabinSvg = () =>
    cabins
      .map((c) => {
        let s = '';
        for (let sx = c.x + 18; sx < c.x + c.w; sx += 56) s += `<rect x="${sx}" y="${base}" width="10" height="${water - base}" fill="#151a24"/>`;
        s += gable({ x: c.x, y: base, w: c.w, h: c.h, roof: c.roof, fill: c.fill });
        s += `<path d="M${c.x - 10} ${base - c.h + 4} L${c.x + c.w / 2} ${base - c.h - c.roof - 10} L${c.x + c.w + 10} ${base - c.h + 4}" fill="none" stroke="#dfe3ea" stroke-width="12"/>`;
        s += `<rect x="${c.x}" y="${base - 6}" width="${c.w}" height="6" fill="#1a1d26"/>`;
        s += glowWindow(c.x + c.w * 0.18, base - c.h * 0.72, c.w * 0.16, c.h * 0.26);
        s += glowWindow(c.x + c.w * 0.62, base - c.h * 0.72, c.w * 0.16, c.h * 0.26, { opacity: 0.45 });
        s += `<rect x="${f1(c.x + c.w * 0.42)}" y="${f1(base - c.h * 0.55)}" width="${f1(c.w * 0.14)}" height="${f1(c.h * 0.55)}" fill="#2a1a17"/>`;
        return s;
      })
      .join('');
  const defs =
    COMMON_DEFS +
    linear('sky', [0, 0, 0, horizon], [[0, '#222e46'], [0.45, '#42516d'], [0.82, '#8b8aa1'], [1, '#c6a79f']]) +
    linear('mountain', [0, 180, 0, horizon], [[0, '#c4cbd9'], [0.38, '#7b88a0'], [1, '#2c384f']]) +
    linear('hazeLow', [0, horizon - 200, 0, horizon], [[0, '#8b8aa1', 0], [1, '#8b8aa1', 0.55]]) +
    linear('water', [0, horizon, 0, h], [[0, '#727a93'], [0.35, '#3a4560'], [1, '#121827']]) +
    `<clipPath id="below"><rect y="${water}" width="${w}" height="${h - water}"/></clipPath>` +
    vig.def;
  const body =
    `<rect width="${w}" height="${horizon + 2}" fill="url(#sky)"/>` +
    stars +
    `<path d="${fillBelow(peak, horizon + 2, w)}" fill="url(#mountain)"/>` +
    `<rect y="${horizon - 200}" width="${w}" height="202" fill="url(#hazeLow)"/>` +
    `<rect y="${horizon}" width="${w}" height="${h - horizon}" fill="url(#water)"/>` +
    `<path d="${mirrored(peak, horizon, 0.42, w)}" fill="#3b4762" opacity="0.55" filter="url(#fine)"/>` +
    ripples(rand, { count: 160, x0: 0, x1: w, y0: horizon + 6, y1: h - 60, color: '#c9cfe0', max: 0.22 }) +
    `<path d="M300 ${water - 8} C 700 ${water - 30}, 1300 ${water - 26}, 2100 ${water - 6} L2100 ${water + 6} L300 ${water + 6} Z" fill="#141925"/>` +
    `<g clip-path="url(#below)" opacity="0.38" filter="url(#fine)"><g transform="translate(0 ${water * 2}) scale(1 -1)">${cabinSvg()}</g></g>` +
    cabins
      .map((c) => `<rect x="${f1(c.x + c.w * 0.16)}" y="${water + 10}" width="${f1(c.w * 0.68)}" height="220" fill="#f2a54c" opacity="0.18" filter="url(#soft)"/>`)
      .join('') +
    ripples(rand, { count: 90, x0: 520, x1: 1880, y0: water + 8, y1: water + 300, color: '#f6c27a', max: 0.4, maxW: 120 }) +
    cabinSvg() +
    vig.body;
  return { w, h, svg: doc(w, h, defs, body) };
}

function sceneBjorkly() {
  const w = 2400;
  const h = 1600;
  const rand = rng(41);
  const vig = vignette(w, h, 0.4, '#05080c');
  const bx = 290;
  const bw = 1820;
  const top = 476;
  const floor = 1110;
  let books = '';
  for (const shelfY of [880, 970, 1060]) {
    let x = bx + 30;
    while (x < bx + bw - 40) {
      if (x > 1040 && x < 1360) {
        x = 1360;
        continue;
      }
      const bwid = 10 + rand() * 18;
      const bh = 40 + rand() * 34;
      const tone = ['#7a4a2a', '#5c3a24', '#9b5f34', '#3f2a1e', '#b1733f'][Math.floor(rand() * 5)];
      books += `<rect x="${f1(x)}" y="${f1(shelfY - bh)}" width="${f1(bwid)}" height="${f1(bh)}" fill="${tone}" opacity="0.9"/>`;
      x += bwid + 2 + (rand() > 0.9 ? 40 : 0);
    }
    books += `<rect x="${bx}" y="${shelfY}" width="${bw}" height="8" fill="#4a2f1d"/>`;
  }
  let slats = '';
  for (let x = bx; x < bx + bw; x += 24) {
    if (x > 1060 && x < 1340) continue;
    const sw = 8 + rand() * 3;
    slats += `<rect x="${f1(x)}" y="${top}" width="${f1(sw)}" height="${floor - top}" fill="#3a291d"/>`;
  }
  let paving = '';
  let py = floor + 26;
  let gap = 14;
  while (py < h) {
    paving += `<rect x="0" y="${f1(py)}" width="${w}" height="2" fill="#2a323c" opacity="0.7"/>`;
    gap *= 1.22;
    py += gap;
  }
  const defs =
    COMMON_DEFS +
    linear('sky', [0, 0, 0, floor], [[0, '#0d1522'], [0.6, '#1d2a40'], [1, '#34445e']]) +
    linear('interior', [0, top, 0, floor], [[0, '#ffdca2'], [0.5, '#f7bd73'], [1, '#e89a4f']]) +
    linear('plaza', [0, floor, 0, h], [[0, '#161c24'], [1, '#090c11']]) +
    linear('reflect', [0, floor, 0, floor + 420], [[0, '#f4b263', 0.32], [1, '#f4b263', 0]]) +
    vig.def;
  const body =
    `<rect width="${w}" height="${floor}" fill="url(#sky)"/>` +
    `<rect x="${bx - 120}" y="${top - 80}" width="${bw + 240}" height="${floor - top + 160}" fill="#f3b061" opacity="0.2" filter="url(#haze)"/>` +
    spruce(110, floor, 420, 170, '#0a0f15', rand) +
    spruce(2290, floor, 470, 180, '#0a0f15', rand) +
    spruce(2180, floor, 330, 130, '#0d131a', rand) +
    `<rect x="${bx}" y="${top}" width="${bw}" height="${floor - top}" fill="url(#interior)"/>` +
    `<rect x="${bx}" y="760" width="${bw}" height="26" fill="#5a3a22"/>` +
    books +
    `<rect x="1060" y="${top}" width="280" height="${floor - top}" fill="#ffe2b0" opacity="0.35"/>` +
    `<rect x="1196" y="800" width="8" height="${floor - 800}" fill="#2a2420"/>` +
    slats +
    `<rect x="230" y="430" width="1940" height="46" fill="#1a2029"/>` +
    `<rect x="${bx}" y="${floor}" width="${bw}" height="14" fill="#1a2029"/>` +
    `<rect width="${w}" height="${h - floor}" y="${floor}" fill="url(#plaza)"/>` +
    `<rect x="${bx}" y="${floor + 14}" width="${bw}" height="420" fill="url(#reflect)" filter="url(#soft)"/>` +
    paving +
    vig.body;
  return { w, h, svg: doc(w, h, defs, body) };
}

function sceneNaustet() {
  const w = 2400;
  const h = 1600;
  const horizon = 900;
  const rand = rng(51);
  const vig = vignette(w, h, 0.22, '#1b2224');
  let farTrees = '';
  for (let x = -20; x < w + 40; x += 18 + rand() * 26) farTrees += spruce(x, horizon + 4, 40 + rand() * 70, 26 + rand() * 20, '#9aa6a4', rand);
  let nearTrees = '';
  for (let x = 1500; x < w + 40; x += 30 + rand() * 40) nearTrees += spruce(x, horizon + 10, 70 + rand() * 90, 40 + rand() * 26, '#7f8d8a', rand);
  let logs = '';
  for (let y = 896; y < 1090; y += 16) logs += `<rect x="840" y="${y}" width="420" height="3" fill="#3d352e"/>`;
  let posts = '';
  for (let x = 40; x < 1500; x += 120) posts += `<rect x="${x}" y="1112" width="16" height="64" fill="#22201d"/>`;
  let smoke = '';
  for (let i = 0; i < 9; i++) {
    const t = i / 8;
    smoke += `<ellipse cx="${f1(1190 + t * 260 + rand() * 30)}" cy="${f1(700 - t * 380)}" rx="${f1(40 + t * 120)}" ry="${f1(24 + t * 50)}" fill="#ffffff" opacity="${f1(0.4 - t * 0.3)}" filter="url(#haze)"/>`;
  }
  const defs =
    COMMON_DEFS +
    linear('sky', [0, 0, 0, horizon], [[0, '#c4cdd0'], [1, '#e9ece9']]) +
    linear('lake', [0, horizon, 0, h], [[0, '#e1e5e2'], [0.5, '#bcc6c5'], [1, '#9daaaa']]) +
    linear('shore', [0, 1180, 0, h], [[0, '#626d60'], [1, '#2f382f']]) +
    linear('naustReflect', [0, 1114, 0, 1314], [[0, '#2b2623', 0.32], [1, '#2b2623', 0]]) +
    vig.def;
  const body =
    `<rect width="${w}" height="${horizon + 2}" fill="url(#sky)"/>` +
    farTrees +
    `<rect y="${horizon - 60}" width="${w}" height="120" fill="#eef1ee" opacity="0.55" filter="url(#haze)"/>` +
    nearTrees +
    `<rect y="${horizon}" width="${w}" height="${h - horizon}" fill="url(#lake)"/>` +
    `<g opacity="0.18" filter="url(#fine)"><g transform="translate(0 ${horizon * 2 + 8}) scale(1 -1)">${farTrees}</g></g>` +
    ripples(rand, { count: 120, x0: 0, x1: w, y0: horizon + 6, y1: h - 80, color: '#ffffff', max: 0.4 }) +
    `<rect y="${horizon - 10}" width="${w}" height="80" fill="#f2f4f2" opacity="0.5" filter="url(#haze)"/>` +
    `<rect x="830" y="1114" width="440" height="200" fill="url(#naustReflect)" filter="url(#soft)"/>` +
    `<rect x="0" y="1116" width="1500" height="10" fill="#2a2724" opacity="0.14" filter="url(#fine)"/>` +
    posts +
    `<rect x="-20" y="1090" width="1520" height="24" fill="#2a2724"/>` +
    smoke +
    `<rect x="1180" y="738" width="16" height="120" fill="#151515"/>` +
    `<rect x="840" y="880" width="420" height="210" fill="#2b2623"/>` +
    logs +
    `<path d="M816 884 L1050 716 L1284 884 Z" fill="#1c1b1a"/>` +
    glowWindow(1010, 958, 70, 132, { opacity: 0.55 }) +
    glowWindow(882, 940, 52, 40, { opacity: 0.4 }) +
    `<path d="M0 1260 C 260 1220, 520 1250, 700 1330 C 860 1400, 1000 1500, 1100 ${h} L0 ${h} Z" fill="url(#shore)"/>` +
    birch(150, -10, h, 48, rand) +
    birch(320, -10, 1420, 34, rand) +
    birch(450, 120, 1330, 26, rand) +
    vig.body;
  return { w, h, svg: doc(w, h, defs, body) };
}

function sceneHomes() {
  const w = 2400;
  const h = 1600;
  const rand = rng(61);
  const hills = ridge({ w, base: 1000, peaks: [[300, 140, 700, 0.7], [1300, 190, 820, 0.8], [2200, 150, 700, 0.7]], seed: 62, jitter: 0.02 });
  const vig = vignette(w, h, 0.2, '#2a3540');
  const x = 930;
  const gy = 1110;
  const hw = 640;
  const hh = 270;
  const roof = 230;
  let farTrees = '';
  for (let tx = 0; tx < w; tx += 26 + rand() * 50) farTrees += spruce(tx, 1004, 40 + rand() * 60, 26 + rand() * 14, '#6c7b7b', rand);
  let drifts = '';
  for (let i = 0; i < 14; i++) {
    drifts += `<ellipse cx="${f1(rand() * w)}" cy="${f1(1060 + rand() * 520)}" rx="${f1(180 + rand() * 340)}" ry="${f1(18 + rand() * 40)}" fill="${rand() > 0.5 ? '#ffffff' : '#cfd9df'}" opacity="0.55" filter="url(#haze)"/>`;
  }
  const left = [[180, 1190, 440, 170], [320, 1170, 540, 190], [470, 1180, 400, 150], [610, 1150, 470, 170]];
  const right = [[1880, 1160, 500, 180], [2010, 1180, 410, 160], [2160, 1150, 580, 200], [2290, 1185, 440, 170]];
  const defs =
    COMMON_DEFS +
    linear('sky', [0, 0, 0, 1000], [[0, '#bccad4'], [1, '#e8ecec']]) +
    linear('snow', [0, 1000, 0, h], [[0, '#f4f6f6'], [1, '#d9e1e6']]) +
    vig.def;
  const body =
    `<rect width="${w}" height="1004" fill="url(#sky)"/>` +
    `<path d="${fillBelow(hills, 1004, w)}" fill="#d5dee3"/>` +
    farTrees +
    `<rect y="1000" width="${w}" height="${h - 1000}" fill="url(#snow)"/>` +
    drifts +
    `<path d="M${x + hw} ${gy} L${x + hw + 620} ${gy + 90} L${x + hw + 300} ${gy + 120} L${x + 120} ${gy + 30} Z" fill="#aebfca" opacity="0.55" filter="url(#soft)"/>` +
    `<ellipse cx="${x + 120}" cy="${gy + 40}" rx="220" ry="34" fill="#f3b468" opacity="0.32" filter="url(#glow)"/>` +
    `<ellipse cx="${x + 400}" cy="${gy + 46}" rx="150" ry="26" fill="#f3b468" opacity="0.26" filter="url(#glow)"/>` +
    `<rect x="${x + 470}" y="${gy - hh - roof + 70}" width="44" height="120" fill="#1b1f21"/>` +
    `<rect x="${x + 464}" y="${gy - hh - roof + 62}" width="56" height="14" rx="6" fill="#f5f7f8"/>` +
    gable({ x, y: gy, w: hw, h: hh, roof, fill: '#1b1f21' }) +
    `<path d="M${x - 16} ${gy - hh + 6} L${x + hw / 2} ${gy - hh - roof - 18} L${x + hw + 16} ${gy - hh + 6} L${x + hw + 4} ${gy - hh + 14} L${x + hw / 2} ${gy - hh - roof + 2} L${x - 4} ${gy - hh + 14} Z" fill="#f5f7f8"/>` +
    glowWindow(x + 60, gy - 160, 200, 120) +
    glowWindow(x + 400, gy - 210, 70, 170, { opacity: 0.5 }) +
    glowWindow(x + 290, gy - hh - 70, 60, 60, { opacity: 0.45 }) +
    [...left, ...right].map(([tx, ty, th, tw]) => spruce(tx, ty, th, tw, '#1f2d29', rand, { snow: true })).join('') +
    `<path d="M0 1450 C 500 1420, 1100 1440, 1600 1470 C 1900 1490, 2200 1480, 2400 1470 L2400 ${h} L0 ${h} Z" fill="#ffffff" opacity="0.5"/>` +
    vig.body;
  return { w, h, svg: doc(w, h, defs, body) };
}

function scenePublic() {
  const w = 2400;
  const h = 1600;
  const rand = rng(71);
  const vig = vignette(w, h, 0.3, '#120d09');
  let slats = '';
  let slatDefs = '';
  for (let x = -20; x < w + 20; x += 68) {
    const tone = 0.9 + rand() * 0.2;
    const id = `sl${x + 20}`;
    const c1 = `rgb(${Math.round(201 * tone)},${Math.round(156 * tone)},${Math.round(110 * tone)})`;
    const c2 = `rgb(${Math.round(160 * tone)},${Math.round(114 * tone)},${Math.round(76 * tone)})`;
    slatDefs += `<linearGradient id="${id}" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${c1}"/><stop offset="1" stop-color="${c2}"/></linearGradient>`;
    slats += `<rect x="${x}" y="170" width="46" height="${h - 170}" fill="url(#${id})"/>`;
    for (let g = 0; g < 4; g++) {
      const gx = x + 6 + rand() * 34;
      slats += `<rect x="${f1(gx)}" y="170" width="${f1(1 + rand() * 1.5)}" height="${h - 170}" fill="#6b4a30" opacity="${f1(0.15 + rand() * 0.2)}"/>`;
    }
  }
  const defs =
    COMMON_DEFS +
    slatDefs +
    linear('glassBack', [0, 170, 0, h], [[0, '#22282d'], [1, '#3a3530']]) +
    linear('light', [0, 0, w, h], [[0, '#fff4df', 0.28], [0.5, '#fff4df', 0.06], [1, '#000000', 0.2]]) +
    linear('soffit', [0, 0, 0, 170], [[0, '#dcd9d2'], [1, '#c3bfb6']]) +
    vig.def;
  const body =
    `<rect width="${w}" height="${h}" fill="url(#glassBack)"/>` +
    slats +
    `<path d="M0 170 L${w} 170 L${w} 620 L0 330 Z" fill="#1e1712" opacity="0.38"/>` +
    `<path d="M0 330 L${w} 620 L${w} 700 L0 400 Z" fill="#1e1712" opacity="0.12"/>` +
    `<rect width="${w}" height="${h}" fill="url(#light)"/>` +
    `<rect width="${w}" height="170" fill="url(#soffit)"/>` +
    `<rect y="164" width="${w}" height="10" fill="#8c8780"/>` +
    vig.body;
  return { w, h, svg: doc(w, h, defs, body) };
}

function sceneInterior() {
  const w = 2400;
  const h = 1600;
  const bx0 = 560;
  const bx1 = 1840;
  const by0 = 330;
  const by1 = 1150;
  const vp = [1200, 760];
  const win = { x: 820, y: 430, w: 760, h: 570 };
  const view = ridge({ w: win.w, base: 280, peaks: [[120, 120, 220, 1], [420, 170, 260, 1.1], [700, 110, 200, 1]], seed: 83 });
  let boards = '';
  for (let i = -10; i <= 26; i++) {
    const bx = bx0 + ((bx1 - bx0) / 16) * i;
    const ex = vp[0] + (bx - vp[0]) * ((h - vp[1]) / (by1 - vp[1]));
    boards += `<path d="M${f1(bx)} ${by1} L${f1(ex)} ${h}" stroke="#7d5a3a" stroke-width="2.5" opacity="0.45"/>`;
  }
  const patch = `M${win.x - 40} ${by1} L${win.x + win.w + 40} ${by1} L${win.x + win.w + 330} ${h - 80} L${win.x - 160} ${h - 80} Z`;
  const vig = vignette(w, h, 0.28, '#1a1410');
  const defs =
    COMMON_DEFS +
    linear('floor', [0, by1, 0, h], [[0, '#a98058'], [1, '#8d6743']]) +
    linear('backWall', [0, by0, 0, by1], [[0, '#ebe7df'], [1, '#d9d4ca']]) +
    linear('leftWall', [0, 0, bx0, 0], [[0, '#bdb7ad'], [1, '#d8d3ca']]) +
    linear('rightWall', [w, 0, bx1, 0], [[0, '#b4aea4'], [1, '#d0cac0']]) +
    linear('ceiling', [0, 0, 0, by0], [[0, '#e3e0d9'], [1, '#f0eee9']]) +
    linear('viewSky', [0, 0, 0, 300], [[0, '#a9bcc6'], [1, '#e5e3d6']]) +
    linear('viewWater', [0, 280, 0, win.h], [[0, '#c9d0cc'], [1, '#7f9094']]) +
    `<clipPath id="win"><rect x="${win.x}" y="${win.y}" width="${win.w}" height="${win.h}"/></clipPath>` +
    `<clipPath id="floorClip"><path d="M0 ${h} L${bx0} ${by1} L${bx1} ${by1} L${w} ${h} Z"/></clipPath>` +
    vig.def;
  const body =
    `<path d="M0 0 L${w} 0 L${bx1} ${by0} L${bx0} ${by0} Z" fill="url(#ceiling)"/>` +
    `<path d="M0 0 L${bx0} ${by0} L${bx0} ${by1} L0 ${h} Z" fill="url(#leftWall)"/>` +
    `<path d="M${w} 0 L${bx1} ${by0} L${bx1} ${by1} L${w} ${h} Z" fill="url(#rightWall)"/>` +
    `<rect x="${bx0}" y="${by0}" width="${bx1 - bx0}" height="${by1 - by0}" fill="url(#backWall)"/>` +
    `<g clip-path="url(#win)"><g transform="translate(${win.x} ${win.y})">` +
    `<rect width="${win.w}" height="300" fill="url(#viewSky)"/>` +
    `<path d="${fillBelow(view, 300, win.w)}" fill="#8e9da3"/>` +
    `<rect y="280" width="${win.w}" height="${win.h - 280}" fill="url(#viewWater)"/>` +
    `</g></g>` +
    `<rect x="${win.x - 16}" y="${win.y - 16}" width="${win.w + 32}" height="${win.h + 32}" fill="none" stroke="#2a2724" stroke-width="18"/>` +
    `<rect x="${win.x + win.w / 2 - 6}" y="${win.y}" width="12" height="${win.h}" fill="#2a2724"/>` +
    `<path d="M0 ${h} L${bx0} ${by1} L${bx1} ${by1} L${w} ${h} Z" fill="url(#floor)"/>` +
    `<g clip-path="url(#floorClip)">${boards}</g>` +
    `<path d="${patch}" fill="#fff0cf" opacity="0.5" filter="url(#soft)"/>` +
    `<path d="M${win.x + win.w / 2 - 6} ${by1} L${win.x + win.w / 2 + 6} ${by1} L${win.x + win.w / 2 + 120} ${h - 80} L${win.x + win.w / 2 + 92} ${h - 80} Z" fill="#8a6541" opacity="0.5" filter="url(#fine)"/>` +
    `<rect x="${win.x - 20}" y="${by1 - 90}" width="${win.w + 40}" height="40" fill="#5b4330"/>` +
    `<rect x="${win.x}" y="${by1 - 50}" width="18" height="50" fill="#4a3627"/><rect x="${win.x + win.w - 18}" y="${by1 - 50}" width="18" height="50" fill="#4a3627"/>` +
    `<rect x="${bx0}" y="${by1 - 14}" width="${bx1 - bx0}" height="14" fill="#cfc9be"/>` +
    `<rect x="${win.x + 60}" y="${by1 - 150}" width="120" height="60" fill="#2f4a40" opacity="0.9"/>` +
    vig.body;
  return { w, h, svg: doc(w, h, defs, body), chroma: '4:4:4' };
}

function sceneSunPath() {
  const w = 2400;
  const h = 1600;
  const hz = 1180;
  const cx = 1200;
  const arc = (rx, ry) => `M${cx - rx} ${hz} A${rx} ${ry} 0 0 1 ${cx + rx} ${hz}`;
  const dots = (rx, ry, n, r, op) => {
    let s = '';
    for (let i = 1; i < n; i++) {
      const a = Math.PI - (Math.PI * i) / n;
      s += `<circle cx="${f1(cx + rx * Math.cos(a))}" cy="${f1(hz - ry * Math.sin(a))}" r="${r}" fill="#1f4a3d" opacity="${op}"/>`;
    }
    return s;
  };
  const land = ridge({ w, base: hz, peaks: [[300, 90, 420, 0.8], [1900, 120, 520, 0.9]], seed: 91, jitter: 0.04 });
  const defs =
    COMMON_DEFS +
    linear('bg', [0, 0, 0, hz], [[0, '#e3e8e4'], [1, '#eef0ea']]) +
    linear('ground', [0, hz, 0, h], [[0, '#d2d9d3'], [1, '#c3ccc5']]) +
    radial('sunGlow', [cx, 1030, 260], [[0, '#f2b45e', 0.55], [1, '#f2b45e', 0]]);
  const body =
    `<rect width="${w}" height="${h}" fill="url(#bg)"/>` +
    `<path d="${fillBelow(land, hz + 1, w)}" fill="#dbe1dc"/>` +
    `<rect y="${hz}" width="${w}" height="${h - hz}" fill="url(#ground)"/>` +
    `<path d="${arc(1000, 820)}" fill="none" stroke="#1f4a3d" stroke-width="4" stroke-linecap="round" stroke-dasharray="1 18" opacity="0.5"/>` +
    `<path d="${arc(860, 560)}" fill="none" stroke="#1f4a3d" stroke-width="3" stroke-dasharray="14 16" opacity="0.4"/>` +
    `<path d="${arc(560, 150)}" fill="none" stroke="#1f4a3d" stroke-width="5"/>` +
    dots(1000, 820, 12, 6, 0.35) +
    dots(860, 560, 10, 7, 0.45) +
    dots(560, 150, 8, 8, 0.9) +
    `<rect x="${cx - 300}" y="730" width="600" height="600" fill="url(#sunGlow)"/>` +
    `<circle cx="${cx}" cy="1030" r="34" fill="#e9a24a"/>` +
    `<path d="M980 ${hz + 4} L1150 ${hz + 4} L1990 ${hz + 120} L1560 ${hz + 120} Z" fill="#1f4a3d" opacity="0.16"/>` +
    gable({ x: 990, y: hz + 4, w: 160, h: 92, roof: 70, fill: '#1f2a26' }) +
    `<rect y="${hz}" width="${w}" height="3" fill="#1f4a3d"/>`;
  return { w, h, svg: doc(w, h, defs, body), grain: 9, chroma: '4:4:4' };
}

function sceneTimber() {
  const w = 2400;
  const h = 1600;
  const rand = rng(101);
  const n = 11;
  const bw = w / n;
  const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const weathered = [143, 145, 139];
  const fresh = [196, 148, 100];
  let out = '';
  for (let i = 0; i < n; i++) {
    const t = Math.pow(i / (n - 1), 1.3);
    const tone = 0.93 + rand() * 0.12;
    const base = mix(weathered, fresh, t).map((v) => Math.max(0, Math.min(255, Math.round(v * tone))));
    const dark = base.map((v) => Math.round(v * 0.72));
    const x = i * bw;
    out += `<rect x="${f1(x)}" y="0" width="${f1(bw)}" height="${h}" fill="rgb(${base.join(',')})"/>`;
    for (let j = 0; j < 34; j++) {
      const gx = x + ((j + rand()) / 34) * bw;
      const amp = 2 + rand() * 9;
      const freq = 0.002 + rand() * 0.004;
      const ph = rand() * Math.PI * 2;
      let d = `M${f1(gx)} 0`;
      for (let y = 40; y <= h; y += 40) d += ` L${f1(gx + Math.sin(y * freq + ph) * amp)} ${y}`;
      out += `<path d="${d}" fill="none" stroke="rgb(${dark.join(',')})" stroke-width="${f1(1 + rand() * 1.6)}" opacity="${f1(0.25 + rand() * 0.3)}"/>`;
    }
    const knots = Math.floor(rand() * 2.2);
    for (let k = 0; k < knots; k++) {
      const kx = x + bw * (0.25 + rand() * 0.5);
      const ky = 120 + rand() * (h - 240);
      const rx = 10 + rand() * 14;
      const ry = rx * (1.4 + rand() * 0.6);
      out += `<ellipse cx="${f1(kx)}" cy="${f1(ky)}" rx="${f1(rx)}" ry="${f1(ry)}" fill="rgb(${dark.map((v) => Math.round(v * 0.75)).join(',')})" opacity="0.85"/>`;
      for (let r = 1; r <= 3; r++) out += `<ellipse cx="${f1(kx)}" cy="${f1(ky)}" rx="${f1(rx + r * 9)}" ry="${f1(ry + r * 16)}" fill="none" stroke="rgb(${dark.join(',')})" stroke-width="1.6" opacity="${f1(0.35 - r * 0.08)}"/>`;
    }
    out += `<rect x="${f1(x)}" y="0" width="${f1(bw * 0.22)}" height="${h}" fill="#ffffff" opacity="0.06"/>`;
    out += `<rect x="${f1(x + bw * 0.78)}" y="0" width="${f1(bw * 0.22)}" height="${h}" fill="#000000" opacity="0.08"/>`;
    out += `<rect x="${f1(x + bw - 4)}" y="0" width="8" height="${h}" fill="#2a241e"/>`;
  }
  const vig = vignette(w, h, 0.3, '#14100c');
  const defs = linear('light', [0, 0, w, h], [[0, '#fff2dc', 0.22], [0.55, '#fff2dc', 0], [1, '#000000', 0.18]]) + vig.def;
  const body = out + `<rect width="${w}" height="${h}" fill="url(#light)"/>` + vig.body;
  return { w, h, svg: doc(w, h, defs, body), grain: 8 };
}

function sceneContours() {
  const w = 2400;
  const h = 1600;
  const step = 6;
  const noise = noise2d(7, 5);
  const hills = [
    [700, 520, 420, 360, 1],
    [1650, 980, 520, 380, 0.85],
    [1900, 360, 300, 260, 0.55],
    [400, 1250, 300, 240, 0.4],
  ];
  const height = (x, y) => {
    let v = 0;
    for (const [hx, hy, sx, sy, a] of hills) v += a * Math.exp(-((x - hx) ** 2 / (2 * sx * sx) + (y - hy) ** 2 / (2 * sy * sy)));
    return v + 0.22 * noise(x / w, y / h);
  };
  const cols = Math.ceil(w / step) + 1;
  const rows = Math.ceil(h / step) + 1;
  const field = new Float32Array(cols * rows);
  let min = Infinity;
  let max = -Infinity;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const v = height(i * step, j * step);
      field[j * cols + i] = v;
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const levels = 22;
  let minor = '';
  let major = '';
  for (let l = 1; l < levels; l++) {
    const iso = min + ((max - min) * l) / levels;
    let d = '';
    for (let j = 0; j < rows - 1; j++) {
      for (let i = 0; i < cols - 1; i++) {
        const a = field[j * cols + i];
        const b = field[j * cols + i + 1];
        const c = field[(j + 1) * cols + i + 1];
        const e = field[(j + 1) * cols + i];
        const code = (a > iso ? 8 : 0) | (b > iso ? 4 : 0) | (c > iso ? 2 : 0) | (e > iso ? 1 : 0);
        if (code === 0 || code === 15) continue;
        const x = i * step;
        const y = j * step;
        const lerp = (p, q) => (iso - p) / (q - p);
        const top = [x + step * lerp(a, b), y];
        const right = [x + step, y + step * lerp(b, c)];
        const bottom = [x + step * lerp(e, c), y + step];
        const left = [x, y + step * lerp(a, e)];
        const seg = (p, q) => {
          d += `M${f1(p[0])} ${f1(p[1])}L${f1(q[0])} ${f1(q[1])}`;
        };
        switch (code) {
          case 1: case 14: seg(left, bottom); break;
          case 2: case 13: seg(bottom, right); break;
          case 3: case 12: seg(left, right); break;
          case 4: case 11: seg(top, right); break;
          case 5: seg(left, top); seg(bottom, right); break;
          case 6: case 9: seg(top, bottom); break;
          case 7: case 8: seg(left, top); break;
          case 10: seg(left, bottom); seg(top, right); break;
        }
      }
    }
    if (l % 5 === 0) major += d;
    else minor += d;
  }
  const defs = linear('bg', [0, 0, w, h], [[0, '#edf0eb'], [1, '#e1e6e0']]);
  const body =
    `<rect width="${w}" height="${h}" fill="url(#bg)"/>` +
    `<path d="${minor}" fill="none" stroke="#7f8d85" stroke-width="1.6" opacity="0.75"/>` +
    `<path d="${major}" fill="none" stroke="#4f5e56" stroke-width="3"/>` +
    `<path d="M-20 1480 C 300 1380, 520 1180, 760 1120 C 980 1060, 1080 900, 1210 820 C 1330 750, 1500 760, 1620 700 C 1760 630, 1900 640, 2420 560" fill="none" stroke="#7d9fa6" stroke-width="7" stroke-linecap="round" opacity="0.8"/>` +
    `<path d="M0 300 C 400 380, 800 700, 1150 780 C 1300 815, 1400 860, 1460 900" fill="none" stroke="#9c9282" stroke-width="6" stroke-dasharray="22 16" stroke-linecap="round"/>` +
    `<circle cx="1480" cy="910" r="130" fill="none" stroke="#1f4a3d" stroke-width="4" stroke-dasharray="16 14"/>` +
    `<rect x="1452" y="882" width="56" height="56" fill="#1f4a3d" transform="rotate(14 1480 910)"/>`;
  return { w, h, svg: doc(w, h, defs, body), grain: 5, chroma: '4:4:4' };
}

function sceneMaterials() {
  const w = 2400;
  const h = 1600;
  const rand = rng(121);
  const shadow = (x, y, sw, sh, rot) =>
    `<rect x="${x + 26}" y="${y + 34}" width="${sw}" height="${sh}" fill="#3d4640" opacity="0.32" filter="url(#glow)" transform="rotate(${rot} ${x + sw / 2} ${y + sh / 2})"/>`;
  let speckle = '';
  for (let i = 0; i < 3200; i++) {
    speckle += `<circle cx="${f1(260 + rand() * 900)}" cy="${f1(300 + rand() * 620)}" r="${f1(0.6 + rand() * 1.6)}" fill="${rand() > 0.5 ? '#7b7d78' : '#babbb6'}" opacity="${f1(0.25 + rand() * 0.35)}"/>`;
  }
  let grain = '';
  for (let j = 0; j < 26; j++) {
    const gy = 270 + (j + rand()) * (300 / 26);
    let d = `M1250 ${f1(gy)}`;
    for (let x = 1290; x <= 2010; x += 40) d += ` L${x} ${f1(gy + Math.sin(x * 0.006 + j) * 4)}`;
    grain += `<path d="${d}" fill="none" stroke="#8e6440" stroke-width="${f1(1 + rand() * 1.4)}" opacity="${f1(0.3 + rand() * 0.3)}"/>`;
  }
  let fibres = '';
  for (let i = 0; i < 900; i++) {
    const fx = 1350 + rand() * 520;
    const fy = 700 + rand() * 520;
    const a = rand() * Math.PI;
    fibres += `<path d="M${f1(fx)} ${f1(fy)} l${f1(Math.cos(a) * 10)} ${f1(Math.sin(a) * 10)}" stroke="${rand() > 0.5 ? '#36594d' : '#1f3b32'}" stroke-width="1.4" opacity="0.6"/>`;
  }
  const vig = vignette(w, h, 0.22, '#2c332f');
  const defs =
    COMMON_DEFS +
    linear('table', [0, 0, w, h], [[0, '#e6e9e5'], [1, '#d3d9d4']]) +
    linear('stone', [260, 300, 1160, 920], [[0, '#a9aaa5'], [1, '#8b8d88']]) +
    linear('wood', [1250, 260, 1250, 560], [[0, '#c99a69'], [1, '#b07f51']]) +
    linear('glassPane', [520, 1000, 1080, 1380], [[0, '#ffffff', 0.55], [0.5, '#cfe0dd', 0.3], [1, '#ffffff', 0.5]]) +
    `<clipPath id="felt"><rect x="1350" y="700" width="520" height="520"/></clipPath>` +
    vig.def;
  const body =
    `<rect width="${w}" height="${h}" fill="url(#table)"/>` +
    shadow(260, 300, 900, 620, -3) +
    `<g transform="rotate(-3 710 610)"><rect x="260" y="300" width="900" height="620" fill="url(#stone)"/>${speckle}<rect x="260" y="300" width="900" height="8" fill="#ffffff" opacity="0.14"/></g>` +
    shadow(1250, 260, 760, 300, 4) +
    `<g transform="rotate(4 1630 410)"><rect x="1250" y="260" width="760" height="300" fill="url(#wood)"/>${grain}<rect x="1250" y="260" width="760" height="10" fill="#ffffff" opacity="0.18"/></g>` +
    shadow(1350, 700, 520, 520, -6) +
    `<g transform="rotate(-6 1610 960)"><rect x="1350" y="700" width="520" height="520" fill="#2a4b40"/><g clip-path="url(#felt)">${fibres}</g></g>` +
    shadow(1880, 1150, 380, 260, 9) +
    `<g transform="rotate(9 2070 1280)"><rect x="1880" y="1150" width="380" height="260" fill="#3a3f42"/><rect x="1880" y="1150" width="380" height="8" fill="#ffffff" opacity="0.12"/></g>` +
    `<rect x="546" y="1034" width="560" height="380" fill="#3d4640" opacity="0.16" filter="url(#glow)" transform="rotate(8 800 1190)"/>` +
    `<g transform="rotate(8 800 1190)"><rect x="520" y="1000" width="560" height="380" fill="url(#glassPane)" stroke="#ffffff" stroke-width="3" stroke-opacity="0.7"/><path d="M560 1040 L760 1040 L620 1200 Z" fill="#ffffff" opacity="0.25"/></g>` +
    vig.body;
  return { w, h, svg: doc(w, h, defs, body), grain: 8 };
}

async function render(scene, file, { quality = 84 } = {}) {
  const { w, h, svg, grain = 11, chroma = '4:2:0' } = scene;
  const rand = rng(w * 31 + h);
  const noise = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = 128 + (rand() - 0.5) * 2 * grain;
    noise[i * 4] = v;
    noise[i * 4 + 1] = v;
    noise[i * 4 + 2] = v;
    noise[i * 4 + 3] = 255;
  }
  const raster = await sharp(Buffer.from(svg)).flatten({ background: '#ffffff' }).toBuffer();
  const out = sharp(raster).composite([{ input: noise, raw: { width: w, height: h, channels: 4 }, blend: 'soft-light' }]);
  await out.jpeg({ quality, mozjpeg: true, chromaSubsampling: chroma }).toFile(file);
  return raster;
}

function icoFromPng(png, size) {
  const header = Buffer.alloc(22);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(1, 4);
  header.writeUInt8(size, 6);
  header.writeUInt8(size, 7);
  header.writeUInt8(0, 8);
  header.writeUInt8(0, 9);
  header.writeUInt16LE(1, 10);
  header.writeUInt16LE(32, 12);
  header.writeUInt32LE(png.length, 14);
  header.writeUInt32LE(22, 18);
  return Buffer.concat([header, png]);
}

const markSvg = (size, { bg = '#1f4a3d', fg = '#f0f2ef', radius = 0.18 } = {}) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 32 32"><rect width="32" height="32" rx="${32 * radius}" fill="${bg}"/><path d="M7 20.5a9 9 0 0 1 18 0z" fill="${fg}"/><rect x="5" y="23" width="22" height="2.2" fill="${fg}"/></svg>`;

const scenes = {
  'hero-fjord-dusk': sceneHero,
  'project-fjordhuset': sceneFjordhuset,
  'project-sjobuene': sceneSjobuene,
  'project-bjorkly': sceneBjorkly,
  'project-naustet': sceneNaustet,
  'service-homes': sceneHomes,
  'service-public': scenePublic,
  'service-renovation': sceneInterior,
  'journal-winter-sun': sceneSunPath,
  'journal-timber': sceneTimber,
  'journal-site-visit': sceneContours,
  'about-materials': sceneMaterials,
};

await mkdir(artDir, { recursive: true });
const only = process.argv.slice(2);
for (const [name, fn] of Object.entries(scenes)) {
  if (only.length && !only.includes(name)) continue;
  const started = performance.now();
  const scene = fn();
  const raster = await render(scene, path.join(artDir, `${name}.jpg`));
  if (name === 'hero-fjord-dusk') {
    const og = await sharp(raster)
      .extract({ left: 0, top: 700, width: 1600, height: 840 })
      .resize(1200, 630)
      .composite([{ input: Buffer.from(markSvg(72, { radius: 0.22 })), left: 64, top: 494 }])
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
    await writeFile(path.join(publicDir, 'og.jpg'), og);
  }
  console.log(`${name}.jpg ${Math.round(performance.now() - started)}ms`);
}

if (!only.length) {
  await writeFile(path.join(publicDir, 'favicon.svg'), markSvg(32));
  await sharp(Buffer.from(markSvg(180, { radius: 0 }))).png().toFile(path.join(publicDir, 'apple-touch-icon.png'));
  const png32 = await sharp(Buffer.from(markSvg(32))).png().toBuffer();
  await writeFile(path.join(publicDir, 'favicon.ico'), icoFromPng(png32, 32));
  console.log('icons written');
}
