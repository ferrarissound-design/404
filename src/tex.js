// 手続き生成テクスチャ（外部素材なし・著作権フリー）
import * as THREE from 'three';
import { rng, clamp, TAU } from './util.js';

export const TEX = { scale: 1, aniso: 4 };

/** 周期ラティスノイズ（タイル可能）*/
function makeNoise(seed, period = 64) {
  const r = rng(seed);
  const n = period * period;
  const g = new Float32Array(n);
  for (let i = 0; i < n; i++) g[i] = r();
  const wrap = (v) => ((v % period) + period) % period;
  return (x, y) => {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const x0 = wrap(xi);
    const x1 = wrap(xi + 1);
    const y0 = wrap(yi) * period;
    const y1 = wrap(yi + 1) * period;
    const a = g[y0 + x0];
    const b = g[y0 + x1];
    const c = g[y1 + x0];
    const d = g[y1 + x1];
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  };
}

/** fbm：基準周波数 f (整数) でタイル可能 */
function fbm(noise, x, y, f, oct = 4, gain = 0.5) {
  let amp = 0.5;
  let sum = 0;
  let norm = 0;
  let fr = f;
  for (let i = 0; i < oct; i++) {
    sum += noise(x * fr, y * fr) * amp;
    norm += amp;
    amp *= gain;
    fr *= 2;
  }
  return sum / norm;
}

const sz = (n) => Math.max(64, Math.round(n * TEX.scale));

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function toTex(c, { color = true, repeat = true } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
  }
  t.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = TEX.aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  return t;
}

/**
 * 3マップ生成ヘルパ。fn(x,y,u,v) -> [r,g,b, rough, bump]（0..1）
 */
function gen(size, fn) {
  const w = size;
  const cc = canvas(w);
  const dc = canvas(w);
  const cx = cc.getContext('2d');
  const dx = dc.getContext('2d');
  const ci = cx.createImageData(w, w);
  const di = dx.createImageData(w, w);
  const out = [0, 0, 0, 0, 0];
  for (let y = 0; y < w; y++) {
    for (let x = 0; x < w; x++) {
      fn(x, y, x / w, y / w, out);
      const i = (y * w + x) * 4;
      ci.data[i] = clamp(out[0], 0, 1) * 255;
      ci.data[i + 1] = clamp(out[1], 0, 1) * 255;
      ci.data[i + 2] = clamp(out[2], 0, 1) * 255;
      ci.data[i + 3] = 255;
      // データテクスチャ：R=バンプ, G=粗さ（同じテクスチャを bumpMap / roughnessMap の両方に使う）
      di.data[i] = clamp(out[4], 0, 1) * 255;
      di.data[i + 1] = clamp(out[3], 0, 1) * 255;
      di.data[i + 2] = 0;
      di.data[i + 3] = 255;
    }
  }
  cx.putImageData(ci, 0, 0);
  dx.putImageData(di, 0, 0);
  const data = toTex(dc, { color: false });
  return { map: toTex(cc), rough: data, bump: data };
}

// ---------------------------------------------------------------- 床・壁

/** フローリング（1.8m四方）*/
export function woodFloor() {
  const size = sz(1024);
  const n1 = makeNoise(11, 64);
  const n2 = makeNoise(12, 64);
  const r = rng(77);
  const planks = 9;
  const tints = [];
  for (let i = 0; i < planks * 3; i++) tints.push([r.range(-0.06, 0.06), r.range(-0.04, 0.04)]);
  const offs = [];
  for (let i = 0; i < planks; i++) offs.push(r());
  return gen(size, (x, y, u, v, o) => {
    const pi = Math.floor(u * planks);
    const pu = u * planks - pi;
    // プランクの長さ方向へのずらし
    let vv = v + offs[pi];
    const seg = Math.floor(vv * 2);
    const sv = vv * 2 - seg;
    const t = tints[(pi * 3 + (seg % 3)) % tints.length];
    // 木目：縦方向に伸ばしたノイズ
    const gx = pu * 3 + pi * 5.1 + seg * 3.7;
    const grain = fbm(n1, gx / 64, (vv * 2) / 64, 8, 3) * 0.7 + fbm(n2, gx / 64 * 0.5, (vv * 2) / 64 * 0.15 + seg, 24, 2) * 0.3;
    const ring = 0.5 + 0.5 * Math.sin((pu * 9 + grain * 14 + seg) * 1.7);
    let base = 0.5 + (grain - 0.5) * 0.55 + (ring - 0.5) * 0.12;
    // 目地
    const edge = Math.min(pu, 1 - pu) * planks * 0.2; // 0..0.1
    const endEdge = Math.min(sv, 1 - sv) * 2 * 0.5;
    const gap = Math.min(edge * 10, endEdge * 40 + 0.0);
    const g = clamp(gap * 2.2, 0, 1);
    const k = 0.78 + t[0];
    const rr = (0.62 + t[0] * 1.2) * base * 1.35 + 0.1;
    const gg = (0.45 + t[0] * 1.0) * base * 1.35 + 0.07 + t[1] * 0.2;
    const bb = (0.32 + t[0] * 0.8) * base * 1.35 + 0.04 + t[1] * 0.1;
    const f = 0.35 + 0.65 * g;
    o[0] = rr * f * k + 0.02;
    o[1] = gg * f * k + 0.015;
    o[2] = bb * f * k + 0.01;
    o[3] = 0.28 + (1 - g) * 0.5 + (grain - 0.5) * 0.25;
    o[4] = 0.5 + (grain - 0.5) * 0.15 - (1 - g) * 0.45;
  });
}

/** ビニールクロス（壁紙）1m四方：ほぼ白（色はマテリアル側で乗せる）*/
export function wallpaper() {
  const size = sz(512);
  const n1 = makeNoise(21, 64);
  const n2 = makeNoise(22, 64);
  return gen(size, (x, y, u, v, o) => {
    const weave = n1(u * 64 * 1.0, v * 3) * 0.5 + n1(u * 128, v * 6) * 0.3;
    const blot = fbm(n2, u, v, 3, 4);
    const rib = 0.5 + 0.5 * Math.sin(u * TAU * 40 + n1(u * 8, v * 8) * 3);
    const base = 0.9 + (blot - 0.5) * 0.12 - weave * 0.05 - rib * 0.02;
    o[0] = base;
    o[1] = base * 0.995;
    o[2] = base * 0.97;
    o[3] = 0.82 + weave * 0.1;
    o[4] = 0.5 + (weave - 0.4) * 0.35 + rib * 0.1;
  });
}

/** 塗装コンクリート・モルタル（2m）*/
export function plaster() {
  const size = sz(512);
  const n1 = makeNoise(31, 64);
  const n2 = makeNoise(32, 64);
  return gen(size, (x, y, u, v, o) => {
    const rough = fbm(n1, u, v, 8, 4);
    const stain = fbm(n2, u, v, 2, 4);
    const streak = fbm(n2, u * 1.0, v * 0.2, 6, 2);
    let b = 0.78 + (rough - 0.5) * 0.18 - (stain - 0.5) * 0.12 - streak * streak * 0.15;
    o[0] = b * 1.0;
    o[1] = b * 0.98;
    o[2] = b * 0.93;
    o[3] = 0.9;
    o[4] = 0.4 + rough * 0.4;
  });
}

/** 共用廊下の床（長尺シート風）1m */
export function corridorFloor() {
  const size = sz(512);
  const n1 = makeNoise(41, 64);
  const n2 = makeNoise(42, 64);
  const r = rng(5);
  const spots = [];
  for (let i = 0; i < 380; i++) spots.push([r(), r(), r.range(0.002, 0.008), r()]);
  return gen(size, (x, y, u, v, o) => {
    const base = 0.46 + (fbm(n1, u, v, 4, 4) - 0.5) * 0.12;
    const grit = n2(u * 128, v * 128) * 0.12;
    let c = base + grit - 0.05;
    let tint = 0;
    for (let i = 0; i < spots.length; i++) {
      const s = spots[i];
      let dx = Math.abs(u - s[0]);
      let dy = Math.abs(v - s[1]);
      if (dx > 0.5) dx = 1 - dx;
      if (dy > 0.5) dy = 1 - dy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < s[2]) {
        tint = s[3] < 0.5 ? -0.14 : 0.1;
      }
    }
    c += tint;
    // 目地（1mごと）
    const ln = Math.min(u, 1 - u, v, 1 - v);
    const joint = ln < 0.004 ? 0.6 : 1;
    o[0] = c * 0.9 * joint;
    o[1] = c * 0.93 * joint;
    o[2] = c * 0.88 * joint;
    o[3] = 0.4 + grit * 1.5;
    o[4] = 0.5 + grit * 0.5 - (joint < 1 ? 0.25 : 0);
  });
}

/** 玄関タイル（石目）*/
export function genkanTile() {
  const size = sz(512);
  const n1 = makeNoise(51, 64);
  const n2 = makeNoise(52, 64);
  return gen(size, (x, y, u, v, o) => {
    const tu = (u * 2) % 1;
    const tv = (v * 2) % 1;
    const tid = Math.floor(u * 2) + Math.floor(v * 2) * 2;
    const g = Math.min(tu, 1 - tu, tv, 1 - tv);
    const grout = g < 0.012 ? 0.5 : 1;
    const sp = n1(u * 150, v * 150);
    const cl = fbm(n2, u, v, 5, 4);
    const t = 0.24 + cl * 0.14 + sp * 0.08 + (tid % 3) * 0.01;
    o[0] = t * grout;
    o[1] = t * 1.02 * grout;
    o[2] = t * 1.05 * grout;
    o[3] = 0.55 + sp * 0.3;
    o[4] = 0.55 - (grout < 1 ? 0.4 : 0) + sp * 0.2;
  });
}

/** 白タイル（浴室壁・洗面）0.5m */
export function whiteTile() {
  const size = sz(512);
  const n1 = makeNoise(61, 64);
  return gen(size, (x, y, u, v, o) => {
    const tu = (u * 4) % 1;
    const tv = (v * 4) % 1;
    const g = Math.min(tu, 1 - tu, tv, 1 - tv);
    const grout = g < 0.018 ? 0.62 : 1;
    const sp = n1(u * 90, v * 90);
    const b = 0.86 + sp * 0.04;
    o[0] = b * grout * 0.98;
    o[1] = b * grout;
    o[2] = b * grout * 1.0;
    o[3] = grout < 1 ? 0.8 : 0.18 + sp * 0.1;
    o[4] = grout < 1 ? 0.15 : 0.6;
  });
}

/** 暗い木（家具）*/
export function woodDark() {
  const size = sz(512);
  const n1 = makeNoise(71, 64);
  const n2 = makeNoise(72, 64);
  return gen(size, (x, y, u, v, o) => {
    const grain = fbm(n1, u * 1, v * 0.12, 10, 3);
    const ring = 0.5 + 0.5 * Math.sin((u * 14 + grain * 10) * 1.5);
    const b = 0.32 + (grain - 0.5) * 0.4 + ring * 0.1;
    o[0] = b * 0.9;
    o[1] = b * 0.6;
    o[2] = b * 0.4;
    o[3] = 0.42 + grain * 0.2;
    o[4] = 0.5 + (ring - 0.5) * 0.2;
  });
}

/** 明るい木（棚・扉）*/
export function woodLight() {
  const size = sz(512);
  const n1 = makeNoise(81, 64);
  return gen(size, (x, y, u, v, o) => {
    const grain = fbm(n1, u * 1, v * 0.1, 10, 3);
    const ring = 0.5 + 0.5 * Math.sin((u * 10 + grain * 8) * 1.7);
    const b = 0.62 + (grain - 0.5) * 0.3 + ring * 0.07;
    o[0] = b * 0.92;
    o[1] = b * 0.74;
    o[2] = b * 0.52;
    o[3] = 0.5 + grain * 0.15;
    o[4] = 0.5 + (ring - 0.5) * 0.15;
  });
}

/** 布（織り目）*/
export function fabric() {
  const size = sz(256);
  const n1 = makeNoise(91, 64);
  return gen(size, (x, y, u, v, o) => {
    const wv = 0.5 + 0.5 * Math.sin(u * TAU * 48) * Math.sin(v * TAU * 48);
    const nz = n1(u * 80, v * 80);
    const b = 0.78 + wv * 0.14 + nz * 0.08;
    o[0] = o[1] = o[2] = b;
    o[3] = 0.95;
    o[4] = 0.4 + wv * 0.4;
  });
}

/** スチール塗装（玄関ドア・金属扉）*/
export function paintedSteel() {
  const size = sz(512);
  const n1 = makeNoise(101, 64);
  const n2 = makeNoise(102, 64);
  return gen(size, (x, y, u, v, o) => {
    const speck = n1(u * 120, v * 120);
    const dirt = fbm(n2, u, v * 0.4, 3, 4);
    const scuff = Math.max(0, fbm(n2, u * 3, v * 1, 12, 2) - 0.62) * 2;
    const b = 0.52 + (dirt - 0.5) * 0.1 + speck * 0.03 - scuff * 0.25;
    o[0] = b;
    o[1] = b;
    o[2] = b;
    o[3] = 0.42 + scuff * 0.5 + speck * 0.1;
    o[4] = 0.5 + speck * 0.15;
  });
}

/** 金属（ブラシ）*/
export function brushedMetal() {
  const size = sz(256);
  const n1 = makeNoise(111, 64);
  return gen(size, (x, y, u, v, o) => {
    const s = n1(u * 4, v * 160);
    const b = 0.8 + s * 0.14;
    o[0] = o[1] = o[2] = b;
    o[3] = 0.3 + s * 0.2;
    o[4] = 0.5 + s * 0.3;
  });
}

/** カーテン（ひだ）*/
export function curtainFold(r = 0.5, g = 0.5, b = 0.5) {
  const size = sz(256);
  const n1 = makeNoise(121, 64);
  return gen(size, (x, y, u, v, o) => {
    const fold = 0.5 + 0.5 * Math.sin(u * TAU * 6 + n1(u * 4, v * 2) * 1.2);
    const nz = n1(u * 96, v * 96);
    const k = 0.55 + fold * 0.45 + (nz - 0.5) * 0.1;
    o[0] = r * k;
    o[1] = g * k;
    o[2] = b * k;
    o[3] = 0.95;
    o[4] = 0.5 + fold * 0.3;
  });
}

// ---------------------------------------------------------------- 画像・ラベル類

export function lace() {
  const c = canvas(sz(256));
  const x = c.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#fff';
  const s = c.width;
  const r = rng(3);
  for (let i = 0; i < 160; i++) {
    const px = r() * s;
    const py = r() * s;
    x.globalAlpha = 0.5;
    x.beginPath();
    x.arc(px, py, r.range(2, 7), 0, TAU);
    x.fill();
  }
  x.globalAlpha = 0.85;
  for (let i = 0; i < s; i += 4) {
    x.fillRect(i, 0, 1, s);
  }
  const t = toTex(c, { color: false });
  return t;
}

/** 汎用：キャンバスにテキストを描いたテクスチャ */
export function labelTexture(w, h, draw, { color = true, repeat = false } = {}) {
  const c = canvas(w, h);
  const x = c.getContext('2d');
  draw(x, w, h);
  const t = toTex(c, { color, repeat });
  t.userData = { canvas: c, ctx: x };
  return t;
}

export const FONT_JP = '"Hiragino Sans","Hiragino Kaku Gothic ProN","Yu Gothic","Noto Sans JP","Meiryo","IPAGothic",sans-serif';
export const FONT_MIN = '"Hiragino Mincho ProN","Yu Mincho","Noto Serif JP","IPAMincho",serif';

/** 柔らかい影（デカール用）*/
export function softShadowTex() {
  const s = 128;
  const c = canvas(s);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(s / 2, s / 2, s * 0.1, s / 2, s / 2, s * 0.5);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.5, 'rgba(0,0,0,0.55)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  return toTex(c, { color: false, repeat: false });
}

/** 矩形の柔らかい影（家具の接地影）*/
export function boxShadowTex() {
  const s = 128;
  const c = canvas(s);
  const x = c.getContext('2d');
  x.fillStyle = '#000';
  x.fillRect(0, 0, s, s);
  const img = x.createImageData(s, s);
  for (let j = 0; j < s; j++) {
    for (let i = 0; i < s; i++) {
      const dx = Math.min(i, s - 1 - i) / (s * 0.5);
      const dy = Math.min(j, s - 1 - j) / (s * 0.5);
      const d = Math.min(dx, dy);
      const a = Math.pow(clamp(d / 0.55, 0, 1), 1.4);
      const k = (j * s + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = 0;
      img.data[k + 3] = a * 255;
    }
  }
  x.putImageData(img, 0, 0);
  return toTex(c, { color: false, repeat: false });
}

/** 縦グラデーション（壁際AO用）alpha: 上=濃 → 下=0 */
export function edgeGradTex() {
  const w = 4;
  const h = 128;
  const c = canvas(w, h);
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(0,0,0,1)');
  g.addColorStop(0.35, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  const t = toTex(c, { color: false, repeat: false });
  return t;
}

export function glowTex() {
  const s = 128;
  const c = canvas(s);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.15, 'rgba(255,255,255,0.55)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  return toTex(c, { repeat: false });
}

export function dustTex() {
  const s = 32;
  const c = canvas(s);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g;
  x.fillRect(0, 0, s, s);
  return toTex(c, { repeat: false });
}

/** 足跡デカール（左右）*/
export function footprintTex(left = true) {
  const w = 64;
  const h = 128;
  const c = canvas(w, h);
  const x = c.getContext('2d');
  x.clearRect(0, 0, w, h);
  x.fillStyle = '#fff';
  x.save();
  if (!left) {
    x.translate(w, 0);
    x.scale(-1, 1);
  }
  // 足裏
  x.beginPath();
  x.ellipse(30, 82, 15, 28, -0.05, 0, TAU);
  x.fill();
  // かかと
  x.beginPath();
  x.ellipse(31, 108, 11, 12, 0, 0, TAU);
  x.fill();
  // つま先
  const toes = [
    [18, 45, 5.5],
    [27, 38, 5],
    [36, 38, 4.6],
    [44, 43, 4.2],
    [50, 52, 3.6],
  ];
  for (const t of toes) {
    x.beginPath();
    x.arc(t[0], t[1], t[2], 0, TAU);
    x.fill();
  }
  x.restore();
  // 縁をぼかす
  x.filter = 'blur(1.2px)';
  x.globalCompositeOperation = 'copy';
  x.drawImage(c, 0, 0);
  return toTex(c, { color: false, repeat: false });
}

/** 街の窓明かりファサード（1枚で複数ビルに流用）*/
export function cityFacade(seed = 1, litRatio = 0.28) {
  const w = sz(512);
  const h = sz(1024);
  const c = canvas(w, h);
  const x = c.getContext('2d');
  const r = rng(seed);
  x.fillStyle = '#05070c';
  x.fillRect(0, 0, w, h);
  // 壁面のなだらかな明暗
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#0a0d14');
  g.addColorStop(1, '#10131a');
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  const cols = 8;
  const rows = 22;
  const cw = w / cols;
  const rh = h / rows;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const lit = r() < litRatio;
      const px = i * cw + cw * 0.18;
      const py = j * rh + rh * 0.22;
      const ww = cw * 0.64;
      const hh = rh * 0.5;
      if (lit) {
        const warm = r() < 0.7;
        const a = r.range(0.55, 1);
        x.fillStyle = warm ? `rgba(255,${Math.floor(r.range(190, 225))},${Math.floor(r.range(120, 160))},${a})` : `rgba(210,230,255,${a})`;
      } else {
        x.fillStyle = 'rgba(20,26,36,1)';
      }
      x.fillRect(px, py, ww, hh);
      if (lit) {
        x.fillStyle = 'rgba(0,0,0,0.5)';
        x.fillRect(px + ww / 2 - 1, py, 2, hh);
      }
    }
  }
  const t = toTex(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function skyTex() {
  const w = 16;
  const h = 256;
  const c = canvas(w, h);
  const x = c.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#04060d');
  g.addColorStop(0.45, '#0a1020');
  g.addColorStop(0.72, '#1a2234');
  g.addColorStop(0.9, '#3a3a44');
  g.addColorStop(1, '#4a4038');
  x.fillStyle = g;
  x.fillRect(0, 0, w, h);
  const t = toTex(c, { repeat: false });
  return t;
}

/** 汎用の簡易ノイズ（ホワイトノイズ）キャンバス（TV砂嵐）*/
export function staticCanvasTexture(w = 96, h = 72) {
  const c = canvas(w, h);
  const x = c.getContext('2d');
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  const img = x.createImageData(w, h);
  t.userData = {
    canvas: c,
    ctx: x,
    img,
    update(intensity = 1, overlay) {
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const v = Math.random() * 255 * intensity;
        d[i] = d[i + 1] = d[i + 2] = v;
        d[i + 3] = 255;
      }
      x.putImageData(img, 0, 0);
      if (overlay) overlay(x, w, h);
      t.needsUpdate = true;
    },
  };
  return t;
}
