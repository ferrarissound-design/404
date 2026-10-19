// 家具・小物・インタラクト対象
import * as THREE from 'three';
import { mkBox, mkMesh, decalFloor, bakeGroup } from '../builder.js';
import { Door, Fixture, glowSprite } from './core.js';
import { makeSimpleDoor, DIM, CEIL, DOOR_H } from './shell.js';
import * as T from '../tex.js';
import * as Art from '../art.js';
import { FONT_JP } from '../tex.js';
import { rng, TAU } from '../util.js';

export function buildFurniture(w) {
  const G = w.groups;
  w.bakeList = [];
  genkan(w, G.fixed);
  hallProps(w, G.fixed);
  wetRooms(w, G.fixed);
  ldk(w, G.deep);
  bedroom(w, G.deep);
  fixtures(w);
  bakeAll(w);
}

/** 静的メッシュ・小物グループをマテリアルごとに統合してドローコールを減らす */
function bakeAll(w) {
  const P = w.props;
  const list = [...w.bakeList, ...P.shoes, P.chairs.chairA, P.chairs.chairB, ...P.mugs, P.fridgeMugs, P.fridgeItems, P.toy, P.jacket, P.bedBump, P.slippers, P.bathLid, P.closetInside, P.keys, P.deskChair];
  if (P.figure) list.push(P.figure);
  let merged = 0;
  for (const o of list) if (o) merged += bakeGroup(o);
  for (const g of [w.groups.fixed, w.groups.deep]) merged += bakeGroup(g, { directOnly: true });
  w.bakeMerged = merged;
}

// ----------------------------------------------------------------- 共通ヘルパ
function ctx(w, grp, cast = true) {
  w.B.target = grp;
  w.B.cast = cast;
  w.B.receive = true;
}
const boxM = (w, room) => (name) => w.M.get(name, room);

function aoBox(w, grp, x0, z0, x1, z1, { pad = 0.1, op = 0.5, y = 0.004 } = {}) {
  w.decals.floor(grp, x0, z0, x1, z1, { pad, op, y });
}

function mug(w, room, color = 0xe8e4da, coffee = true) {
  const g = new THREE.Group();
  const cm = w.M.custom({ color, roughness: 0.25 }, room, 0.9);
  const body = mkMesh(new THREE.CylinderGeometry(0.04, 0.034, 0.09, 16, 1, true), cm);
  body.material.side = THREE.DoubleSide;
  body.position.y = 0.045;
  const bottom = mkMesh(new THREE.CylinderGeometry(0.034, 0.034, 0.006, 16), cm);
  bottom.position.y = 0.003;
  const handle = mkMesh(new THREE.TorusGeometry(0.026, 0.006, 6, 12, Math.PI), cm);
  handle.rotation.z = -Math.PI / 2;
  handle.position.set(0.04, 0.047, 0);
  g.add(body, bottom, handle);
  if (coffee) {
    const c = mkMesh(new THREE.CylinderGeometry(0.037, 0.037, 0.003, 16), w.M.get('coffee', room), { cast: false });
    c.position.y = 0.072;
    g.add(c);
    g.userData.coffee = c;
  }
  return g;
}

function shoePair(w, room, { color = 0x1a1613, scale = 1, heel = false, soleCol = 0x0c0c0c } = {}) {
  const g = new THREE.Group();
  const m1 = w.M.custom({ color, roughness: 0.35 }, room, 0.6);
  const m2 = w.M.custom({ color: soleCol, roughness: 0.8 }, room, 0.1);
  for (const s of [-1, 1]) {
    const sh = new THREE.Group();
    const sole = mkBox(0.095, 0.02, 0.27, m2, { cast: false });
    sole.position.set(0, 0.01, 0);
    const back = mkBox(0.085, heel ? 0.05 : 0.075, 0.14, m1, { cast: false });
    back.position.set(0, 0.02 + (heel ? 0.025 : 0.0375), 0.055);
    const toe = mkBox(0.09, 0.045, 0.13, m1, { cast: false });
    toe.position.set(0, 0.0425, -0.065);
    toe.rotation.x = 0.1;
    sh.add(sole, back, toe);
    if (heel) {
      const h = mkBox(0.02, 0.07, 0.025, m2, { cast: false });
      h.position.set(0, 0.04, 0.12);
      sh.add(h);
    }
    sh.position.set(s * 0.06 * scale, 0, 0);
    sh.rotation.y = s * 0.06;
    g.add(sh);
  }
  g.scale.setScalar(scale);
  return g;
}

function mkCurtain(w, room, matName, width, height, segX = 14, segY = 10) {
  const geo = new THREE.PlaneGeometry(width, height, segX, segY);
  const mesh = new THREE.Mesh(geo, w.M.get(matName, room));
  mesh.receiveShadow = true;
  mesh.castShadow = false;
  const base = geo.attributes.position.array.slice();
  mesh.userData.update = (time, amp, phase = 0) => {
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = base[i * 3];
      const y = base[i * 3 + 1];
      const hy = (y + height / 2) / height; // 0 下 → 1 上
      const fold = Math.sin(x * 14 + 0.3) * 0.015 * (0.4 + hy);
      const wave = Math.sin(time * 1.6 + x * 3 + phase) * amp * (1 - hy) * (1 - hy) + Math.sin(time * 2.7 + y * 2 + phase) * amp * 0.4 * (1 - hy);
      p.setZ(i, fold + wave);
    }
    p.needsUpdate = true;
    geo.computeVertexNormals();
  };
  mesh.userData.update(0, 0);
  return mesh;
}

function canvasPlane(w, room, cw, ch, pw, ph, drawFn, { env = 0.5, rough = 0.35, basic = false } = {}) {
  const tex = T.labelTexture(cw, ch, (x, a, b) => drawFn(x, a, b));
  const mat = basic ? new THREE.MeshBasicMaterial({ map: tex }) : w.M.custom({ map: tex, roughness: rough }, room, env);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(pw, ph), mat);
  mesh.userData.tex = tex;
  mesh.userData.redraw = (fn) => {
    tex.userData.ctx.clearRect(0, 0, cw, ch);
    fn(tex.userData.ctx, cw, ch);
    tex.needsUpdate = true;
  };
  return mesh;
}

// ----------------------------------------------------------------- 玄関
function genkan(w, g) {
  const { B, M } = w;
  const R = 'genkan';
  const m = (n) => M.get(n, R);
  ctx(w, g, false);
  const y0 = -0.12;
  // 下駄箱（西壁）
  const cab = m('woodLight');
  B.box(-0.9, y0, 0.28, -0.55, 0.95, 1.18, { all: cab, nx: null });
  B.collide(-0.9, 0.28, -0.52, 1.18, { y1: 1.0 });
  // 扉の目地
  const gap = m('black');
  for (const z of [0.73]) B.box(-0.553, y0 + 0.04, z - 0.004, -0.55, 0.93, z + 0.004, { px: gap });
  B.box(-0.553, 0.0, 0.3, -0.55, 0.004, 1.16, { px: gap });
  // 取っ手
  B.box(-0.552, 0.6, 0.66, -0.535, 0.7, 0.68, { all: m('chrome') });
  B.box(-0.552, 0.6, 0.78, -0.535, 0.7, 0.8, { all: m('chrome') });
  aoBox(w, g, -0.9, 0.28, -0.55, 1.18, { pad: 0.12, y: y0 + 0.004, op: 0.55 });
  // 傘立て
  const um = mkMesh(new THREE.CylinderGeometry(0.1, 0.09, 0.4, 14, 1, true), w.M.custom({ color: 0x2a3a4a, roughness: 0.5, side: THREE.DoubleSide }, R, 0.5), { cast: false });
  um.position.set(-0.68, y0 + 0.2, 1.24);
  g.add(um);
  for (const [dx, dz, tilt, col] of [
    [-0.02, 0, 0.1, 0x1d2a3a],
    [0.03, 0.02, -0.15, 0x3a1d22],
  ]) {
    const u = new THREE.Group();
    const pole = mkMesh(new THREE.CylinderGeometry(0.009, 0.009, 0.7, 6), M.get('metalDark', R), { cast: false });
    pole.position.y = 0.3;
    const cv = mkMesh(new THREE.ConeGeometry(0.05, 0.28, 10, 1, true), w.M.custom({ color: col, roughness: 0.7, side: THREE.DoubleSide }, R, 0.2), { cast: false });
    cv.position.y = 0.55;
    u.add(pole, cv);
    u.position.set(-0.68 + dx, y0 + 0.1, 1.24 + dz);
    u.rotation.z = tilt;
    g.add(u);
    w.bakeList.push(u);
  }
  w.pickable(um, { id: 'umbrella', tag: 'umbrella', name: '傘立て', dist: 2.2 });
  w.collide(-0.79, 1.15, -0.57, 1.33, { y1: 0.6 });
  // 靴（常にある：自分の革靴）
  const sh0 = shoePair(w, R, { color: 0x15110f });
  sh0.position.set(0.12, y0, 0.75);
  sh0.rotation.y = 0.35;
  g.add(sh0);
  w.pickable(sh0, { id: 'shoes', tag: 'shoes', name: '靴', dist: 2.0 });
  const shoes = [sh0];
  const sh1 = shoePair(w, R, { color: 0x7a2a30, scale: 0.92, heel: true });
  sh1.position.set(0.32, y0, 0.58);
  sh1.rotation.y = -0.25;
  sh1.visible = false;
  g.add(sh1);
  const sh2 = shoePair(w, R, { color: 0xe8a63c, scale: 0.55, soleCol: 0xdddddd });
  sh2.position.set(0.0, y0, 0.55);
  sh2.rotation.y = 0.5;
  sh2.visible = false;
  g.add(sh2);
  const sh3 = shoePair(w, R, { color: 0x20242c, scale: 1.05, soleCol: 0x0c0c0c });
  sh3.position.set(0.25, y0, 1.05);
  sh3.rotation.y = Math.PI; // こちら向き（家の中を向いている＝帰ってきた靴）
  sh3.visible = false;
  g.add(sh3);
  for (const s of [sh1, sh2, sh3]) w.pickable(s, { id: 'shoes', tag: 'shoes', name: '靴', dist: 2.0 });
  w.props.shoes = shoes.concat([sh1, sh2, sh3]);
  aoBox(w, g, -0.1, 0.4, 0.45, 1.05, { pad: 0.05, y: y0 + 0.003, op: 0.3 });

  // 鍵トレイ
  const tray = mkBox(0.16, 0.015, 0.1, M.get('woodDark', R), { cast: false });
  tray.position.set(-0.72, 0.965, 0.55);
  g.add(tray);
  const keys = new THREE.Group();
  const kr = mkMesh(new THREE.TorusGeometry(0.018, 0.003, 6, 12), M.get('chrome', R), { cast: false });
  kr.rotation.x = Math.PI / 2;
  const kb = mkBox(0.012, 0.003, 0.045, M.get('brass', R), { cast: false });
  kb.position.z = 0.032;
  const kt = mkBox(0.025, 0.012, 0.03, w.M.custom({ color: 0xc23b3b, roughness: 0.6 }, R), { cast: false });
  kt.position.set(0.02, 0, -0.02);
  keys.add(kr, kb, kt);
  keys.position.set(-0.72, 0.985, 0.55);
  keys.rotation.y = 0.4;
  g.add(keys);
  w.pickable(keys, { id: 'keys', tag: 'keys', name: '鍵', dist: 2.0 });
  w.props.keys = keys;

  // 玄関の鏡（壁掛け）
  const mir = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.5), M.get('mirror', R));
  mir.position.set(-0.895, 1.6, 0.73);
  mir.rotation.y = Math.PI / 2;
  g.add(mir);
  const mf = mkBox(0.02, 0.54, 0.38, M.get('woodDark', R), { cast: false });
  mf.position.set(-0.9, 1.6, 0.73);
  g.add(mf);
  w.pickable(mir, { id: 'genkanMirror', tag: 'mirror', name: '鏡', dist: 2.2 });

  // 上着（コート掛け・東壁）
  const hook = mkBox(0.03, 0.03, 0.3, M.get('woodDark', R), { cast: false });
  hook.position.set(0.885, 1.75, 0.45);
  g.add(hook);
  const jacket = new THREE.Group();
  const jm = w.M.custom({ color: 0x2a2e36, roughness: 0.9 }, R);
  const jb = mkBox(0.12, 0.62, 0.4, jm, { cast: false });
  jb.position.set(-0.07, -0.34, 0);
  const js = mkBox(0.1, 0.5, 0.1, jm, { cast: false });
  js.position.set(-0.07, -0.28, 0.24);
  const js2 = js.clone();
  js2.position.z = -0.24;
  jacket.add(jb, js, js2);
  jacket.position.set(0.88, 1.74, 0.45);
  g.add(jacket);
  w.pickable(jacket, { id: 'jacket', tag: 'coat', name: '上着', dist: 2.0 });
  w.props.jacket = jacket;

  // インターホン（親機）
  const intercom = new THREE.Group();
  const ib = mkBox(0.03, 0.17, 0.12, M.get('plastic', R), { cast: false });
  const scMat = new THREE.MeshBasicMaterial({ color: 0x050607 });
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.09, 0.07), scMat);
  scr.rotation.y = -Math.PI / 2;
  scr.position.set(-0.0165, 0.025, 0);
  const led = new THREE.Mesh(new THREE.PlaneGeometry(0.008, 0.008), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.1, 0.1, 0.1) }));
  led.rotation.y = -Math.PI / 2;
  led.position.set(-0.0165, -0.045, 0.03);
  const btn = mkBox(0.01, 0.03, 0.05, M.get('plasticGray', R), { cast: false });
  btn.position.set(-0.018, -0.07, 0);
  intercom.add(ib, scr, led, btn);
  intercom.position.set(0.885, 1.38, 1.0);
  g.add(intercom);
  w.pickable(intercom, { id: 'intercom', tag: 'intercom', name: 'インターホン', dist: 2.2 });
  w.props.intercom = { group: intercom, screenMat: scMat, led };

  // 分電盤（ブレーカー）
  const bk = new THREE.Group();
  const bb = mkBox(0.06, 0.34, 0.26, M.get('plasticGray', R), { cast: false });
  bk.add(bb);
  const bdoorPivot = new THREE.Group();
  bdoorPivot.position.set(-0.032, 0, 0.13);
  const bdoor = mkBox(0.012, 0.3, 0.25, M.get('plastic', R), { cast: false });
  bdoor.position.set(0, 0, -0.125);
  bdoorPivot.add(bdoor);
  bk.add(bdoorPivot);
  // 中のスイッチ列
  const swm = w.M.custom({ color: 0x20262c, roughness: 0.5 }, R);
  const sws = [];
  for (let i = 0; i < 6; i++) {
    const s = mkBox(0.012, 0.045, 0.025, swm, { cast: false });
    s.position.set(-0.03, 0.02, -0.095 + i * 0.038);
    bk.add(s);
    sws.push(s);
  }
  const main = mkBox(0.016, 0.05, 0.04, w.M.custom({ color: 0xc23b3b, roughness: 0.5 }, R), { cast: false });
  main.position.set(-0.03, -0.08, 0);
  bk.add(main);
  bk.position.set(0.87, 1.85, 0.55);
  g.add(bk);
  w.pickable(bk, { id: 'breaker', tag: 'breaker', name: '分電盤', dist: 2.2 });
  w.props.breaker = { group: bk, doorPivot: bdoorPivot, main, open: 0, on: true };

  // 照明スイッチ（玄関・廊下）
  w.props.switchHall = lightSwitch(w, g, 0.9, 1.2, 1.2, -1, 'x', 'hall', R, 'switchHall');
  // 靴箱の上の置き物（招き猫ではなく小さな観葉植物）
  const pot = mkMesh(new THREE.CylinderGeometry(0.035, 0.03, 0.06, 10), w.M.custom({ color: 0xd6d0c4, roughness: 0.6 }, R), { cast: false });
  pot.position.set(-0.72, 0.99, 0.95);
  g.add(pot);
  for (let i = 0; i < 5; i++) {
    const lf = mkMesh(new THREE.SphereGeometry(0.03, 6, 5), M.get('leaf', R), { cast: false });
    lf.scale.set(1, 1.4, 0.4);
    lf.position.set(-0.72 + Math.cos(i * 1.3) * 0.03, 1.07 + (i % 2) * 0.02, 0.95 + Math.sin(i * 1.3) * 0.03);
    lf.rotation.set(0.4 * Math.cos(i), i, 0.5);
    g.add(lf);
  }
  // 照明（ダウンライト）
  const dl = new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 2, 1.8) });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.08, 20), dl);
  disc.rotation.x = Math.PI / 2;
  disc.position.set(0, CEIL - 0.003, 0.7);
  g.add(disc);
  w.fx.hall.addEmissive(dl, 2.2);
  // 玄関に落ちる光だまり
  const gl = glowSprite(w.tex.glow, 0xfff0dc, 1.8, 0.25);
  gl.position.set(0, 2.1, 0.7);
  g.add(gl);
  w.fx.hall.addGlow(gl, 1);
}

/** 壁スイッチ。plane: 壁の座標、facing: 面が向く向き */
function lightSwitch(w, g, plane, z, y, facing, axis, room, R, id) {
  const M = w.M;
  const plate = mkBox(axis === 'x' ? 0.012 : 0.09, 0.12, axis === 'x' ? 0.09 : 0.012, M.get('plastic', R), { cast: false });
  const t = 0.006;
  const sw = mkBox(axis === 'x' ? 0.01 : 0.025, 0.04, axis === 'x' ? 0.025 : 0.01, M.get('plasticGray', R), { cast: false });
  const grp = new THREE.Group();
  grp.add(plate);
  grp.add(sw);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.006, 0.006), new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 0.9, 0.3) }));
  grp.add(led);
  if (axis === 'x') {
    sw.position.set(facing * 0.01, 0, 0);
    led.position.set(facing * 0.008, -0.045, 0);
    grp.position.set(plane + facing * t, y, z);
  } else {
    sw.position.set(0, 0, facing * 0.01);
    led.position.set(0, -0.045, facing * 0.008);
    grp.position.set(z, y, plane + facing * t);
  }
  g.add(grp);
  w.pickable(grp, { id, tag: 'switch', name: '照明スイッチ', dist: 2.0 });
  return { group: grp, sw, led };
}

// ----------------------------------------------------------------- 廊下
function hallProps(w, g) {
  const { B, M } = w;
  const R = 'hall';
  ctx(w, g, false);
  // シーリングライト
  const fx = w.fx.hall;
  const fixt = mkMesh(new THREE.CylinderGeometry(0.26, 0.26, 0.06, 28), M.get('plastic', R), { cast: false, receive: false });
  fixt.position.set(0, CEIL - 0.03, 2.1);
  g.add(fixt);
  const em = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.1, 1.9) });
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.235, 28), em);
  disc.rotation.x = Math.PI / 2;
  disc.position.set(0, CEIL - 0.062, 2.1);
  g.add(disc);
  fx.addEmissive(em, 2.3);
  const gl = glowSprite(w.tex.glow, 0xfff0dc, 2.4, 0.32);
  gl.position.set(0, CEIL - 0.25, 2.1);
  g.add(gl);
  fx.addGlow(gl, 1);
  w.props.hallLight = { fixt, em };

  // 子どもの絵
  const frame = mkBox(0.02, 0.4, 0.5, M.get('woodLight', R), { cast: false });
  frame.position.set(-0.89, 1.38, 3.05);
  g.add(frame);
  const dr = canvasPlane(w, R, 512, 410, 0.44, 0.35, (x, cw, ch) => Art.drawChildDrawing(x, cw, ch, 0), { rough: 0.7, env: 0.1 });
  dr.rotation.y = Math.PI / 2;
  dr.position.set(-0.878, 1.38, 3.05);
  g.add(dr);
  w.pickable(dr, { id: 'drawing', tag: 'drawing', name: '子どもの絵', dist: 2.2 });
  w.props.drawing = dr;

  // スリッパ
  const sl = new THREE.Group();
  const sm = w.M.custom({ color: 0x8a7a6a, roughness: 0.9 }, R);
  for (const s of [-1, 1]) {
    const a = mkBox(0.1, 0.03, 0.26, sm, { cast: false });
    a.position.set(s * 0.065, 0.015, 0);
    sl.add(a);
  }
  sl.position.set(0.45, 0, 1.6);
  sl.rotation.y = 0.15;
  g.add(sl);
  w.props.slippers = sl;
  aoBox(w, g, 0.3, 1.45, 0.6, 1.75, { pad: 0.04, op: 0.35 });

  // スイッチ類
  w.props.switchBath = lightSwitch(w, g, -0.9, 2.78, 1.2, +1, 'x', 'hall', R, 'switchBath');
  w.props.switchToilet = lightSwitch(w, g, 0.9, 2.48, 1.2, -1, 'x', 'hall', R, 'switchToilet');
  // 壁の温度計
  const th = mkBox(0.012, 0.16, 0.05, M.get('plastic', R), { cast: false });
  th.position.set(0.894, 1.55, 2.9);
  g.add(th);
  // 廊下の電話台（固定電話の跡：何も置かれていない台）
  const stand = mkBox(0.3, 0.8, 0.35, M.get('woodDark', R), { cast: true });
  stand.position.set(-0.74, 0.4, 3.18);
  g.add(stand);
  w.collide(-0.9, 3.0, -0.59, 3.37, { y1: 0.9 });
  aoBox(w, g, -0.9, 3.0, -0.59, 3.37, { pad: 0.08, op: 0.5 });
  const ph = mkBox(0.2, 0.08, 0.2, M.get('plasticDark', R), { cast: false });
  ph.position.set(-0.74, 0.84, 3.18);
  g.add(ph);
  w.pickable(ph, { id: 'homePhone', tag: 'phone', name: '固定電話', dist: 2.0 });
  w.props.homePhone = ph;
}

// ----------------------------------------------------------------- 水回り
function wetRooms(w, g) {
  const { B, M } = w;
  const R = 'bath';
  ctx(w, g, false);
  const m = (n) => M.get(n, R);
  // 浴槽
  const tub = m('ceramic');
  B.box(-2.68, 0, 1.45, -1.98, 0.6, 3.25, { all: tub });
  B.collide(-2.68, 1.45, -1.98, 3.25, { y1: 0.7 });
  // 蓋（折りたたみ式）
  const lid = new THREE.Group();
  const lidM = m('plasticGray');
  for (let i = 0; i < 3; i++) {
    const p = mkBox(0.66, 0.012, 0.58, lidM, { cast: false });
    p.position.set(0, 0, -0.6 + i * 0.6);
    lid.add(p);
  }
  lid.position.set(-2.33, 0.606, 2.35);
  g.add(lid);
  w.pickable(lid, { id: 'bathtub', tag: 'bath', name: '浴槽', dist: 2.2 });
  w.props.bathLid = lid;
  // 水面（蓋を外すと見える）
  const water = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 1.66), new THREE.MeshStandardMaterial({ color: 0x0a0e10, roughness: 0.04, metalness: 0.2, envMap: w.env, envMapIntensity: 1.4 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(-2.33, 0.5, 2.35);
  g.add(water);
  w.props.bathWater = water;
  water.visible = false;
  // 蛇口・シャワー
  const fa = mkMesh(new THREE.CylinderGeometry(0.014, 0.014, 0.16, 8), m('chrome'), { cast: false });
  fa.rotation.z = Math.PI / 2;
  fa.position.set(-2.1, 0.95, 1.42);
  g.add(fa);
  const sh = mkMesh(new THREE.CylinderGeometry(0.05, 0.04, 0.02, 12), m('chrome'), { cast: false });
  sh.position.set(-2.34, 1.7, 1.45);
  sh.rotation.x = Math.PI / 2 - 0.3;
  g.add(sh);
  // 洗面台（北壁）
  B.box(-1.95, 0, 1.4, -1.3, 0.82, 1.85, { all: m('trim') });
  B.collide(-1.95, 1.4, -1.3, 1.85, { y1: 1.0 });
  B.box(-1.9, 0.82, 1.4, -1.35, 0.86, 1.82, { all: m('ceramic') });
  const basin = mkMesh(new THREE.CylinderGeometry(0.17, 0.12, 0.05, 16), m('ceramic'), { cast: false });
  basin.position.set(-1.62, 0.87, 1.62);
  g.add(basin);
  const bfa = mkMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 8), m('chrome'), { cast: false });
  bfa.position.set(-1.62, 0.95, 1.46);
  bfa.rotation.x = Math.PI / 2 - 0.4;
  g.add(bfa);
  // 鏡
  const mirror = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.75), m('mirror'));
  mirror.position.set(-1.62, 1.55, 1.405);
  g.add(mirror);
  const mfr = mkBox(0.6, 0.8, 0.02, m('plastic'), { cast: false });
  mfr.position.set(-1.62, 1.55, 1.402 - 0.012);
  g.add(mfr);
  w.pickable(mirror, { id: 'bathMirror', tag: 'mirror', name: '洗面所の鏡', dist: 2.4 });
  w.props.bathMirror = mirror;
  // 鏡に映る何か（普段は非表示）
  const ghost = canvasPlane(w, R, 128, 256, 0.36, 0.72, (x, cw, ch) => {
    const gr = x.createRadialGradient(cw / 2, ch * 0.25, 4, cw / 2, ch * 0.4, ch * 0.5);
    gr.addColorStop(0, 'rgba(235,240,245,0.9)');
    gr.addColorStop(1, 'rgba(235,240,245,0)');
    x.fillStyle = gr;
    x.beginPath();
    x.ellipse(cw / 2, ch * 0.22, cw * 0.2, ch * 0.12, 0, 0, TAU);
    x.fill();
    x.fillRect(cw * 0.25, ch * 0.3, cw * 0.5, ch * 0.7);
  }, { basic: true });
  ghost.material.transparent = true;
  ghost.material.opacity = 0;
  ghost.material.depthWrite = false;
  ghost.position.set(-1.62, 1.55, 1.4 + 0.004);
  ghost.renderOrder = 4;
  g.add(ghost);
  w.props.mirrorGhost = ghost;
  // 洗濯機
  const wm = new THREE.Group();
  const wb = mkBox(0.6, 0.95, 0.6, m('plastic'), { cast: false });
  wb.position.y = 0.475;
  const wg = mkMesh(new THREE.CircleGeometry(0.16, 20), m('glass'), { cast: false, receive: false });
  wg.position.set(0, 0.5, -0.301);
  wg.rotation.y = Math.PI;
  const wd = mkMesh(new THREE.CircleGeometry(0.19, 20), m('metalDark'), { cast: false });
  wd.position.set(0, 0.5, -0.3);
  wd.rotation.y = Math.PI;
  wm.add(wb, wd, wg);
  wm.position.set(-1.38, 0, 2.97);
  wm.rotation.y = 0;
  g.add(wm);
  w.bakeList.push(wm);
  w.collide(-1.7, 2.65, -1.08, 3.28, { y1: 1.0 });
  w.pickable(wb, { id: 'washer', tag: 'washer', name: '洗濯機', dist: 2.2 });
  // 浴室ドア側のタオル掛けなど
  const rail = mkBox(0.02, 0.02, 0.5, m('chrome'), { cast: false });
  rail.position.set(-1.04, 1.25, 1.65);
  g.add(rail);
  const towel = mkBox(0.03, 0.35, 0.3, w.M.custom({ color: 0xcfd6d8, roughness: 0.95 }, R), { cast: false });
  towel.position.set(-1.07, 1.07, 1.65);
  g.add(towel);
  // 換気扇
  const vent = mkBox(0.3, 0.02, 0.3, m('plastic'), { cast: false });
  vent.position.set(-1.25, CEIL - 0.01, 2.9);
  g.add(vent);
  // 浴室照明（天井）
  const bf = w.fx.bath;
  const bem = new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 2, 2) });
  const bdisc = new THREE.Mesh(new THREE.CircleGeometry(0.17, 22), bem);
  bdisc.rotation.x = Math.PI / 2;
  bdisc.position.set(-1.85, CEIL - 0.004, 2.35);
  g.add(bdisc);
  const bgl = glowSprite(w.tex.glow, 0xf4f8ff, 1.4, 0.3);
  bgl.position.set(-1.85, CEIL - 0.25, 2.35);
  g.add(bgl);
  bf.addEmissive(bem, 2.3);
  bf.addGlow(bgl, 1);
  // 洗面のカゴ・歯ブラシ
  const cup = mkMesh(new THREE.CylinderGeometry(0.03, 0.025, 0.09, 10), m('ceramic'), { cast: false });
  cup.position.set(-1.45, 0.91, 1.6);
  g.add(cup);
  for (let i = 0; i < 2; i++) {
    const tb = mkBox(0.01, 0.16, 0.012, w.M.custom({ color: i ? 0x3b6ea8 : 0xd45a6a, roughness: 0.5 }, R), { cast: false });
    tb.position.set(-1.45 + (i ? 0.012 : -0.008), 1.0, 1.6);
    tb.rotation.z = i ? -0.1 : 0.12;
    g.add(tb);
  }
  aoBox(w, g, -2.68, 1.45, -1.98, 3.25, { pad: 0.08, op: 0.5 });

  // ---- トイレ
  const R2 = 'toilet';
  const m2 = (n) => M.get(n, R2);
  const t = DIM.toilet;
  const bowl = mkMesh(new THREE.CylinderGeometry(0.18, 0.15, 0.4, 18), m2('ceramic'));
  bowl.scale.set(1.0, 1, 1.35);
  bowl.position.set(1.7, 0.2, 2.15);
  bowl.rotation.y = Math.PI / 2;
  g.add(bowl);
  const seat = mkMesh(new THREE.CylinderGeometry(0.19, 0.19, 0.03, 18), m2('plastic'), { cast: false });
  seat.scale.set(1, 1, 1.3);
  seat.position.set(1.7, 0.42, 2.15);
  seat.rotation.y = Math.PI / 2;
  g.add(seat);
  const tank = mkBox(0.2, 0.34, 0.4, m2('ceramic'));
  tank.position.set(1.98, 0.57, 2.0);
  g.add(tank);
  w.collide(1.5, 1.82, 2.1, 2.3, { y1: 0.9 });
  w.pickable(bowl, { id: 'toiletBowl', tag: 'toilet', name: 'トイレ', dist: 2.2 });
  const holder = mkBox(0.06, 0.1, 0.16, m2('plastic'), { cast: false });
  holder.position.set(1.05, 0.95, 2.45);
  g.add(holder);
  const roll = mkMesh(new THREE.CylinderGeometry(0.05, 0.05, 0.11, 12), w.M.custom({ color: 0xf5f3ee, roughness: 0.9 }, R2), { cast: false });
  roll.rotation.x = Math.PI / 2;
  roll.position.set(1.085, 0.97, 2.45);
  g.add(roll);
  const tem = new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.9, 1.7) });
  const tdisc = new THREE.Mesh(new THREE.CircleGeometry(0.13, 20), tem);
  tdisc.rotation.x = Math.PI / 2;
  tdisc.position.set(1.55, CEIL - 0.004, 1.97);
  g.add(tdisc);
  const tgl = glowSprite(w.tex.glow, 0xfff0dc, 1.2, 0.28);
  tgl.position.set(1.55, CEIL - 0.25, 1.97);
  g.add(tgl);
  // トイレ用のFixture（光源はWetを共有）
  const tf = new Fixture(w, { id: 'toilet', room: 'toilet', light: null, intensity: 1, color: 0xfff0dc, pos: new THREE.Vector3(1.55, 2.3, 1.97), hum: 0.2, on: false, shared: true });
  tf.addEmissive(tem, 2.3);
  tf.addGlow(tgl, 1);
  w.fixtures.push(tf);
  w.fx.toilet = tf;
  aoBox(w, g, 1.5, 1.82, 2.1, 2.3, { pad: 0.12, op: 0.5 });
}

// ----------------------------------------------------------------- LDK
function ldk(w, g) {
  const { B, M } = w;
  const R = 'ldk';
  const m = (n) => M.get(n, R);
  const D = DIM.ldk;
  ctx(w, g, true);

  // ---- キッチンカウンター（北壁沿い）
  const cabM = m('woodLight');
  const cx0 = -2.85;
  const cx1 = -0.78;
  B.box(cx0, 0, 3.64, cx1, 0.84, 4.22, { all: cabM, nz: null });
  B.box(cx0, 0.84, 3.64, cx1, 0.87, 4.26, { all: m('metal') });
  B.collide(cx0, 3.62, cx1, 4.27, { y1: 1.0 });
  // 扉の目地
  const blk = m('black');
  for (const x of [-2.25, -1.65, -1.2]) B.box(x - 0.004, 0.05, 4.218, x + 0.004, 0.82, 4.222, { pz: blk });
  B.box(cx0, 0.04, 4.218, cx1, 0.05, 4.222, { pz: blk });
  // 取っ手
  for (const x of [-2.55, -1.95, -1.42, -1.0]) B.box(x - 0.1, 0.7, 4.222, x + 0.1, 0.72, 4.24, { all: m('chrome') });
  // 吊戸棚
  B.box(cx0, 1.5, 3.64, cx1 + 0.4, 2.2, 3.98, { all: cabM, nz: null });
  for (const x of [-2.25, -1.65, -1.05]) B.box(x - 0.004, 1.52, 3.978, x + 0.004, 2.18, 3.982, { pz: blk });
  // レンジフード
  B.box(-1.95, 1.2, 3.64, -1.4, 1.5, 4.05, { all: m('metalDark') });
  B.box(-1.9, 1.5, 3.64, -1.45, 2.4, 3.8, { all: m('metalDark') });
  // 壁タイル
  B.wall(M.get('tile', R), 'z', 3.625, cx0, cx1, 0.87, 1.5, +1);
  // IHコンロ
  B.box(-1.95, 0.87, 3.7, -1.4, 0.875, 4.15, { all: m('plasticDark') });
  for (const [x, z] of [
    [-1.78, 3.9],
    [-1.57, 4.0],
  ]) {
    const ring = mkMesh(new THREE.TorusGeometry(0.07, 0.004, 4, 20), m('metalDark'), { cast: false });
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.88, z);
    g.add(ring);
  }
  // シンク
  B.box(-2.8, 0.87, 3.7, -2.3, 0.872, 4.15, { all: m('metalDark') });
  const faucet = mkMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.3, 8), m('chrome'), { cast: false });
  faucet.position.set(-2.55, 1.02, 3.72);
  g.add(faucet);
  const spout = mkMesh(new THREE.TorusGeometry(0.1, 0.012, 6, 10, Math.PI), m('chrome'), { cast: false });
  spout.rotation.set(0, 0, 0);
  spout.position.set(-2.55, 1.15, 3.8);
  spout.rotation.y = Math.PI / 2;
  g.add(spout);
  w.props.sinkFaucet = faucet;
  w.pickable(faucet, { id: 'sink', tag: 'sink', name: '流し台', dist: 2.2 });
  // 食器かご・洗剤
  const rack = mkBox(0.34, 0.1, 0.22, m('plasticGray'), { cast: false });
  rack.position.set(-2.1, 0.92, 3.85);
  g.add(rack);
  for (let i = 0; i < 4; i++) {
    const pl = mkMesh(new THREE.CylinderGeometry(0.08, 0.08, 0.006, 14), m('ceramic'), { cast: false });
    pl.rotation.z = Math.PI / 2;
    pl.position.set(-2.22 + i * 0.07, 0.99, 3.85);
    g.add(pl);
  }
  // ケトル
  const kettle = mkMesh(new THREE.CylinderGeometry(0.075, 0.09, 0.2, 14), m('plastic'));
  kettle.position.set(-1.5, 1.0, 4.1);
  g.add(kettle);
  w.pickable(kettle, { id: 'kettle', tag: 'kitchen', name: '電気ケトル', dist: 2.2 });
  // コーヒーメーカー
  const cm = new THREE.Group();
  const cb = mkBox(0.18, 0.3, 0.2, m('plasticDark'));
  cb.position.set(0, 0.15, 0);
  const cpot = mkMesh(new THREE.CylinderGeometry(0.055, 0.05, 0.14, 12, 1, true), w.M.custom({ color: 0xbfd2d8, roughness: 0.05, transparent: true, opacity: 0.35, side: THREE.DoubleSide }, R, 1.4), { cast: false });
  cpot.position.set(0, 0.08, 0.1);
  const cfill = mkMesh(new THREE.CylinderGeometry(0.052, 0.049, 0.07, 12), m('coffee'), { cast: false });
  cfill.position.set(0, 0.045, 0.1);
  cm.add(cb, cpot, cfill);
  cm.position.set(-0.95, 0.87, 3.95);
  g.add(cm);
  w.pickable(cm, { id: 'coffeeMaker', tag: 'coffee', name: 'コーヒーメーカー', dist: 2.2 });
  w.props.coffeeMaker = cm;
  // 電子レンジ・炊飯器
  // ゴミ箱
  const trash = mkBox(0.26, 0.52, 0.26, m('plasticGray'));
  trash.position.set(-0.62, 0.26, 4.0);
  g.add(trash);
  w.collide(-0.76, 3.87, -0.48, 4.15, { y1: 0.6 });
  w.pickable(trash, { id: 'trash', tag: 'kitchen', name: 'ゴミ箱', dist: 2.0 });

  // ---- 冷蔵庫（北西の隅、南向き）
  const fridgeX0 = -3.55;
  const fridgeX1 = -2.9;
  const fz0 = 3.66;
  const fz1 = 4.32;
  const fm = m('fridge');
  B.box(fridgeX0, 0.04, fz0, fridgeX1, 1.78, fz0 + 0.05, { all: m('white') });
  B.box(fridgeX0, 0.04, fz0, fridgeX0 + 0.05, 1.78, fz1 - 0.04, { all: m('white') });
  B.box(fridgeX1 - 0.05, 0.04, fz0, fridgeX1, 1.78, fz1 - 0.04, { all: m('white') });
  B.box(fridgeX0, 1.73, fz0, fridgeX1, 1.78, fz1 - 0.04, { all: m('white') });
  B.box(fridgeX0, 0.04, fz0, fridgeX1, 0.09, fz1 - 0.04, { all: m('white') });
  B.box(fridgeX0 + 0.05, 1.18, fz0 + 0.05, fridgeX1 - 0.05, 1.2, fz1 - 0.06, { all: m('white') });
  B.box(fridgeX0 + 0.05, 0.62, fz0 + 0.05, fridgeX1 - 0.05, 0.635, fz1 - 0.06, { all: m('white') });
  B.box(fridgeX0, 0, fz0, fridgeX1, 0.04, fz1, { all: m('black') });
  B.collide(fridgeX0, fz0, fridgeX1, fz1 + 0.02, { y1: 1.85 });
  // 内部の照明
  const fem = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.4, 2.2) });
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.04), fem);
  fl.rotation.x = Math.PI / 2;
  fl.position.set(-3.225, 1.72, 3.98);
  g.add(fl);
  fem.color.setScalar(0);
  // 内容物
  const items = new THREE.Group();
  const food = [
    [0.07, 0.2, 0xddddcc, -3.4, 0.71, 3.85],
    [0.06, 0.16, 0xb04030, -3.3, 0.7, 3.95],
    [0.05, 0.25, 0x4a8c4a, -3.2, 0.75, 3.8],
    [0.18, 0.1, 0xe8e4d8, -3.1, 0.68, 4.0],
    [0.08, 0.1, 0xd8b040, -3.35, 1.25, 3.9],
    [0.12, 0.18, 0x8a6a4a, -3.15, 1.28, 3.95],
  ];
  for (const [rw, rh, col, x, y, z] of food) {
    const b = mkBox(rw, rh, rw, w.M.custom({ color: col, roughness: 0.6 }, R), { cast: false });
    b.position.set(x, y + rh / 2 - 0.05, z);
    items.add(b);
  }
  g.add(items);
  w.props.fridgeItems = items;
  // 冷蔵庫に入るマグカップ（後半の怪異）
  const fmugs = new THREE.Group();
  for (let i = 0; i < 3; i++) {
    const mg = mug(w, R, 0xe8e4da, false);
    mg.position.set(-3.38 + i * 0.12, 0.64, 3.82 + (i % 2) * 0.1);
    fmugs.add(mg);
  }
  fmugs.visible = false;
  g.add(fmugs);
  w.props.fridgeMugs = fmugs;
  // 扉（ヒンジ西側）
  const fpivot = new THREE.Group();
  fpivot.position.set(fridgeX0, 0, fz1);
  g.add(fpivot);
  const fdoor = mkBox(0.65, 1.74, 0.05, fm, { cast: true });
  fdoor.position.set(0.325, 0.87, -0.0);
  fpivot.add(fdoor);
  const fsplit = mkBox(0.65, 0.006, 0.052, m('black'), { cast: false });
  fsplit.position.set(0.325, 1.2, 0);
  fpivot.add(fsplit);
  const fh = mkBox(0.02, 0.5, 0.03, m('chrome'), { cast: false });
  fh.position.set(0.6, 0.9, 0.04);
  fpivot.add(fh);
  fpivot.userData.light = fem;
  const fdr = new Door(w, {
    id: 'fridge',
    pivot: fpivot,
    closedAngle: 0,
    openAngle: -Math.PI * 0.55,
    pos: new THREE.Vector3(-3.2, 1, 4.3),
    sound: 'fridge',
    speed: 2.0,
  });
  fdr.deep = true;
  w.doors.fridge = fdr;
  w.pickable(fdoor, { id: 'fridge', tag: 'fridge', name: '冷蔵庫', dist: 2.4, door: 'fridge' });
  w.props.fridge = { door: fdr, light: fem, pivot: fpivot };
  // 付箋・マグネット
  const note = canvasPlane(w, R, 256, 128, 0.12, 0.06, (x, cw, ch) => Art.drawNote(x, cw, ch, 'ゴミ出し\n水曜', '#fff176'), { rough: 0.9, env: 0 });
  note.position.set(0.28, 1.45, 0.0275);
  note.rotation.z = 0.05;
  fpivot.add(note);
  w.props.fridgeNote = note;
  w.pickable(note, { id: 'fridgeNote', tag: 'note', name: '冷蔵庫のメモ', dist: 2.2 });
  const mag = mkMesh(new THREE.CylinderGeometry(0.014, 0.014, 0.006, 10), w.M.custom({ color: 0xc23b3b }, R), { cast: false });
  mag.rotation.x = Math.PI / 2;
  mag.position.set(0.22, 1.5, 0.028);
  fpivot.add(mag);
  aoBox(w, g, fridgeX0, fz0, fridgeX1, fz1, { pad: 0.1, op: 0.5 });
  aoBox(w, g, cx0, 3.64, cx1, 4.26, { pad: 0.1, op: 0.45 });

  // ---- ダイニングテーブルと椅子
  const tx0 = -2.25;
  const tx1 = -1.0;
  const tz0 = 4.9;
  const tz1 = 5.65;
  const topM = m('woodLight');
  const table = new THREE.Group();
  const top = mkBox(tx1 - tx0, 0.04, tz1 - tz0, topM);
  top.position.set((tx0 + tx1) / 2, 0.72, (tz0 + tz1) / 2);
  table.add(top);
  for (const [lx, lz] of [
    [tx0 + 0.06, tz0 + 0.06],
    [tx1 - 0.06, tz0 + 0.06],
    [tx0 + 0.06, tz1 - 0.06],
    [tx1 - 0.06, tz1 - 0.06],
  ]) {
    const lg = mkBox(0.05, 0.7, 0.05, m('woodDark'));
    lg.position.set(lx, 0.35, lz);
    table.add(lg);
  }
  g.add(table);
  w.bakeList.push(table);
  w.pickable(top, { id: 'table', tag: 'table', name: 'ダイニングテーブル', dist: 2.6 });
  w.collide(tx0, tz0, tx1, tz1, { y1: 0.75 });
  aoBox(w, g, tx0, tz0, tx1, tz1, { pad: 0.2, op: 0.4 });

  const mkChair = (id) => {
    const c = new THREE.Group();
    const wd = m('woodDark');
    const seat = mkBox(0.42, 0.04, 0.42, m('fabricSofa'));
    seat.position.y = 0.45;
    c.add(seat);
    for (const [lx, lz] of [
      [-0.18, -0.18],
      [0.18, -0.18],
      [-0.18, 0.18],
      [0.18, 0.18],
    ]) {
      const l = mkBox(0.035, 0.44, 0.035, wd);
      l.position.set(lx, 0.22, lz);
      c.add(l);
    }
    const back = mkBox(0.42, 0.4, 0.035, wd);
    back.position.set(0, 0.7, 0.2);
    c.add(back);
    w.pickable(c, { id, tag: 'chair', name: '椅子', dist: 2.4 });
    return c;
  };
  const chA = mkChair('chairA');
  chA.position.set(-1.62, 0, 4.55);
  chA.rotation.y = Math.PI; // 背もたれが北
  g.add(chA);
  const chB = mkChair('chairB');
  chB.position.set(-1.62, 0, 6.0);
  g.add(chB);
  w.props.chairs = { chairA: chA, chairB: chB, baseA: { x: -1.62, z: 4.55, r: Math.PI }, baseB: { x: -1.62, z: 6.0, r: 0 } };
  aoBox(w, g, -1.85, 4.35, -1.4, 4.75, { pad: 0.05, op: 0.35 });
  aoBox(w, g, -1.85, 5.8, -1.4, 6.2, { pad: 0.05, op: 0.35 });

  // 鞄（椅子B）
  const bag = new THREE.Group();
  const bagBody = mkBox(0.38, 0.28, 0.1, w.M.custom({ color: 0x1b1d22, roughness: 0.6 }, R, 0.3));
  bagBody.position.set(0, 0.14, 0);
  const strap = mkBox(0.34, 0.01, 0.01, m('black'), { cast: false });
  strap.position.set(0, 0.29, 0);
  bag.add(bagBody, strap);
  bag.position.set(-1.62, 0.47, 6.0);
  bag.rotation.y = 0.2;
  g.add(bag);
  w.bakeList.push(bag);
  w.pickable(bag, { id: 'bag', tag: 'bag', name: '通勤鞄', dist: 2.4 });

  // マグカップ（最大7つ）
  const mugSlots = [
    [-1.4, 0.74, 5.2, 0.4], // 0 食卓：自分の
    [-1.85, 0.74, 5.4, 2.2], // 1 食卓
    [-1.05, 0.875, 4.05, 1.0], // 2 カウンター
    [-0.6, 0.4, 7.1, 0.3], // 3 ローテーブル
    [-3.42, 1.4, 6.9, 0.0], // 4 棚
    [0.5, 0.45, 7.3, 0.0], // 5 TVボード
    [0.0, 0.0, 3.9, 0.0], // 6 廊下側（LDK入口の床）
  ];
  const mugColors = [0xe8e4da, 0xdbd6c8, 0xc9d6d2, 0xe6d9c0, 0xd2dae4, 0xe3d2d2, 0xe8e4da];
  w.props.mugs = mugSlots.map((s, i) => {
    const mg = mug(w, R, mugColors[i], true);
    mg.position.set(s[0], s[1], s[2]);
    mg.rotation.y = s[3];
    mg.visible = i === 0;
    g.add(mg);
    w.pickable(mg, { id: 'mug' + i, tag: 'mug', name: 'マグカップ', dist: 2.4, idx: i });
    // 湯気
    const st = glowSprite(w.tex.glow, 0xdcdcdc, 0.14, 0.0);
    st.position.set(0, 0.16, 0);
    mg.add(st);
    mg.userData.steam = st;
    return mg;
  });
  // 食卓の上：郵便物
  const mail = canvasPlane(w, R, 256, 180, 0.3, 0.2, (x, cw, ch) => Art.drawMail(x, cw, ch, 0), { rough: 0.9, env: 0 });
  mail.rotation.x = -Math.PI / 2;
  mail.rotation.z = 0.35;
  mail.position.set(-1.95, 0.742, 5.3);
  g.add(mail);
  w.pickable(mail, { id: 'mail', tag: 'mail', name: '郵便物', dist: 2.4 });
  w.props.mail = mail;

  // ---- 壁時計
  const clock = new THREE.Group();
  const cface = canvasPlane(w, R, 256, 256, 0.34, 0.34, (x, cw) => Art.drawClockFace(x, cw), { rough: 0.5, env: 0.4 });
  cface.position.z = 0.025;
  const cring = mkMesh(new THREE.CylinderGeometry(0.18, 0.18, 0.04, 28), m('woodDark'), { cast: false });
  cring.rotation.x = Math.PI / 2;
  cring.position.z = 0.0;
  clock.add(cring, cface);
  const hm = m('black');
  const hour = new THREE.Group();
  const hb = mkBox(0.014, 0.1, 0.004, hm, { cast: false });
  hb.position.y = 0.04;
  hour.add(hb);
  hour.position.z = 0.03;
  const minute = new THREE.Group();
  const mb = mkBox(0.01, 0.14, 0.004, hm, { cast: false });
  mb.position.y = 0.055;
  minute.add(mb);
  minute.position.z = 0.034;
  const sec = new THREE.Group();
  const sb = mkBox(0.004, 0.15, 0.003, w.M.custom({ color: 0xaa2222 }, R), { cast: false });
  sb.position.y = 0.04;
  sec.add(sb);
  sec.position.z = 0.038;
  hour.userData.noBake = minute.userData.noBake = sec.userData.noBake = true;
  clock.add(hour, minute, sec);
  clock.position.set(-3.58, 1.95, 4.85);
  clock.rotation.y = Math.PI / 2;
  g.add(clock);
  w.pickable(cface, { id: 'clock', tag: 'clock', name: '壁掛け時計', dist: 3.2 });
  w.props.clock = { group: clock, hour, minute, sec, pos: new THREE.Vector3(-3.55, 1.95, 4.85) };

  // ---- カレンダー
  const cal = canvasPlane(w, R, 256, 360, 0.3, 0.42, (x, cw, ch) => Art.drawCalendar(x, cw, ch, 0), { rough: 0.8, env: 0.1 });
  cal.rotation.y = Math.PI / 2;
  cal.position.set(-3.585, 1.5, 5.45);
  g.add(cal);
  w.pickable(cal, { id: 'calendar', tag: 'calendar', name: 'カレンダー', dist: 3.0 });
  w.props.calendar = cal;

  // ---- 棚と家族写真（西壁）
  const sx1 = -3.28;
  const sm = m('woodDark');
  B.box(-3.6, 0, 5.9, sx1, 1.7, 6.0, { all: sm });
  B.box(-3.6, 0, 7.4, sx1, 1.7, 7.5, { all: sm });
  B.box(-3.6, 0, 5.9, -3.58, 1.7, 7.5, { all: sm });
  for (const y of [0.02, 0.45, 0.85, 1.25, 1.68]) B.box(-3.6, y, 5.9, sx1, y + 0.025, 7.5, { all: sm });
  B.collide(-3.6, 5.9, sx1, 7.5, { y1: 1.75 });
  // 本（色は少数のパレットを共有してバッチ数を抑える）
  const rb = rng(9);
  const bookMats = [0x5a6a8a, 0x8a5a5a, 0x6a8a6a, 0xb0a070, 0x4a4a52, 0x8a7a9a].map((c) => w.M.custom({ color: c, roughness: 0.8 }, R, 0.05));
  for (const sy of [0.025 + 0.025, 0.475]) {
    let z = 6.05;
    while (z < 7.0) {
      const bw = rb.range(0.02, 0.045);
      const bh = rb.range(0.18, 0.3);
      B.box(-3.55, sy, z, -3.4, sy + bh, z + bw, { all: bookMats[rb.int(0, bookMats.length - 1)] });
      z += bw + 0.002;
    }
  }
  // 家族写真
  const pframe = mkBox(0.03, 0.3, 0.4, m('woodBlack'), { cast: true });
  pframe.position.set(-3.43, 1.0, 6.7);
  pframe.rotation.y = -0.15;
  g.add(pframe);
  const photo = canvasPlane(w, R, 512, 384, 0.36, 0.27, (x, cw, ch) => Art.drawFamilyPhoto(x, cw, ch, 0), { rough: 0.25, env: 0.7 });
  photo.rotation.y = Math.PI / 2 - 0.15;
  photo.position.set(-3.413, 1.0, 6.7);
  g.add(photo);
  w.pickable(photo, { id: 'photo', tag: 'photo', name: '家族写真', dist: 3.0 });
  w.props.photo = photo;
  // 遺影用の黒リボンはphotoのcanvas内（variant 3）に描画

  // 線香（後半に出現）
  const inc = new THREE.Group();
  const ibowl = mkMesh(new THREE.CylinderGeometry(0.05, 0.035, 0.04, 14), m('ceramic'), { cast: false });
  ibowl.position.y = 0.02;
  const istick = mkMesh(new THREE.CylinderGeometry(0.002, 0.002, 0.14, 4), m('black'), { cast: false });
  istick.position.set(0, 0.1, 0);
  istick.rotation.z = 0.12;
  const iglow = new THREE.Mesh(new THREE.SphereGeometry(0.004, 6, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 0.8, 0.2) }));
  iglow.position.set(-0.008, 0.17, 0);
  inc.add(ibowl, istick, iglow);
  const smoke = glowSprite(w.tex.glow, 0xcccccc, 0.12, 0.35);
  smoke.position.set(-0.008, 0.25, 0);
  inc.add(smoke);
  inc.userData.smoke = smoke;
  inc.position.set(-3.43, 1.28 - 0.0, 6.2);
  inc.position.y = 1.275;
  inc.visible = false;
  g.add(inc);
  w.props.incense = inc;
  w.pickable(ibowl, { id: 'incense', tag: 'incense', name: '線香', dist: 2.4 });
  aoBox(w, g, -3.6, 5.9, sx1, 7.5, { pad: 0.12, op: 0.5 });

  // ---- エアコン（西壁上部）
  const ac = new THREE.Group();
  const acb = mkBox(0.22, 0.28, 0.82, m('plastic'), { cast: false });
  const acl = new THREE.Mesh(new THREE.BoxGeometry(0.006, 0.01, 0.01), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 2.5, 0.5) }));
  acl.position.set(0.11, 0.03, 0.3);
  ac.add(acb, acl);
  ac.position.set(-3.49, 2.1, 6.7);
  g.add(ac);
  w.pickable(acb, { id: 'ac', tag: 'ac', name: 'エアコン', dist: 3.4 });
  w.props.ac = { group: ac, led: acl };

  // ---- テレビ台とテレビ（東壁）
  const tvb = m('woodBlack');
  B.box(0.5, 0, 6.3, D.x1 - 0.01, 0.45, 7.95, { all: tvb });
  B.collide(0.45, 6.3, D.x1, 7.95, { y1: 1.4 });
  aoBox(w, g, 0.5, 6.3, D.x1, 7.95, { pad: 0.1, op: 0.5 });
  const tv = new THREE.Group();
  const tvbz = mkBox(0.04, 0.58, 0.98, m('plasticDark'));
  tv.add(tvbz);
  const tvOffMat = m('screen');
  const tvOff = new THREE.Mesh(new THREE.PlaneGeometry(0.93, 0.53), tvOffMat);
  tvOff.rotation.y = -Math.PI / 2;
  tvOff.position.set(-0.0215, 0, 0);
  tv.add(tvOff);
  const stat = T.staticCanvasTexture(96, 54);
  const tvOnMat = new THREE.MeshBasicMaterial({ map: stat, color: new THREE.Color(1.1, 1.1, 1.1) });
  const tvOn = new THREE.Mesh(new THREE.PlaneGeometry(0.93, 0.53), tvOnMat);
  tvOn.rotation.y = -Math.PI / 2;
  tvOn.position.set(-0.0225, 0, 0);
  tvOn.visible = false;
  tv.add(tvOn);
  const stand = mkBox(0.1, 0.03, 0.4, m('plasticDark'));
  stand.position.set(0.01, -0.3, 0);
  tv.add(stand);
  tv.position.set(D.x1 - 0.06, 1.0, 7.12);
  g.add(tv);
  w.pickable(tvbz, { id: 'tv', tag: 'tv', name: 'テレビ', dist: 3.4 });
  w.pickable(tvOff, { id: 'tv', tag: 'tv', name: 'テレビ', dist: 3.4 });
  w.pickable(tvOn, { id: 'tv', tag: 'tv', name: 'テレビ', dist: 3.4 });
  const tvGlow = glowSprite(w.tex.glow, 0xa8c4ff, 3.2, 0.0);
  tvGlow.position.set(0.3, 1.0, 7.12);
  g.add(tvGlow);
  w.props.tv = { group: tv, off: tvOff, on: tvOn, stat, glow: tvGlow, mode: 'off' };
  // ルーターのLED
  const rt = mkBox(0.03, 0.04, 0.16, m('plasticDark'), { cast: false });
  rt.position.set(0.82, 0.47, 6.45);
  g.add(rt);
  const rl = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 0.004), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.3, 2.2, 0.5) }));
  rl.position.set(0.8, 0.475, 6.45);
  g.add(rl);
  w.props.routerLed = rl;
  // リモコン
  const rem = mkBox(0.05, 0.015, 0.18, m('plasticDark'), { cast: false });
  rem.position.set(-0.55, 0.405, 7.25);
  rem.rotation.y = 0.5;
  g.add(rem);
  w.pickable(rem, { id: 'remote', tag: 'tv', name: 'リモコン', dist: 2.4 });

  // ---- ソファ
  const sofaM = m('fabricSofa');
  const sofa = new THREE.Group();
  const sbase = mkBox(0.85, 0.2, 1.7, sofaM);
  sbase.position.set(0, 0.2, 0);
  const sback = mkBox(0.22, 0.5, 1.7, sofaM);
  sback.position.set(-0.32, 0.55, 0);
  const sarm1 = mkBox(0.85, 0.3, 0.16, sofaM);
  sarm1.position.set(0, 0.4, 0.77);
  const sarm2 = sarm1.clone();
  sarm2.position.z = -0.77;
  const scu1 = mkBox(0.6, 0.12, 0.7, sofaM);
  scu1.position.set(0.08, 0.36, 0.38);
  const scu2 = scu1.clone();
  scu2.position.z = -0.38;
  const leg = m('woodDark');
  sofa.add(sbase, sback, sarm1, sarm2, scu1, scu2);
  for (const [lx, lz] of [
    [-0.36, -0.78],
    [0.36, -0.78],
    [-0.36, 0.78],
    [0.36, 0.78],
  ]) {
    const l = mkBox(0.05, 0.1, 0.05, leg);
    l.position.set(lx, 0.05, lz);
    sofa.add(l);
  }
  sofa.position.set(-1.62, 0, 7.1);
  g.add(sofa);
  w.bakeList.push(sofa);
  w.pickable(sofa, { id: 'sofa', tag: 'sofa', name: 'ソファ', dist: 2.6 });
  w.collide(-2.05, 6.25, -1.2, 7.95, { y1: 1.0 });
  aoBox(w, g, -2.05, 6.25, -1.2, 7.95, { pad: 0.14, op: 0.5 });
  // ブランケット
  const bl = mkBox(0.5, 0.05, 0.55, m('fabricBlanket'), { cast: false });
  bl.position.set(-1.45, 0.53, 6.62);
  bl.rotation.set(0.05, 0.4, 0.04);
  g.add(bl);
  w.props.blanket = bl;
  w.pickable(bl, { id: 'blanket', tag: 'sofa', name: 'ブランケット', dist: 2.4 });

  // ローテーブルとラグ
  const rug = mkBox(2.0, 0.012, 1.8, m('fabricRug'), { cast: false });
  rug.position.set(-0.85, 0.006, 7.05);
  g.add(rug);
  const ct = new THREE.Group();
  const ctt = mkBox(0.55, 0.04, 0.9, m('woodDark'));
  ctt.position.y = 0.38;
  ct.add(ctt);
  for (const [lx, lz] of [
    [-0.23, -0.4],
    [0.23, -0.4],
    [-0.23, 0.4],
    [0.23, 0.4],
  ]) {
    const l = mkBox(0.04, 0.36, 0.04, m('woodDark'));
    l.position.set(lx, 0.18, lz);
    ct.add(l);
  }
  ct.position.set(-0.58, 0, 7.1);
  g.add(ct);
  w.bakeList.push(ct);
  w.pickable(ctt, { id: 'coffeeTable', tag: 'table', name: 'ローテーブル', dist: 2.6 });
  w.collide(-0.86, 6.65, -0.3, 7.55, { y1: 0.45 });
  aoBox(w, g, -0.86, 6.65, -0.3, 7.55, { pad: 0.1, op: 0.4, y: 0.016 });

  // フロアランプ
  const lamp = new THREE.Group();
  const lpole = mkMesh(new THREE.CylinderGeometry(0.01, 0.01, 1.5, 6), m('metalDark'), { cast: false });
  lpole.position.y = 0.75;
  const lbase = mkMesh(new THREE.CylinderGeometry(0.12, 0.13, 0.025, 14), m('metalDark'), { cast: false });
  lbase.position.y = 0.012;
  const lm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.15, 0.7), side: THREE.DoubleSide });
  const lshade = mkMesh(new THREE.CylinderGeometry(0.12, 0.18, 0.26, 16, 1, true), lm, { cast: false, receive: false });
  lshade.position.y = 1.55;
  lamp.add(lpole, lbase, lshade);
  lamp.position.set(-2.55, 0, 7.75);
  g.add(lamp);
  const lgl = glowSprite(w.tex.glow, 0xffc890, 1.6, 0.4);
  lgl.position.set(-2.55, 1.55, 7.75);
  g.add(lgl);
  const lampFx = new Fixture(w, { id: 'lamp', room: 'ldk', light: null, intensity: 1, color: 0xffc890, pos: new THREE.Vector3(-2.55, 1.55, 7.75), hum: 0, on: false, shared: true });
  lampFx.addEmissive(lm, 1.6);
  lampFx.addGlow(lgl, 1);
  w.fixtures.push(lampFx);
  w.fx.lamp = lampFx;
  w.collide(-2.7, 7.6, -2.4, 7.9, { y1: 1.6 });

  // 観葉植物
  const plant = new THREE.Group();
  const pot = mkMesh(new THREE.CylinderGeometry(0.14, 0.11, 0.26, 14), w.M.custom({ color: 0xbfb4a2, roughness: 0.6 }, R, 0.2));
  pot.position.set(0.62, 0.13, 7.8);
  plant.add(pot);
  const rr = rng(33);
  for (let i = 0; i < 14; i++) {
    const lf = mkMesh(new THREE.SphereGeometry(0.08, 8, 6), m('leaf'));
    lf.scale.set(1, 1.8, 0.25);
    const a = rr() * TAU;
    const rad = rr.range(0.05, 0.2);
    lf.position.set(0.62 + Math.cos(a) * rad, 0.5 + rr() * 0.55, 7.8 + Math.sin(a) * rad);
    lf.rotation.set(rr.range(-0.6, 0.6), a, rr.range(-0.8, 0.8));
    plant.add(lf);
  }
  g.add(plant);
  w.bakeList.push(plant);
  w.pickable(pot, { id: 'plant', tag: 'plant', name: '観葉植物', dist: 2.6 });
  w.collide(0.46, 7.64, 0.78, 7.96, { y1: 1.2 });

  // LDK照明スイッチ・出入口脇
  w.props.switchLDK = lightSwitch(w, g, 3.62, 0.68, 1.2, +1, 'z', 'ldk', R, 'switchLDK');

  // カーテン（ベランダ側）
  const cz = D.z1 - 0.12;
  const curtL = mkCurtain(w, R, 'curtain', 0.75, 2.3, 8, 10);
  curtL.position.set(-3.0, 1.25, cz);
  const curtR = mkCurtain(w, R, 'curtain', 0.75, 2.3, 8, 10);
  curtR.position.set(0.15, 1.25, cz);
  const lace = mkCurtain(w, R, 'glassFrost', 3.3, 2.15, 10, 8);
  lace.material = w.M.custom({ color: 0xeeeeea, roughness: 0.9, transparent: true, opacity: 0.38, side: THREE.DoubleSide, depthWrite: false, alphaMap: w.M.t.lace.map }, R, 0);
  lace.position.set(-1.4, 1.2, cz + 0.05);
  lace.renderOrder = 3;
  g.add(curtL, curtR, lace);
  const rod = mkMesh(new THREE.CylinderGeometry(0.012, 0.012, 3.7, 6), m('metalDark'), { cast: false });
  rod.rotation.z = Math.PI / 2;
  rod.position.set(-1.4, 2.4, cz - 0.02);
  g.add(rod);
  w.props.curtains = [curtL, curtR, lace];
  w.pickable(curtL, { id: 'curtain', tag: 'window', name: 'カーテン', dist: 2.8 });
  w.pickable(curtR, { id: 'curtain', tag: 'window', name: 'カーテン', dist: 2.8 });

  // 天井照明（シーリング）
  const fx = w.fx.ldk;
  const ring = mkMesh(new THREE.CylinderGeometry(0.4, 0.4, 0.07, 32), m('plastic'), { cast: false, receive: false });
  ring.position.set(-1.35, CEIL - 0.035, 5.9);
  g.add(ring);
  const lem = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.4, 2.4, 2.6) });
  const ldisc = new THREE.Mesh(new THREE.CircleGeometry(0.37, 32), lem);
  ldisc.rotation.x = Math.PI / 2;
  ldisc.position.set(-1.35, CEIL - 0.072, 5.9);
  g.add(ldisc);
  fx.addEmissive(lem, 2.3);
  const lgl2 = glowSprite(w.tex.glow, 0xe9f0ff, 3.4, 0.34);
  lgl2.position.set(-1.35, CEIL - 0.3, 5.9);
  g.add(lgl2);
  fx.addGlow(lgl2, 1);
  // キッチンのダウンライト
  const dm = new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 2.2, 2.2) });
  const dd = new THREE.Mesh(new THREE.CircleGeometry(0.06, 14), dm);
  dd.rotation.x = Math.PI / 2;
  dd.position.set(-1.7, CEIL - 0.003, 4.0);
  g.add(dd);
  fx.addEmissive(dm, 2.2);

  // 壁際のAOデカール（バッチ）
  edgeAO(w, g, D);
}

/** 部屋の四辺に、床際と天井際の壁際AOを置く */
function edgeAO(w, g, D) {
  const cx = (D.x0 + D.x1) / 2;
  const cz = (D.z0 + D.z1) / 2;
  const lx = D.x1 - D.x0;
  const lz = D.z1 - D.z0;
  for (const [az, rot] of [
    [D.z0 + 0.001, 0],
    [D.z1 - 0.001, Math.PI],
  ]) {
    w.decals.wall(g, cx, 0.225, az, lx, 0.45, rot, Math.PI, 0.5);
    w.decals.wall(g, cx, CEIL - 0.2, az, lx, 0.4, rot, 0, 0.45);
  }
  for (const [px, ry] of [
    [D.x0 + 0.001, Math.PI / 2],
    [D.x1 - 0.001, -Math.PI / 2],
  ]) {
    w.decals.wall(g, px, 0.225, cz, lz, 0.45, ry, Math.PI, 0.5);
    w.decals.wall(g, px, CEIL - 0.2, cz, lz, 0.4, ry, 0, 0.45);
  }
}

// ----------------------------------------------------------------- 寝室
function bedroom(w, g) {
  const { B, M } = w;
  const R = 'bed';
  const m = (n) => M.get(n, R);
  const D = DIM.bed;
  ctx(w, g, false);

  // ベッド
  B.box(2.4, 0, 2.8, 3.66, 0.26, 4.85, { all: m('woodLight') });
  B.box(2.4, 0.26, 2.8, 3.66, 0.46, 4.85, { all: m('fabricBed') });
  B.box(2.4, 0, 2.76, 3.66, 0.9, 2.82, { all: m('woodLight') });
  B.collide(2.38, 2.76, 3.7, 4.87, { y1: 0.95 });
  const blanket = new THREE.Group();
  const bm = mkBox(1.22, 0.1, 1.35, m('fabricBlanket'), { cast: false });
  bm.position.set(0, 0.05, 0);
  blanket.add(bm);
  blanket.position.set(3.03, 0.46, 3.95);
  g.add(blanket);
  w.pickable(bm, { id: 'bed', tag: 'bed', name: 'ベッド', dist: 2.6 });
  // 人の形に盛り上がる（怪異用）
  const bump = new THREE.Group();
  const bpm = m('fabricBlanket');
  const hump = mkMesh(new THREE.CapsuleGeometry(0.17, 0.85, 6, 12), bpm, { cast: false });
  hump.rotation.x = Math.PI / 2;
  hump.scale.set(1, 1, 0.7);
  hump.position.set(0, 0.17, 0.1);
  const head = mkMesh(new THREE.SphereGeometry(0.12, 10, 8), bpm, { cast: false });
  head.position.set(0, 0.16, -0.55);
  bump.add(hump, head);
  bump.position.set(3.05, 0.5, 3.85);
  bump.visible = false;
  g.add(bump);
  w.props.bedBump = bump;
  w.pickable(hump, { id: 'bedBump', tag: 'bed', name: '布団の膨らみ', dist: 2.6 });
  const pillow = mkBox(0.55, 0.12, 0.34, m('fabricBed'), { cast: false });
  pillow.position.set(3.03, 0.52, 3.05);
  g.add(pillow);
  // 熊のぬいぐるみ（子どものもの）
  const toy = new THREE.Group();
  const tm = w.M.custom({ color: 0x9a6b44, roughness: 1 }, R);
  const tb = mkMesh(new THREE.SphereGeometry(0.1, 10, 8), tm, { cast: false });
  tb.scale.set(1, 1.15, 0.85);
  const th = mkMesh(new THREE.SphereGeometry(0.075, 10, 8), tm, { cast: false });
  th.position.set(0, 0.14, 0.01);
  const te1 = mkMesh(new THREE.SphereGeometry(0.03, 6, 6), tm, { cast: false });
  te1.position.set(-0.055, 0.2, 0);
  const te2 = te1.clone();
  te2.position.x = 0.055;
  const teyes = mkMesh(new THREE.SphereGeometry(0.01, 6, 6), m('black'), { cast: false });
  teyes.position.set(-0.025, 0.15, 0.07);
  const teyes2 = teyes.clone();
  teyes2.position.x = 0.025;
  toy.add(tb, th, te1, te2, teyes, teyes2);
  toy.position.set(3.35, 0.6, 3.1);
  toy.rotation.y = -0.4;
  g.add(toy);
  w.pickable(toy, { id: 'toy', tag: 'toy', name: 'くまのぬいぐるみ', dist: 2.4 });
  w.props.toy = toy;
  aoBox(w, g, 2.4, 2.8, 3.66, 4.85, { pad: 0.12, op: 0.5 });

  // サイドテーブルと目覚まし時計
  B.box(1.95, 0, 2.8, 2.35, 0.5, 3.2, { all: m('woodDark') });
  B.collide(1.95, 2.8, 2.35, 3.2, { y1: 0.6 });
  aoBox(w, g, 1.95, 2.8, 2.35, 3.2, { pad: 0.08, op: 0.45 });
  const alarm = new THREE.Group();
  const ab = mkBox(0.14, 0.07, 0.07, m('plasticDark'), { cast: false });
  ab.position.y = 0.035;
  const ascr = canvasPlane(w, R, 128, 64, 0.11, 0.05, (x, cw, ch) => {
    x.fillStyle = '#050505';
    x.fillRect(0, 0, cw, ch);
  }, { basic: true });
  ascr.position.set(0.0, 0.035, 0.0355);
  alarm.add(ab, ascr);
  alarm.position.set(2.15, 0.5, 3.0);
  alarm.rotation.y = Math.PI / 2 + 0.2;
  g.add(alarm);
  w.pickable(ab, { id: 'alarm', tag: 'alarm', name: '目覚まし時計', dist: 2.4 });
  w.props.alarm = { group: alarm, screen: ascr };
  // 枕元ランプ
  const lamp = new THREE.Group();
  const lb = mkMesh(new THREE.CylinderGeometry(0.05, 0.06, 0.2, 12), m('ceramic'), { cast: false });
  lb.position.y = 0.1;
  const lmat = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.8, 1.2, 0.6), side: THREE.DoubleSide });
  const ls = mkMesh(new THREE.CylinderGeometry(0.08, 0.12, 0.14, 14, 1, true), lmat, { cast: false, receive: false });
  ls.position.y = 0.27;
  lamp.add(lb, ls);
  lamp.position.set(2.15, 0.5, 2.9);
  g.add(lamp);
  const lgl = glowSprite(w.tex.glow, 0xffb878, 1.0, 0.35);
  lgl.position.set(2.15, 0.78, 2.9);
  g.add(lgl);
  const bedLampFx = new Fixture(w, { id: 'bedLamp', room: 'bed', light: null, intensity: 1, color: 0xffb878, pos: new THREE.Vector3(2.15, 0.78, 2.9), hum: 0, on: false, shared: true });
  bedLampFx.addEmissive(lmat, 1.8);
  bedLampFx.addGlow(lgl, 1);
  w.fixtures.push(bedLampFx);
  w.fx.bedLamp = bedLampFx;

  // 造り付けクローゼット（南壁）
  const cx0 = 1.3;
  const cx1 = 3.55;
  const cz0 = 6.2;
  const cz1 = 6.74;
  const dark = m('black');
  B.box(cx0, 0, cz0, cx0 + 0.04, 2.1, cz1, { all: m('woodLight') });
  B.box(cx1 - 0.04, 0, cz0, cx1, 2.1, cz1, { all: m('woodLight') });
  B.box(cx0, 2.06, cz0, cx1, 2.1, cz1, { all: m('woodLight') });
  B.box(cx0 + 0.04, 0, cz1 - 0.03, cx1 - 0.04, 2.06, cz1, { all: dark });
  B.box(cx0 + 0.04, 0, cz0, cx1 - 0.04, 0.03, cz1, { all: dark });
  B.collide(cx0, cz0 + 0.06, cx1, cz1 + 0.05, { y1: 2.1 });
  // 中の服
  const cl = new THREE.Group();
  const rail = mkMesh(new THREE.CylinderGeometry(0.01, 0.01, 2.1, 6), m('metalDark'), { cast: false });
  rail.rotation.z = Math.PI / 2;
  rail.position.set(2.42, 1.7, 6.5);
  cl.add(rail);
  const cc = [0x2a2e36, 0x6a6a72, 0x3a4a5a, 0x7a6a5a, 0x2a2a2a, 0x8a8a92, 0x4a3a3a, 0x30343c];
  cc.forEach((col, i) => {
    const c = mkBox(0.04, 0.8, 0.4, w.M.custom({ color: col, roughness: 0.95 }, R), { cast: false });
    c.position.set(1.55 + i * 0.22, 1.3, 6.5);
    cl.add(c);
  });
  g.add(cl);
  w.props.closetInside = cl;
  // 扉
  const mkLeaf = (id, hingeX, dir) => {
    const pivot = new THREE.Group();
    pivot.position.set(hingeX, 0, cz0 + 0.02);
    g.add(pivot);
    const leaf = mkBox(1.1, 2.04, 0.03, m('doorPaint'), { cast: false });
    leaf.position.set(dir * 0.55, 1.02, 0);
    pivot.add(leaf);
    const knob = mkBox(0.03, 0.12, 0.03, m('chrome'), { cast: false });
    knob.position.set(dir * 1.0, 1.0, -0.025);
    pivot.add(knob);
    const d = new Door(w, {
      id,
      pivot,
      closedAngle: 0,
      openAngle: dir * Math.PI * 0.5,
      pos: new THREE.Vector3(hingeX + dir * 0.55, 1, cz0),
      sound: 'wood',
      speed: 1.2,
    });
    d.deep = true;
    // 開く向き：dir=+1 のとき葉は +x へ伸び、-z 側(部屋側)へ開く → y回転は +x 先端を -z へ => θ>0 で z'=-x sinθ <0
    w.doors[id] = d;
    w.pickable(leaf, { id: id + 'Door', tag: 'closet', name: 'クローゼット', dist: 2.4, door: id });
    return d;
  };
  mkLeaf('closetL', cx0 + 0.02, +1);
  mkLeaf('closetR', cx1 - 0.02, -1);

  // 机と椅子
  B.box(1.06, 0.7, 5.45, 1.62, 0.74, 6.1, { all: m('woodLight') });
  for (const [lx, lz] of [
    [1.1, 5.5],
    [1.1, 6.05],
    [1.58, 5.5],
    [1.58, 6.05],
  ]) B.box(lx - 0.02, 0, lz - 0.02, lx + 0.02, 0.7, lz + 0.02, { all: m('metalDark') });
  B.collide(1.04, 5.43, 1.64, 6.12, { y1: 0.8 });
  aoBox(w, g, 1.04, 5.43, 1.64, 6.12, { pad: 0.1, op: 0.4 });
  const lap = mkBox(0.3, 0.015, 0.22, m('metal'), { cast: false });
  lap.position.set(1.35, 0.757, 5.78);
  g.add(lap);
  const lapScr = mkBox(0.3, 0.2, 0.01, m('plasticDark'), { cast: false });
  lapScr.position.set(1.35, 0.86, 5.68);
  lapScr.rotation.x = -0.15;
  g.add(lapScr);
  w.pickable(lapScr, { id: 'laptop', tag: 'laptop', name: 'ノートPC', dist: 2.4 });
  const chair = new THREE.Group();
  const cs = mkBox(0.4, 0.04, 0.4, m('fabricSofa'), { cast: false });
  cs.position.y = 0.44;
  const cb = mkBox(0.4, 0.4, 0.03, m('fabricSofa'), { cast: false });
  cb.position.set(0, 0.68, 0.19);
  chair.add(cs, cb);
  for (const [lx, lz] of [
    [-0.17, -0.17],
    [0.17, -0.17],
    [-0.17, 0.17],
    [0.17, 0.17],
  ]) {
    const l = mkBox(0.03, 0.43, 0.03, m('metalDark'), { cast: false });
    l.position.set(lx, 0.215, lz);
    chair.add(l);
  }
  chair.position.set(1.95, 0, 5.8);
  chair.rotation.y = -Math.PI / 2 + 0.3;
  g.add(chair);
  w.props.deskChair = chair;

  // 窓カーテン（東壁）
  const bc = mkCurtain(w, R, 'curtain', 1.7, 1.9, 8, 8);
  bc.rotation.y = -Math.PI / 2;
  bc.position.set(D.x1 - 0.1, 1.45, 4.0);
  g.add(bc);
  w.props.bedCurtain = bc;
  w.pickable(bc, { id: 'bedCurtain', tag: 'window', name: 'カーテン', dist: 2.6 });

  // 絵
  const pic = canvasPlane(w, R, 256, 192, 0.5, 0.38, (x, cw, ch) => {
    const g2 = x.createLinearGradient(0, 0, 0, ch);
    g2.addColorStop(0, '#c9d6e4');
    g2.addColorStop(1, '#8da3b8');
    x.fillStyle = g2;
    x.fillRect(0, 0, cw, ch);
    x.fillStyle = '#4b6076';
    x.beginPath();
    x.moveTo(0, ch);
    x.lineTo(cw * 0.3, ch * 0.4);
    x.lineTo(cw * 0.55, ch * 0.7);
    x.lineTo(cw * 0.8, ch * 0.3);
    x.lineTo(cw, ch);
    x.fill();
  }, { rough: 0.3, env: 0.5 });
  pic.rotation.y = Math.PI / 2;
  pic.position.set(D.x0 + 0.015, 1.65, 3.7);
  g.add(pic);

  // 照明
  const fx = w.fx.bed;
  const ring = mkMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.06, 28), m('plastic'), { cast: false, receive: false });
  ring.position.set(2.35, CEIL - 0.03, 4.75);
  g.add(ring);
  const lem = new THREE.MeshBasicMaterial({ color: new THREE.Color(2, 1.4, 0.8) });
  const ld = new THREE.Mesh(new THREE.CircleGeometry(0.27, 28), lem);
  ld.rotation.x = Math.PI / 2;
  ld.position.set(2.35, CEIL - 0.062, 4.75);
  g.add(ld);
  fx.addEmissive(lem, 2.2);
  const lgl2 = glowSprite(w.tex.glow, 0xffb070, 2.4, 0.3);
  lgl2.position.set(2.35, CEIL - 0.3, 4.75);
  g.add(lgl2);
  fx.addGlow(lgl2, 1);
  w.props.switchBed = lightSwitch(w, g, 1.02, 4.38, 1.2, +1, 'x', 'bed', R, 'switchBed');

  // 壁際AO（バッチ）
  edgeAO(w, g, D);
}

// ----------------------------------------------------------------- 玄関ドアの外側など追加の照明参照
function fixtures(w) {
  // 床の足跡（共用廊下 ⇄ 室内）を後から出すためのデカールプール
  const g = w.groups.fixed;
  w.props.footprints = [];
  for (let i = 0; i < 24; i++) {
    const left = i % 2 === 0;
    const d = decalFloor(left ? w.tex.fpL : w.tex.fpR, 0.16, 0.32, { opacity: 0, color: 0x0a0e12, y: 0.005 });
    d.visible = false;
    g.add(d);
    w.props.footprints.push(d);
  }
}
