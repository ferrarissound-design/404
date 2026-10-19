// 絵・写真・カレンダー等のキャンバス描画（バリエーション付き）
import { rng, TAU } from './util.js';
import { FONT_JP, FONT_MIN } from './tex.js';

function blurDraw(ctx, w, h, px, fn) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  fn(x);
  ctx.save();
  ctx.filter = `blur(${px}px)`;
  ctx.drawImage(c, 0, 0);
  ctx.restore();
}

function grain(ctx, w, h, amt, seed = 1) {
  const r = rng(seed);
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amt;
    d[i] += n;
    d[i + 1] += n;
    d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
}

function person(ctx, cx, baseY, s, o) {
  // 立っている人物：頭・首・体（ぼかし前提のシルエット）
  const { skin = '#d6ad92', hair = '#1c1612', cloth = '#3a4a62', blank = false, smile = true, hairStyle = 'short', headTilt = 0, eyesBig = false } = o;
  const headR = 34 * s;
  const bodyW = 92 * s;
  const bodyH = 150 * s;
  const neckY = baseY - bodyH;
  // 体
  ctx.fillStyle = cloth;
  ctx.beginPath();
  ctx.moveTo(cx - bodyW / 2, baseY);
  ctx.quadraticCurveTo(cx - bodyW / 2 - 6 * s, neckY + 30 * s, cx - 20 * s, neckY + 4 * s);
  ctx.lineTo(cx + 20 * s, neckY + 4 * s);
  ctx.quadraticCurveTo(cx + bodyW / 2 + 6 * s, neckY + 30 * s, cx + bodyW / 2, baseY);
  ctx.closePath();
  ctx.fill();
  // 首
  ctx.fillStyle = skin;
  ctx.fillRect(cx - 11 * s, neckY - 12 * s, 22 * s, 22 * s);
  // 頭
  ctx.save();
  ctx.translate(cx, neckY - headR * 0.95);
  ctx.rotate(headTilt);
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(0, 0, headR * 0.82, headR, 0, 0, TAU);
  ctx.fill();
  // 髪
  ctx.fillStyle = hair;
  ctx.beginPath();
  if (hairStyle === 'long') {
    ctx.ellipse(0, -headR * 0.22, headR * 0.95, headR * 0.95, 0, Math.PI, 0);
    ctx.fill();
    ctx.fillRect(-headR * 0.95, -headR * 0.22, headR * 0.32, headR * 1.7);
    ctx.fillRect(headR * 0.63, -headR * 0.22, headR * 0.32, headR * 1.7);
  } else if (hairStyle === 'twin') {
    ctx.ellipse(0, -headR * 0.2, headR * 0.9, headR * 0.85, 0, Math.PI, 0);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-headR * 0.95, headR * 0.1, headR * 0.28, 0, TAU);
    ctx.arc(headR * 0.95, headR * 0.1, headR * 0.28, 0, TAU);
    ctx.fill();
  } else {
    ctx.ellipse(0, -headR * 0.3, headR * 0.88, headR * 0.78, 0, Math.PI, 0);
    ctx.fill();
  }
  if (!blank) {
    // 目・口
    ctx.fillStyle = '#251a14';
    const er = eyesBig ? 7.5 * s : 3.2 * s;
    ctx.beginPath();
    ctx.ellipse(-headR * 0.33, headR * 0.02, er, er * (eyesBig ? 1.25 : 1), 0, 0, TAU);
    ctx.ellipse(headR * 0.33, headR * 0.02, er, er * (eyesBig ? 1.25 : 1), 0, 0, TAU);
    ctx.fill();
    if (eyesBig) {
      ctx.fillStyle = '#f4f0e8';
      ctx.beginPath();
      ctx.ellipse(-headR * 0.33, headR * 0.02, er * 1.45, er * 1.7, 0, 0, TAU);
      ctx.ellipse(headR * 0.33, headR * 0.02, er * 1.45, er * 1.7, 0, 0, TAU);
      ctx.fill();
      ctx.fillStyle = '#120c08';
      ctx.beginPath();
      ctx.arc(-headR * 0.33, headR * 0.02, er * 0.8, 0, TAU);
      ctx.arc(headR * 0.33, headR * 0.02, er * 0.8, 0, TAU);
      ctx.fill();
    }
    ctx.strokeStyle = '#7a3b34';
    ctx.lineWidth = 3 * s;
    ctx.beginPath();
    if (smile) ctx.arc(0, headR * 0.34, headR * 0.28, 0.15 * Math.PI, 0.85 * Math.PI);
    else {
      ctx.moveTo(-headR * 0.22, headR * 0.5);
      ctx.lineTo(headR * 0.22, headR * 0.5);
    }
    ctx.stroke();
  }
  ctx.restore();
}

/** 家族写真。variant 0:通常 1:父が白飛び 2:父が消える 3:遺影 4:顔が無い/こちらを見る */
export function drawFamilyPhoto(ctx, w, h, variant = 0, seed = 7) {
  const r = rng(seed);
  if (variant === 3) return drawPortrait(ctx, w, h);
  // 背景：公園
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#9db8cf');
  sky.addColorStop(0.55, '#cfd9d8');
  sky.addColorStop(0.56, '#6a8a52');
  sky.addColorStop(1, '#4a6a3a');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);
  blurDraw(ctx, w, h, 5, (x) => {
    x.fillStyle = '#3d5a34';
    for (let i = 0; i < 5; i++) {
      x.beginPath();
      x.arc(w * (0.1 + i * 0.22), h * 0.42, h * r.range(0.15, 0.25), 0, TAU);
      x.fill();
    }
    x.fillStyle = '#e8ecef';
    x.beginPath();
    x.ellipse(w * 0.75, h * 0.14, w * 0.14, h * 0.05, 0, 0, TAU);
    x.fill();
  });
  const by = h * 0.97;
  const sc = h / 420;
  blurDraw(ctx, w, h, 1.3, (x) => {
    // 母（中央）
    person(x, w * 0.5, by, sc * 0.95, { cloth: '#b8564e', hair: '#2a1e18', hairStyle: 'long', skin: '#e0b9a0' });
    // 子（右）
    person(x, w * 0.74, by, sc * 0.58, { cloth: '#e0b24a', hair: '#1e1610', hairStyle: 'twin', skin: '#e4bea6', eyesBig: variant === 4 });
    if (variant === 0 || variant === 1) {
      person(x, w * 0.26, by, sc * 1.08, { cloth: '#3a4a62', hair: '#17110d', skin: '#d2a78c' });
    }
    if (variant === 4) {
      person(x, w * 0.26, by, sc * 1.08, { cloth: '#3a4a62', hair: '#17110d', blank: true });
    }
  });
  if (variant === 4) {
    // 母と子の顔を空白にして、目だけを残す
  }
  if (variant === 1) {
    // 父が白飛び
    const g = ctx.createRadialGradient(w * 0.26, h * 0.4, 4, w * 0.26, h * 0.45, w * 0.22);
    g.addColorStop(0, 'rgba(255,252,240,0.98)');
    g.addColorStop(0.6, 'rgba(255,250,235,0.7)');
    g.addColorStop(1, 'rgba(255,250,235,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }
  if (variant === 2) {
    // 父がいた場所だけ背景が少し明るい（跡）
    const g = ctx.createRadialGradient(w * 0.26, h * 0.6, 2, w * 0.26, h * 0.6, w * 0.16);
    g.addColorStop(0, 'rgba(255,255,255,0.12)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // 母の腕が、誰かの肩を抱くように外に伸びている
    ctx.strokeStyle = '#b8564e';
    ctx.lineWidth = 16 * sc;
    ctx.lineCap = 'round';
    ctx.filter = 'blur(1.4px)';
    ctx.beginPath();
    ctx.moveTo(w * 0.44, h * 0.62);
    ctx.quadraticCurveTo(w * 0.36, h * 0.66, w * 0.31, h * 0.6);
    ctx.stroke();
    ctx.filter = 'none';
  }
  finishPhoto(ctx, w, h, seed);
}

function finishPhoto(ctx, w, h, seed) {
  // 色褪せ・ビネット・粒子
  ctx.fillStyle = 'rgba(255,214,150,0.10)';
  ctx.fillRect(0, 0, w, h);
  const v = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, h * 0.85);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(20,10,0,0.45)');
  ctx.fillStyle = v;
  ctx.fillRect(0, 0, w, h);
  grain(ctx, w, h, 22, seed);
}

function drawPortrait(ctx, w, h) {
  // 遺影：無地の背景に黒い服。顔は輪郭のみ（空白）
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, '#c7ccd0');
  g.addColorStop(1, '#9aa1a6');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  const sc = h / 380;
  blurDraw(ctx, w, h, 1.2, (x) => {
    person(x, w * 0.5, h * 1.02, sc * 1.55, { cloth: '#151618', hair: '#15100c', skin: '#d9b9a2', blank: true });
    // 白いシャツの襟元
    x.fillStyle = '#e9e9e4';
    x.beginPath();
    x.moveTo(w * 0.5 - 28 * sc, h * 0.74);
    x.lineTo(w * 0.5, h * 0.9);
    x.lineTo(w * 0.5 + 28 * sc, h * 0.74);
    x.closePath();
    x.fill();
  });
  finishPhoto(ctx, w, h, 11);
  // 黒いリボン（左上・右下を斜めに）
  ctx.fillStyle = '#0b0b0c';
  ctx.beginPath();
  ctx.moveTo(0, h * 0.72);
  ctx.lineTo(0, h);
  ctx.lineTo(w * 0.28, h);
  ctx.closePath();
  ctx.fill();
}

/** 子供の絵（クレヨン）*/
export function drawChildDrawing(ctx, w, h, variant = 0) {
  const r = rng(5);
  ctx.fillStyle = '#f2ecd8';
  ctx.fillRect(0, 0, w, h);
  // 紙の繊維
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(120,100,70,${r() * 0.05})`;
    ctx.fillRect(r() * w, r() * h, 2, 1);
  }
  const wob = (v) => v + (r() - 0.5) * 2.2;
  const stroke = (col, lw, pts) => {
    ctx.strokeStyle = col;
    ctx.lineWidth = lw;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i ? ctx.lineTo(wob(px), wob(py)) : ctx.moveTo(wob(px), wob(py))));
    ctx.stroke();
  };
  const s = w / 400;
  // 太陽
  ctx.fillStyle = '#f0a020';
  ctx.beginPath();
  ctx.arc(330 * s, 70 * s, 32 * s, 0, TAU);
  ctx.fill();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU;
    stroke('#f0a020', 5 * s, [
      [330 * s + Math.cos(a) * 42 * s, 70 * s + Math.sin(a) * 42 * s],
      [330 * s + Math.cos(a) * 60 * s, 70 * s + Math.sin(a) * 60 * s],
    ]);
  }
  // 地面
  stroke('#3c9a3c', 8 * s, [
    [0, 300 * s],
    [w, 300 * s],
  ]);
  // 家
  stroke('#c04a30', 7 * s, [
    [40 * s, 300 * s],
    [40 * s, 190 * s],
    [110 * s, 140 * s],
    [180 * s, 190 * s],
    [180 * s, 300 * s],
    [40 * s, 300 * s],
  ]);
  stroke('#4a6ac0', 6 * s, [
    [80 * s, 300 * s],
    [80 * s, 240 * s],
    [130 * s, 240 * s],
    [130 * s, 300 * s],
  ]);
  const fig = (x, hgt, col, label, o = {}) => {
    const y0 = 300 * s;
    if (o.scribble) {
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 9 * s;
      for (let i = 0; i < 26; i++) {
        ctx.beginPath();
        ctx.moveTo(x - 24 * s + r() * 48 * s, y0 - hgt - 30 * s + r() * 10 * s);
        ctx.lineTo(x - 24 * s + r() * 48 * s, y0 - r() * 20 * s);
        ctx.stroke();
      }
    } else {
      stroke(col, 5 * s, [
        [x, y0],
        [x, y0 - hgt * 0.55],
      ]);
      stroke(col, 5 * s, [
        [x, y0 - hgt * 0.55],
        [x - 14 * s, y0 - 2 * s],
      ]);
      stroke(col, 5 * s, [
        [x, y0 - hgt * 0.55],
        [x + 14 * s, y0 - 2 * s],
      ]);
      stroke(col, 5 * s, [
        [x - 22 * s, y0 - hgt * 0.38],
        [x + 22 * s, y0 - hgt * 0.38],
      ]);
      ctx.strokeStyle = col;
      ctx.lineWidth = 5 * s;
      ctx.beginPath();
      ctx.arc(x, y0 - hgt * 0.72, 17 * s, 0, TAU);
      ctx.stroke();
      if (!o.noFace) {
        ctx.fillStyle = col;
        ctx.fillRect(x - 7 * s, y0 - hgt * 0.74, 3 * s, 3 * s);
        ctx.fillRect(x + 5 * s, y0 - hgt * 0.74, 3 * s, 3 * s);
        stroke(col, 3 * s, [
          [x - 6 * s, y0 - hgt * 0.64],
          [x, y0 - hgt * 0.61],
          [x + 6 * s, y0 - hgt * 0.64],
        ]);
      }
    }
    ctx.fillStyle = o.faint ? 'rgba(60,40,30,0.25)' : '#3a2a20';
    ctx.font = `${22 * s}px ${FONT_JP}`;
    ctx.textAlign = 'center';
    ctx.fillText(label, x, 332 * s);
  };
  const dadX = 230 * s;
  if (variant === 0) fig(dadX, 120 * s, '#2a4a9a', 'パパ');
  if (variant === 1) fig(dadX, 120 * s, '#2a4a9a', 'パパ', { scribble: true });
  if (variant === 2) fig(dadX, 120 * s, '#2a4a9a', 'パパ', { faint: true, noFace: true, scribble: false, skip: true });
  if (variant === 2) {
    // 立っていた場所だけ消しゴムで消した跡
    ctx.fillStyle = '#f2ecd8';
    ctx.fillRect(dadX - 40 * s, 150 * s, 80 * s, 150 * s);
    ctx.fillStyle = 'rgba(60,40,30,0.25)';
    ctx.font = `${22 * s}px ${FONT_JP}`;
    ctx.textAlign = 'center';
    ctx.fillText('パパ', dadX, 332 * s);
  }
  fig(290 * s, 112 * s, '#c0306a', 'ママ');
  fig(345 * s, 70 * s, '#d09010', 'わたし');
  if (variant === 3) {
    // 見知らぬ、背の高い黒い人
    ctx.strokeStyle = '#0a0a0a';
    ctx.lineWidth = 7 * s;
    ctx.beginPath();
    ctx.moveTo(dadX, 300 * s);
    ctx.lineTo(dadX, 100 * s);
    ctx.moveTo(dadX - 30 * s, 160 * s);
    ctx.lineTo(dadX + 30 * s, 160 * s);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(dadX, 80 * s, 20 * s, 0, TAU);
    ctx.fillStyle = '#0a0a0a';
    ctx.fill();
    ctx.fillStyle = '#3a2a20';
    ctx.font = `${22 * s}px ${FONT_JP}`;
    ctx.fillText('だれ？', dadX, 332 * s);
  }
}

/** カレンダー。variant 0:今日に丸 1:×が並ぶ 2:翌月・四十九日 */
export function drawCalendar(ctx, w, h, variant = 0) {
  const r = rng(21);
  ctx.fillStyle = '#f4f1e8';
  ctx.fillRect(0, 0, w, h);
  // 上部の写真（山と湖）
  const ph = h * 0.42;
  const g = ctx.createLinearGradient(0, 0, 0, ph);
  g.addColorStop(0, '#6f8fb0');
  g.addColorStop(0.6, '#c8d4d4');
  g.addColorStop(1, '#8aa088');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, ph);
  ctx.fillStyle = '#4b5f6a';
  ctx.beginPath();
  ctx.moveTo(0, ph * 0.75);
  ctx.lineTo(w * 0.25, ph * 0.35);
  ctx.lineTo(w * 0.45, ph * 0.6);
  ctx.lineTo(w * 0.7, ph * 0.25);
  ctx.lineTo(w, ph * 0.7);
  ctx.lineTo(w, ph);
  ctx.lineTo(0, ph);
  ctx.fill();
  ctx.fillStyle = 'rgba(40,70,90,0.7)';
  ctx.fillRect(0, ph * 0.8, w, ph * 0.2);
  // 月名
  const month = variant === 2 ? 11 : 10;
  ctx.fillStyle = '#2a2a2a';
  ctx.font = `700 ${h * 0.075}px ${FONT_MIN}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(`${month}月`, w * 0.06, ph + h * 0.085);
  ctx.font = `500 ${h * 0.03}px ${FONT_JP}`;
  ctx.fillText(month === 10 ? 'OCTOBER' : 'NOVEMBER', w * 0.34, ph + h * 0.082);
  // グリッド
  const gx = w * 0.05;
  const gy = ph + h * 0.175;
  const cw = (w * 0.9) / 7;
  const ch = (h - gy - h * 0.025) / 6;
  const dows = ['日', '月', '火', '水', '木', '金', '土'];
  ctx.font = `600 ${h * 0.03}px ${FONT_JP}`;
  ctx.textAlign = 'center';
  dows.forEach((d, i) => {
    ctx.fillStyle = i === 0 ? '#c0392b' : i === 6 ? '#2a63a8' : '#333';
    ctx.fillText(d, gx + cw * (i + 0.5), gy);
  });
  const first = month === 10 ? 2 : 5; // 曜日オフセット
  const days = month === 10 ? 31 : 30;
  const pos = (d) => {
    const idx = first + d - 1;
    return [gx + cw * ((idx % 7) + 0.5), gy + ch * (Math.floor(idx / 7) + 0.75)];
  };
  ctx.font = `500 ${h * 0.04}px ${FONT_JP}`;
  for (let d = 1; d <= days; d++) {
    const [px, py] = pos(d);
    const col = (first + d - 1) % 7;
    ctx.fillStyle = col === 0 ? '#c0392b' : col === 6 ? '#2a63a8' : '#222';
    ctx.fillText(String(d), px, py);
  }
  const cross = (d) => {
    const [px, py] = pos(d);
    ctx.strokeStyle = 'rgba(200,30,30,0.85)';
    ctx.lineWidth = Math.max(2, h * 0.006);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(px - cw * 0.32 + r() * 3, py - ch * 0.5 + r() * 3);
    ctx.lineTo(px + cw * 0.32 + r() * 3, py + ch * 0.18 + r() * 3);
    ctx.moveTo(px + cw * 0.32, py - ch * 0.5);
    ctx.lineTo(px - cw * 0.32, py + ch * 0.18);
    ctx.stroke();
  };
  const circle = (d, col = '#c0201c') => {
    const [px, py] = pos(d);
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(2.5, h * 0.007);
    ctx.beginPath();
    ctx.ellipse(px, py - ch * 0.12, cw * 0.42, ch * 0.42, 0.2, 0.2, TAU + 0.5);
    ctx.stroke();
  };
  const note = (txt, d, dy = 0.3) => {
    const [px, py] = pos(d);
    ctx.fillStyle = '#7a1c18';
    ctx.font = `600 ${h * 0.028}px ${FONT_JP}`;
    ctx.fillText(txt, Math.min(px, w * 0.78), py + ch * dy);
  };
  if (variant === 0) {
    circle(19);
  } else if (variant === 1) {
    for (let d = 13; d <= 18; d++) cross(d);
    circle(19);
    note('初七日', 19, 0.42);
  } else {
    for (let d = 1; d <= 29; d++) cross(d);
    circle(30);
    note('四十九日', 30, 0.42);
  }
}

export function drawNote(ctx, w, h, text, color = '#fff176', rot = 0) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  const g = ctx.createLinearGradient(0, 0, 0, h);
  g.addColorStop(0, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(0,0,0,0.08)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#25303e';
  ctx.font = `600 ${h * 0.2}px ${FONT_JP}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const lines = text.split('\n');
  lines.forEach((l, i) => ctx.fillText(l, w / 2, h * ((i + 1) / (lines.length + 1)) + 2));
}

/** 壁掛け時計の文字盤 */
export function drawClockFace(ctx, s) {
  ctx.fillStyle = '#f2efe6';
  ctx.beginPath();
  ctx.arc(s / 2, s / 2, s / 2 - 2, 0, TAU);
  ctx.fill();
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = s * 0.012;
  for (let i = 0; i < 60; i++) {
    const a = (i / 60) * TAU;
    const l = i % 5 === 0 ? 0.09 : 0.04;
    ctx.beginPath();
    ctx.moveTo(s / 2 + Math.sin(a) * (s * 0.46 - s * l), s / 2 - Math.cos(a) * (s * 0.46 - s * l));
    ctx.lineTo(s / 2 + Math.sin(a) * s * 0.46, s / 2 - Math.cos(a) * s * 0.46);
    ctx.stroke();
  }
  ctx.fillStyle = '#222';
  ctx.font = `600 ${s * 0.12}px ${FONT_MIN}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let i = 1; i <= 12; i++) {
    const a = (i / 12) * TAU;
    ctx.fillText(String(i), s / 2 + Math.sin(a) * s * 0.34, s / 2 - Math.cos(a) * s * 0.34);
  }
}

/** 郵便物・新聞（拡大表示用）*/
export function drawMail(ctx, w, h, variant = 0) {
  ctx.fillStyle = '#efeadb';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#2b2b2b';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  if (variant === 0) {
    ctx.font = `700 ${h * 0.06}px ${FONT_JP}`;
    ctx.fillText('ご利用料金のお知らせ', w * 0.08, h * 0.08);
    ctx.font = `500 ${h * 0.036}px ${FONT_JP}`;
    const lines = ['404号室  様', '', '電気・ガス・水道（共益費含む）', '10月分のご請求額は下記のとおりです。', '', '                 ¥ 0', '', '※ 使用実績がありませんでした。', '   メーターの確認をお願いします。'];
    lines.forEach((l, i) => ctx.fillText(l, w * 0.08, h * 0.22 + i * h * 0.065));
  } else {
    ctx.font = `700 ${h * 0.056}px ${FONT_JP}`;
    ctx.fillText('【管理会社より】', w * 0.08, h * 0.07);
    ctx.font = `700 ${h * 0.05}px ${FONT_JP}`;
    ctx.fillText('お問い合わせの「404号室」は', w * 0.08, h * 0.18);
    ctx.fillText('存在しません。', w * 0.08, h * 0.26);
    ctx.font = `500 ${h * 0.036}px ${FONT_JP}`;
    const lines = ['', '当マンションに4階はございません。', '解約・残置物撤去は完了しております。', '', '最後にお部屋へ入られた方について', 'お心当たりのある方は、管理室まで。', '', '                      管理室'];
    lines.forEach((l, i) => ctx.fillText(l, w * 0.08, h * 0.34 + i * h * 0.062));
  }
  // 折り目
  ctx.fillStyle = 'rgba(0,0,0,0.06)';
  ctx.fillRect(0, h * 0.5, w, 2);
}
