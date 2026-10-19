// ワールド状態（セーブ対象）と、その見た目への反映
import * as THREE from 'three';
import * as Art from './art.js';
import { clamp, damp, lerp, TAU } from './util.js';
import { buildSeatedFigure } from './world/figure.js';
import { bakeGroup } from './builder.js';

export const AJAR = 0.34;

export const defaultWorldState = () => ({
  mugs: 1,
  steam: false,
  photo: 0,
  drawing: 0,
  calendar: 0,
  shoes: 0,
  bedDoor: 0, // 0 閉 / 1 少し開 / 2 全開
  closet: 0, // 0 閉 / 1 片方少し開 / 2 両方
  chairA: 0,
  chairB: 0,
  fridgeNote: 0,
  mail: -1, // -1 なし / 0 請求書 / 1 管理会社
  hallDz: 0,
  hallLight: true,
  ldkLight: false,
  bedLight: false,
  bathLight: false,
  toiletLight: false,
  lamp: false,
  tv: 'off', // off | static | room
  clockMode: 'normal', // normal | stop404 | reverse
  toy: 0,
  incense: false,
  fridgeMugs: false,
  fridgeOpen: false,
  bedBump: false,
  bathWater: false,
  curtain: 0,
  watcherN: false,
  watcherS: false,
  figure: false,
  power: true,
  keysMissing: false,
  intercomOn: false,
  elevator: 0,
  footprints: 0, // 0 なし / 1 廊下 / 2 室内まで
});

const NOTE_TEXT = [
  ['ゴミ出し\n水曜', '#fff176'],
  ['コーヒー豆\n買う', '#ffd9a0'],
  ['コーヒーは\n毎朝お願い', '#ffe3a8'],
  ['おかえり', '#fff6c8'],
];

// ------------------------------------------------------------------ 反映
export function applyState(game, opts = {}) {
  const w = game.world;
  const st = game.S.world;
  const P = w.props;
  const cache = (game._applied ||= {});

  // マグカップ
  P.mugs.forEach((m, i) => {
    m.visible = i < st.mugs;
    m.userData.steam.material.opacity = st.steam && i < st.mugs ? 0.4 : 0;
  });
  // 写真・絵・カレンダー・メモ
  const redraw = (key, mesh, val, fn) => {
    if (cache[key] === val) return;
    cache[key] = val;
    mesh.userData.redraw(fn);
  };
  redraw('photo', P.photo, st.photo, (x, cw, ch) => Art.drawFamilyPhoto(x, cw, ch, st.photo));
  redraw('drawing', P.drawing, st.drawing, (x, cw, ch) => Art.drawChildDrawing(x, cw, ch, st.drawing));
  redraw('calendar', P.calendar, st.calendar, (x, cw, ch) => Art.drawCalendar(x, cw, ch, st.calendar));
  redraw('note', P.fridgeNote, st.fridgeNote, (x, cw, ch) => Art.drawNote(x, cw, ch, NOTE_TEXT[st.fridgeNote][0], NOTE_TEXT[st.fridgeNote][1]));
  P.mail.visible = st.mail >= 0;
  if (st.mail >= 0) redraw('mail', P.mail, st.mail, (x, cw, ch) => Art.drawMail(x, cw, ch, st.mail));

  // 靴
  P.shoes.forEach((s, i) => (s.visible = i === 0 || st.shoes >= i));
  P.keys.visible = !st.keysMissing;

  // ドア
  const dBed = w.doors.bed;
  dBed.setInstant(st.bedDoor === 0 ? 0 : st.bedDoor === 1 ? AJAR : 1);
  w.doors.closetL.setInstant(st.closet >= 1 ? AJAR : 0);
  w.doors.closetR.setInstant(st.closet >= 2 ? AJAR + 0.2 : 0);

  // 椅子
  const ch = P.chairs;
  const A = ch.chairA;
  const B = ch.chairB;
  const aPose = [
    [ch.baseA.x, ch.baseA.z, ch.baseA.r],
    [ch.baseA.x - 0.06, ch.baseA.z - 0.32, ch.baseA.r + 0.38],
    [ch.baseA.x, ch.baseA.z - 0.1, ch.baseA.r + Math.PI * 0.5],
  ][st.chairA];
  const bPose = [
    [ch.baseB.x, ch.baseB.z, ch.baseB.r],
    [ch.baseB.x + 0.05, ch.baseB.z + 0.38, ch.baseB.r - 0.3],
    [ch.baseB.x, ch.baseB.z + 0.1, ch.baseB.r + Math.PI * 0.5],
  ][st.chairB];
  A.position.x = aPose[0];
  A.position.z = aPose[1];
  A.rotation.y = aPose[2];
  B.position.x = bPose[0];
  B.position.z = bPose[1];
  B.rotation.y = bPose[2];

  // ぬいぐるみ
  const toyPose = [
    [3.35, 0.6, 3.1, -0.4],
    [1.25, 0.06, 4.95, 1.2],
    [-0.25, 0.06, 4.2, Math.PI * 0.5],
  ][st.toy];
  P.toy.position.set(toyPose[0], toyPose[1], toyPose[2]);
  P.toy.rotation.y = toyPose[3];
  P.toy.rotation.z = st.toy ? Math.PI / 2 * 0.9 : 0;
  P.toy.position.y = st.toy ? 0.09 : 0.6;

  // 線香・冷蔵庫・ベッド・浴槽
  P.incense.visible = st.incense;
  P.fridgeMugs.visible = st.fridgeMugs;
  P.bedBump.visible = st.bedBump;
  P.bathWater.visible = st.bathWater;
  P.bathLid.position.x = st.bathWater ? -2.33 + 0.0 : -2.33;
  P.bathLid.position.z = st.bathWater ? 2.35 - 0.55 : 2.35;
  P.bathLid.scale.z = st.bathWater ? 0.55 : 1;
  if (!st.fridgeOpen && w.doors.fridge.target > 0) w.doors.fridge.close();
  if (st.fridgeOpen) w.doors.fridge.open(1);

  // 照明（スイッチ状態）
  const fx = w.fx;
  fx.hall.on = st.power && st.hallLight;
  fx.ldk.on = st.power && st.ldkLight;
  fx.bed.on = st.power && st.bedLight;
  fx.bath.on = st.power && st.bathLight;
  fx.toilet.on = st.power && st.toiletLight;
  fx.lamp.on = st.power && st.lamp;
  fx.bedLamp.on = false;
  for (const f of w.corridorFixtures) f.on = true;
  for (const k of ['hall', 'ldk', 'bed', 'bath', 'toilet', 'lamp']) {
    if (opts.instant) fx[k].level = fx[k].on ? 1 : 0;
  }
  // スイッチのLED表示
  for (const [k, sw] of [
    ['hallLight', P.switchHall],
    ['ldkLight', P.switchLDK],
    ['bedLight', P.switchBed],
    ['bathLight', P.switchBath],
    ['toiletLight', P.switchToilet],
  ]) {
    sw.led.material.color.setRGB(st[k] ? 0.05 : 2, st[k] ? 0.05 : 0.9, st[k] ? 0.05 : 0.3);
  }

  // テレビ
  setTV(game, st.tv);

  // 廊下の延長
  if (cache.hallDz !== st.hallDz) {
    cache.hallDz = st.hallDz;
    w.setHallDz(st.hallDz);
  }
  // 人影
  ensureFigure(game);
  if (P.figure) P.figure.visible = st.figure;
  w.watcher.visible = st.watcherN;
  w.watcherSouth.visible = st.watcherS;

  // インターホン
  P.intercom.led.material.color.setRGB(st.intercomOn ? 2.4 : 0.1, st.intercomOn ? 0.3 : 0.1, 0.1);
  // エレベーター
  if (w.elevator.setOpen && !opts.keepElevator) w.elevator.setOpen(st.elevator);
  w.elevator.indicator.userData.setText('4');
  // 足跡
  setFootprints(w, st.footprints);
}

export function ensureFigure(game) {
  const w = game.world;
  if (w.props.figure) return w.props.figure;
  const f = buildSeatedFigure(w, 'ldk');
  // 食卓の椅子A（北側）に、南向きで座る
  f.position.set(-1.62, 0, 4.58);
  f.rotation.y = 0; // 背中が北（廊下側）
  f.visible = false;
  bakeGroup(f);
  w.groups.deep.add(f);
  w.props.figure = f;
  w.pickable(f, { id: 'figure', tag: 'figure', name: '食卓の人影', dist: 3.2 });
  return f;
}

export function setTV(game, mode) {
  const w = game.world;
  const tv = w.props.tv;
  tv.mode = mode;
  tv.off.visible = mode === 'off';
  tv.on.visible = mode !== 'off';
  if (mode === 'off') {
    tv.glow.material.opacity = 0;
    game.audio?.tvOff?.();
  } else {
    game.audio?.tvOn?.(0.8, 1.0, 7.12 + w.hallDz);
  }
}

export function setFootprints(w, level) {
  // 足跡：エレベーター前(x=9)→玄関(x=0)→室内
  const list = w.props.footprints;
  const pts = [];
  if (level >= 1) {
    for (let i = 0; i < 14; i++) {
      const x = 8.4 - i * 0.6;
      pts.push([x, -0.95 + (i % 2 ? 0.14 : -0.14), Math.PI / 2 + (i % 2 ? 0.1 : -0.1), i % 2 === 0]);
    }
  }
  if (level >= 2) {
    // 玄関から廊下を抜け、LDK食卓のほうへ
    const z0 = 0.3;
    for (let i = 0; i < 9; i++) {
      pts.push([(i % 2 ? 0.1 : -0.1) * 0.8, 0.5 + i * 0.55, Math.PI, i % 2 === 0]);
    }
  }
  list.forEach((d, i) => {
    const p = pts[i];
    d.visible = !!p;
    if (!p) return;
    d.position.set(p[0], p[1] > 0.3 ? (p[1] < 1.4 ? -0.115 : 0.005) : 0.005, p[1]);
    d.rotation.y = p[2];
    d.material.opacity = 0.0;
    d.userData.target = 0.55;
  });
}

// ------------------------------------------------------------------ 毎フレーム
const _c = new THREE.Color();
export function tickWorld(game, dt, time) {
  const w = game.world;
  const P = w.props;
  const st = game.S.world;

  // 時計（針）
  const min = game.S.clock;
  let m = min;
  if (st.clockMode === 'stop404') m = 4 * 60 + 4;
  else if (st.clockMode === 'reverse') m = min - (time % 60) * 12;
  const hourA = ((m / 60) % 12) * (TAU / 12);
  const minA = (m % 60) * (TAU / 60);
  let secA = ((time % 60) * TAU) / 60;
  if (st.clockMode === 'stop404') secA = Math.sin(time * 40) * 0.05 + Math.floor(time % 2) * 0.1;
  P.clock.hour.rotation.z = -hourA;
  P.clock.minute.rotation.z = -minA;
  P.clock.sec.rotation.z = -Math.floor(secA / (TAU / 60)) * (TAU / 60) - (st.clockMode === 'stop404' ? secA : 0);

  // 目覚まし時計の表示（分が変わったときだけ描画）
  const hh = Math.floor(((st.clockMode === 'stop404' ? 4 * 60 + 4 : m) / 60 + 24) % 24);
  const mm = Math.floor(((st.clockMode === 'stop404' ? 4 * 60 + 4 : m) % 60 + 60) % 60);
  const label = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  if (game._alarmLabel !== label) {
    game._alarmLabel = label;
    const scr = P.alarm.screen;
    scr.userData.redraw((x, cw, ch) => {
      x.fillStyle = '#050505';
      x.fillRect(0, 0, cw, ch);
      x.fillStyle = '#ff3b2a';
      x.shadowColor = '#ff2a10';
      x.shadowBlur = 8;
      x.font = '700 48px "Courier New", monospace';
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(label, cw / 2, ch / 2 + 2);
    });
    scr.material.color.setRGB(1.6, 1.6, 1.6);
  }

  // テレビ
  const tv = P.tv;
  if (tv.mode !== 'off') {
    game._tvT = (game._tvT || 0) + dt;
    if (game._tvT > 0.045) {
      game._tvT = 0;
      tv.stat.userData.update(0.85, tv.mode === 'room' ? roomOverlay : null);
    }
    const f = 0.55 + Math.random() * 0.45;
    tv.glow.material.opacity = 0.32 * f;
    tv.on.material.color.setScalar(1.0 + (Math.random() - 0.5) * 0.3);
  }

  // カーテン
  const amp = game._curtainAmp ?? 0;
  const target = st.curtain * 0.11;
  game._curtainAmp = damp(amp, target, 1.4, dt);
  if (game._curtainAmp > 0.0015 || amp > 0.0015) {
    for (let i = 0; i < P.curtains.length; i++) P.curtains[i].userData.update(time, game._curtainAmp, i * 1.7);
    P.bedCurtain.userData.update(time, game._curtainAmp * 0.4, 0.5);
  }
  // 洗濯物
  if (w.laundry) w.laundry.rotation.y = 0.2 + Math.sin(time * 0.8) * 0.06 + game._curtainAmp * 2;

  // 湯気
  for (const mg of P.mugs) {
    const s = mg.userData.steam;
    if (s.material.opacity > 0.01) {
      const k = (time * 0.5 + mg.id * 0.37) % 1;
      s.position.y = 0.12 + k * 0.28;
      s.scale.setScalar(0.1 + k * 0.18);
      s.material.opacity = 0.42 * Math.sin(k * Math.PI);
    }
  }
  // 線香の煙
  if (P.incense.visible) {
    const sm = P.incense.userData.smoke;
    const k = (time * 0.35) % 1;
    sm.position.y = 0.2 + k * 0.5;
    sm.position.x = -0.008 + Math.sin(time * 1.1 + k * 4) * 0.03 * k;
    sm.scale.setScalar(0.08 + k * 0.25);
    sm.material.opacity = 0.4 * Math.sin(k * Math.PI);
  }
  // 足跡のフェードイン
  for (const d of P.footprints) {
    if (d.visible && d.userData.target !== undefined) d.material.opacity = damp(d.material.opacity, d.userData.target, 0.9, dt);
  }
  // 霧
  if (w.mist) {
    for (const s of w.mist) {
      s.position.x += s.userData.v * dt;
      if (s.position.x > 18) s.position.x = -16;
      s.material.opacity = 0.05 + Math.sin(time * 0.2 + s.userData.ph) * 0.02;
    }
  }
  // 隣戸の窓明かり
  if (w.unitWindows) {
    for (const u of w.unitWindows) {
      if (u.userData.base === undefined) u.userData.base = u.userData.lit;
    }
  }
  // 廊下の路面反射用の濡れ感：なし
}

function roomOverlay(x, w, h) {
  // 砂嵐の上に、誰かが部屋の隅に立つ（半透明）
  x.save();
  x.globalAlpha = 0.55;
  x.fillStyle = '#10141a';
  x.beginPath();
  x.ellipse(w * 0.72, h * 0.34, w * 0.07, h * 0.13, 0, 0, TAU);
  x.fill();
  x.fillRect(w * 0.64, h * 0.42, w * 0.16, h * 0.6);
  x.restore();
}
