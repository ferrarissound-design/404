// 建物の躯体：共用廊下・玄関・廊下・水回り・LDK・寝室・ベランダ
import * as THREE from 'three';
import { Door, Fixture, glowSprite } from './core.js';
import { mkBox, mkMesh, decalFloor, boxGeo } from '../builder.js';
import * as T from '../tex.js';
import { rng } from '../util.js';

export const CEIL = 2.4;
export const COR_CEIL = 2.5;
export const DOOR_H = 2.0;

// 部屋寸法（ワールド座標）
export const DIM = {
  corZ0: -1.7,
  corZ1: -0.1,
  corX0: -10,
  corX1: 10,
  hx: 0.9, // 廊下・玄関の半幅
  genkanZ1: 1.35,
  hallZ0: 1.35,
  hallZ1: 3.5, // ベース（dzで延長）
  gap: 0.12,
  ldk: { x0: -3.6, x1: 0.9, z0: 3.62, z1: 8.1 },
  bed: { x0: 1.02, x1: 3.7, z0: 2.75, z1: 6.75 },
  bath: { x0: -2.7, x1: -1.02, z0: 1.4, z1: 3.3 },
  toilet: { x0: 1.02, x1: 2.1, z0: 1.4, z1: 2.55 },
};
export const DOOR_X = [-6.4, -3.2, 0, 3.2, 6.4]; // 402..406
export const UNIT_NO = [402, 403, 404, 405, 406];

const WX = 0.9; // 玄関・廊下の半幅

/** 全体の建築を構築 */
export function buildShell(w) {
  const { B, M } = w;
  const m = (name, room) => M.get(name, room);

  // グループ
  const gFixed = new THREE.Group();
  gFixed.name = 'fixed';
  const gHall = new THREE.Group();
  gHall.name = 'hall';
  const gDeep = new THREE.Group();
  gDeep.name = 'deep';
  w.root.add(gFixed, gHall, gDeep);
  w.groups = { fixed: gFixed, hall: gHall, deep: gDeep };

  buildCorridor(w, gFixed);
  buildGenkan(w, gFixed);
  buildHall(w, 0);
  buildWet(w, gFixed);
  buildDeep(w, gDeep);
}

// ======================================================================= 共用廊下
function buildCorridor(w, g) {
  const { B, M } = w;
  const D = DIM;
  B.target = g;
  B.cast = false;
  B.receive = true;
  const floor = M.get('floorCor', 'cor');
  const wall = M.get('wallCor', 'cor');
  const wallD = M.get('wallCorDark', 'cor');
  const ceil = M.get('ceilCor', 'cor');
  const conc = M.get('concrete', 'cor');
  const trim = M.get('trim', 'cor');
  const metalDark = M.get('metalDark', 'cor');

  // 床・天井
  B.floor(floor, D.corX0, D.corZ0, D.corX1, D.corZ1, 0);
  B.ceil(ceil, D.corX0, D.corZ0 - 0.3, D.corX1, D.corZ1, COR_CEIL);
  // 床スラブ端
  B.box(D.corX0, -0.4, D.corZ0 - 0.2, D.corX1, 0, D.corZ1, { nz: conc, pz: null });
  // 腰壁（北側）
  B.box(D.corX0, 0, D.corZ0 - 0.15, D.corX1, 1.05, D.corZ0, { pz: wall, py: conc, nz: conc });
  B.collide(D.corX0, D.corZ0 - 0.4, D.corX1, D.corZ0 + 0.02, { y1: 3 });
  // 手すり
  B.box(D.corX0, 1.05, D.corZ0 - 0.06, D.corX1, 1.09, D.corZ0 - 0.02, M.get('metalDark', 'cor'));
  for (let x = D.corX0 + 0.2; x < D.corX1; x += 0.9) B.box(x - 0.012, 1.05, D.corZ0 - 0.05, x + 0.012, 1.45, D.corZ0 - 0.03, metalDark);
  B.box(D.corX0, 1.45, D.corZ0 - 0.06, D.corX1, 1.48, D.corZ0 - 0.02, metalDark);
  // 梁
  B.box(D.corX0, 2.28, D.corZ0 - 0.2, D.corX1, COR_CEIL + 0.3, D.corZ0 - 0.08, { all: conc });
  // 柱
  for (const x of [-9.6, -8, -4.8, -1.6, 1.6, 4.8, 8]) {
    B.box(x - 0.14, 0, D.corZ0 - 0.18, x + 0.14, 2.28, D.corZ0 + 0.1, { nx: wall, px: wall, pz: wall, nz: conc });
    B.collide(x - 0.16, D.corZ0 - 0.2, x + 0.16, D.corZ0 + 0.12, { y1: 3 });
  }

  // 東西の端壁
  B.wall(wall, 'x', D.corX0, D.corZ0 - 0.2, D.corZ1, 0, COR_CEIL, +1);
  B.wall(wall, 'x', D.corX1, D.corZ0 - 0.2, D.corZ1, 0, COR_CEIL, -1);
  B.collide(D.corX0 - 0.3, D.corZ0, D.corX0, D.corZ1, { y1: 3 });
  B.collide(D.corX1, D.corZ0, D.corX1 + 0.3, D.corZ1, { y1: 3 });

  // 住戸側ファサード（z = corZ1）：ドア・窓・PS
  const ops = [];
  for (const x of DOOR_X) {
    ops.push({ c: x, w: 0.92, h: DOOR_H + 0.05 });
    ops.push({ c: x + 1.4, w: 0.7, h: 1.75, sill: 1.05 }); // 面格子窓
  }
  B.wall(wall, 'z', D.corZ1, D.corX0, D.corX1, 0, COR_CEIL, -1, ops, { skirt: M.get('concrete', 'cor'), skirtH: 0.12 });
  // 厚み（開口の見込み）
  const thick = 0.2;
  const zi = D.corZ1;
  for (const o of ops) {
    const lo = o.c - o.w / 2;
    const hi = o.c + o.w / 2;
    const top = o.h;
    const sill = o.sill || 0;
    // 見込み：左右・上
    B.quad(trim, [lo, sill, zi], [lo, sill, zi + thick], [lo, top, zi + thick], [lo, top, zi]);
    B.quad(trim, [hi, sill, zi + thick], [hi, sill, zi], [hi, top, zi], [hi, top, zi + thick]);
    B.quad(trim, [lo, top, zi + thick], [hi, top, zi + thick], [hi, top, zi], [lo, top, zi]);
    if (sill) B.quad(trim, [lo, sill, zi], [hi, sill, zi], [hi, sill, zi + thick], [lo, sill, zi + thick]);
  }
  // 壁は厚みの分だけ衝突
  B.wallCollide('z', D.corZ1, D.corX0, D.corX1, DOOR_X.map((x) => ({ c: x, w: 0.92 })), +1, 0.25, { y1: 3 });
  // 玄関ドア前の衝突（開口はドアで閉じる）
  w.facadeDoorColliders = [];

  // 各戸のドア（404はインタラクティブ、他は固定）
  DOOR_X.forEach((x, i) => {
    const no = UNIT_NO[i];
    if (no === 404) return; // 後で
    buildNeighborDoor(w, g, x, no, i);
  });

  // PS（パイプスペース）パネルとメーターボックス
  for (const x of DOOR_X) {
    B.box(x - 1.5, 0.2, zi - 0.02, x - 1.0, 1.7, zi, { nz: M.get('steelDoor', 'cor') });
    B.box(x - 1.46, 1.35, zi - 0.03, x - 1.04, 1.6, zi - 0.02, { nz: M.get('plasticGray', 'cor') });
  }
  // 面格子窓
  for (const x of DOOR_X) {
    const cx = x + 1.4;
    const z = zi + 0.12;
    // すりガラス（窓明かり）
    const lit = w.windowGlass(cx, 1.05 + 0.875, z, 0.7, 1.75, x === 0 ? 0 : x === -3.2 ? 1 : 0.2);
    g.add(lit);
    for (let k = 0; k < 8; k++) {
      B.box(cx - 0.3 + k * 0.0857 - 0.008, 1.05, zi - 0.045, cx - 0.3 + k * 0.0857 + 0.008, 2.8, zi - 0.03, M.get('metalDark', 'cor'));
    }
    B.box(cx - 0.35, 1.05, zi - 0.045, cx + 0.35, 1.075, zi - 0.03, M.get('metalDark', 'cor'));
    B.box(cx - 0.35, 2.77, zi - 0.045, cx + 0.35, 2.8, zi - 0.03, M.get('metalDark', 'cor'));
  }

  // 蛍光灯器具
  const xs = [-9.6, -6.4, -3.2, 0, 3.2, 6.4, 9.6];
  w.corridorFixtures = [];
  xs.forEach((x, i) => {
    const fx = new Fixture(w, { id: 'cor' + i, room: 'cor', intensity: 1, color: 0xe8f4ff, hum: 0.5, shared: true, pos: new THREE.Vector3(x, 2.4, -0.9) });
    const body = mkBox(1.25, 0.06, 0.26, M.get('plasticGray', 'cor'), { cast: false, receive: false });
    body.position.set(x, COR_CEIL - 0.03, -0.9);
    g.add(body);
    const tubeMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.8, 0.95, 1.0) });
    const tube = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.02, 0.15), tubeMat);
    tube.position.set(x, COR_CEIL - 0.065, -0.9);
    g.add(tube);
    fx.addEmissive(tubeMat, 3.4);
    const gl = glowSprite(w.tex.glow, 0xcfe6ff, 2.4, 0.35);
    gl.position.set(x, COR_CEIL - 0.3, -0.9);
    g.add(gl);
    fx.addGlow(gl, 1);
    w.fixtures.push(fx);
    w.corridorFixtures.push(fx);
  });

  // 非常口（西端）・エレベーター（東端）
  buildStairDoor(w, g);
  buildElevator(w, g);

  // 壁際AOデカール（バッチ）
  w.decals.wall(g, 0, 0.25, D.corZ0 + 0.001, D.corX1 - D.corX0, 0.5, 0, Math.PI, 0.55);
  w.decals.wall(g, 0, 0.25, D.corZ1 - 0.001, D.corX1 - D.corX0, 0.5, Math.PI, Math.PI, 0.5);

  // 共用廊下の小物
  buildCorridorProps(w, g);
}

function buildNeighborDoor(w, g, x, no, idx) {
  const { M } = w;
  const zi = DIM.corZ1;
  const mat = idx % 2 === 0 ? M.get('steelDoor', 'cor') : M.get('steelDoorBrown', 'cor');
  const leaf = mkBox(0.9, DOOR_H, 0.05, mat, { cast: false });
  leaf.position.set(x, DOOR_H / 2, zi + 0.06);
  g.add(leaf);
  // 枠
  const tr = M.get('metalDark', 'cor');
  const f1 = mkBox(0.06, DOOR_H + 0.06, 0.12, tr, { cast: false });
  f1.position.set(x - 0.47, (DOOR_H + 0.06) / 2, zi + 0.04);
  const f2 = f1.clone();
  f2.position.x = x + 0.47;
  const f3 = mkBox(1.0, 0.06, 0.12, tr, { cast: false });
  f3.position.set(x, DOOR_H + 0.03, zi + 0.04);
  g.add(f1, f2, f3);
  // 号室プレート
  const plate = w.numberPlate(String(no));
  plate.position.set(x, 1.72, zi - 0.001);
  plate.rotation.y = Math.PI;
  g.add(plate);
  // 覗き穴
  const pe = mkMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.01, 8), M.get('chrome', 'cor'), { cast: false });
  pe.rotation.x = Math.PI / 2;
  pe.position.set(x, 1.5, zi - 0.003);
  g.add(pe);
  // ドアノブ（レバーハンドル）
  const hdl = mkBox(0.13, 0.025, 0.04, M.get('chrome', 'cor'), { cast: false });
  hdl.position.set(x - 0.34, 1.0, zi - 0.03);
  g.add(hdl);
  // 表札
  const nm = w.nameplate(no === 403 ? '山田' : no === 405 ? '' : '');
  nm.position.set(x + 0.35, 1.62, zi - 0.001);
  nm.rotation.y = Math.PI;
  g.add(nm);
  w.collide(x - 0.46, zi - 0.05, x + 0.46, zi + 0.2, { y1: 3 });
  w.neighborDoors ||= {};
  w.neighborDoors[no] = leaf;
  w.pickable(leaf, { id: 'neighbor' + no, tag: 'door', name: no + '号室のドア', dist: 2.4 });
}

function buildStairDoor(w, g) {
  const { M, B } = w;
  const x = DIM.corX0 + 0.02;
  const leaf = mkBox(0.06, 2.0, 1.0, M.get('steelGreen', 'cor'), { cast: false });
  leaf.position.set(x + 0.03, 1.0, -0.9);
  g.add(leaf);
  const f = mkBox(0.1, 2.08, 1.16, M.get('metalDark', 'cor'), { cast: false });
  f.position.set(x + 0.02, 1.04, -0.9);
  g.add(f);
  const hdl = mkBox(0.04, 0.03, 0.14, M.get('chrome', 'cor'), { cast: false });
  hdl.position.set(x + 0.08, 1.0, -0.55);
  g.add(hdl);
  // 非常口サイン
  const sign = w.exitSign();
  sign.position.set(x + 0.06, 2.28, -0.9);
  sign.rotation.y = Math.PI / 2;
  g.add(sign);
  w.exitSignMesh = sign;
  const gl = glowSprite(w.tex.glow, 0x3cff7a, 1.6, 0.35);
  gl.position.set(x + 0.4, 2.2, -0.9);
  g.add(gl);
  w.exitGlow = gl;
  // 「階段」
  const st = w.signPlate('階段 ↓', 0.5, 0.14, '#1c3a2a', '#cfe8d8');
  st.position.set(x + 0.06, 2.12, -0.9);
  st.rotation.y = Math.PI / 2;
  g.add(st);
  w.pickable(leaf, { id: 'fireDoor', tag: 'door', name: '非常口', dist: 2.2 });
}

function buildElevator(w, g) {
  const { M, B } = w;
  const x = DIM.corX1;
  const zc = -0.9;
  const cabin = new THREE.Group();
  g.add(cabin);
  w.elevator = { group: cabin, open: 0, target: 0, floor: 4 };
  // 開口を持つ壁は buildCorridor の端壁(−x向き)に重なる。開口部は別壁で上書きしないよう、箱で覆う
  // 乗り場の枠
  const frameMat = M.get('metal', 'cor');
  const f1 = mkBox(0.08, 2.15, 0.1, frameMat, { cast: false });
  f1.position.set(x - 0.04, 1.075, zc - 0.58);
  const f2 = f1.clone();
  f2.position.z = zc + 0.58;
  const f3 = mkBox(0.08, 0.1, 1.26, frameMat, { cast: false });
  f3.position.set(x - 0.04, 2.15, zc);
  g.add(f1, f2, f3);
  // 扉2枚（スライド）
  const lm = M.get('metal', 'cor');
  const L = mkBox(0.04, 2.05, 0.54, lm, { cast: false });
  const Rr = L.clone();
  L.position.set(x - 0.03, 1.025, zc - 0.28);
  Rr.position.set(x - 0.03, 1.025, zc + 0.28);
  g.add(L, Rr);
  w.elevator.L = L;
  w.elevator.R = Rr;
  w.elevator.zc = zc;
  // かご内部（扉の向こう）
  const inner = new THREE.Group();
  inner.position.set(x + 0.04, 0, zc);
  const wm = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.55, 1.4) });
  const back = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.3), wm);
  back.rotation.y = -Math.PI / 2;
  back.position.set(1.4, 1.15, 0);
  inner.add(back);
  const side = new THREE.MeshBasicMaterial({ color: new THREE.Color(1.1, 1.05, 0.95) });
  const s1 = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 2.3), side);
  s1.position.set(0.7, 1.15, -0.65);
  const s2 = s1.clone();
  s2.position.z = 0.65;
  s2.rotation.y = Math.PI;
  inner.add(s1, s2);
  const fl = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.55, 0.5, 0.45) }));
  fl.rotation.x = -Math.PI / 2;
  fl.position.set(0.7, 0.02, 0);
  inner.add(fl);
  const ce = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 2.0, 1.9) }));
  ce.rotation.x = Math.PI / 2;
  ce.position.set(0.7, 2.3, 0);
  inner.add(ce);
  // 操作盤（かご内）
  const panel = w.elevatorPanel();
  panel.position.set(1.37, 1.15, 0);
  panel.rotation.y = -Math.PI / 2;
  panel.scale.setScalar(1.5);
  inner.add(panel);
  w.pickable(panel, { id: 'elevPanel', tag: 'elevator', name: 'エレベーターの操作盤', dist: 3.6 });
  cabin.add(inner);
  w.elevator.inner = inner;
  inner.visible = false;
  // 階数表示
  const ind = w.indicator('4');
  ind.position.set(x - 0.02, 2.3, zc);
  ind.rotation.y = -Math.PI / 2;
  g.add(ind);
  w.elevator.indicator = ind;
  // 呼出ボタン
  const btn = mkBox(0.03, 0.2, 0.1, M.get('metal', 'cor'), { cast: false });
  btn.position.set(x - 0.015, 1.1, zc - 0.78);
  g.add(btn);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.03, 0.03), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.5, 0.6, 0.2) }));
  led.position.set(x - 0.035, 1.14, zc - 0.78);
  g.add(led);
  w.elevator.led = led;
  w.pickable(btn, { id: 'elevCall', tag: 'elevator', name: 'エレベーターの呼出ボタン', dist: 2.2 });
  w.pickable(L, { id: 'elevDoor', tag: 'elevator', name: 'エレベーター', dist: 3 });
  w.pickable(Rr, { id: 'elevDoor', tag: 'elevator', name: 'エレベーター', dist: 3 });
  // 床に落ちる光だまり（扉が開いたとき）
  const spill = decalFloor(w.tex.glow, 3.4, 2.4, { y: 0.004, opacity: 0, color: 0xfff1d0, blending: THREE.AdditiveBlending });
  spill.position.set(x - 1.3, 0.004, zc);
  g.add(spill);
  w.elevator.spill = spill;
  // かごの衝突
  w.collide(x - 0.02, DIM.corZ0, x + 2, DIM.corZ1, { y1: 3 });
  w.elevator.setOpen = (t) => {
    w.elevator.open = t;
    w.elevator.L.position.z = zc - 0.28 - 0.5 * t;
    w.elevator.R.position.z = zc + 0.28 + 0.5 * t;
    inner.visible = t > 0.01;
    spill.material.opacity = 0.35 * t;
  };
}

function buildCorridorProps(w, g) {
  const { M, B } = w;
  B.target = g;
  B.cast = true;
  const zi = DIM.corZ1;
  // 消火器 + 標識（エレベーター近く）
  const ex = DIM.corX1 - 1.2;
  const ext = mkMesh(new THREE.CylinderGeometry(0.07, 0.07, 0.45, 12), new THREE.MeshStandardMaterial({ color: 0xa5201c, roughness: 0.35, metalness: 0.4 }));
  ext.position.set(ex, 0.4, zi - 0.1);
  g.add(ext);
  const nz = mkMesh(new THREE.CylinderGeometry(0.02, 0.02, 0.15, 8), M.get('metalDark', 'cor'));
  nz.position.set(ex, 0.68, zi - 0.1);
  g.add(nz);
  const esign = w.signPlate('消火器', 0.3, 0.3, '#a5201c', '#ffffff');
  esign.position.set(ex, 1.5, zi - 0.003);
  esign.rotation.y = Math.PI;
  g.add(esign);

  // 館内案内（4階が存在しない）
  const dir = w.directorySign();
  dir.position.set(DIM.corX1 - 0.003, 1.6, -1.45);
  dir.rotation.y = -Math.PI / 2;
  g.add(dir);
  w.pickable(dir, { id: 'directory', tag: 'sign', name: '館内案内', dist: 2.4 });

  // 階表示（廊下）
  const fl = w.signPlate('4F', 0.5, 0.28, '#222a30', '#e8eef2');
  fl.position.set(-1.6, 2.05, zi - 0.003);
  fl.rotation.y = Math.PI;
  g.add(fl);

  // 403前：傘と鉢 / 405前：段ボール
  const um = mkMesh(new THREE.CylinderGeometry(0.015, 0.015, 0.8, 6), M.get('plasticDark', 'cor'));
  um.position.set(-3.2 - 0.62, 0.45, zi - 0.1);
  um.rotation.z = 0.12;
  g.add(um);
  const um2 = mkMesh(new THREE.ConeGeometry(0.05, 0.4, 8), M.get('metalDark', 'cor'));
  um2.position.set(-3.2 - 0.66, 0.2, zi - 0.1);
  um2.rotation.z = 0.12;
  g.add(um2);
  const bx = mkBox(0.45, 0.32, 0.35, M.get('cardboard', 'cor'));
  bx.position.set(3.2 + 0.75, 0.16, zi - 0.28);
  bx.rotation.y = 0.2;
  g.add(bx);
  const bx2 = mkBox(0.3, 0.22, 0.3, M.get('cardboard', 'cor'));
  bx2.position.set(3.2 + 0.75, 0.43, zi - 0.28);
  bx2.rotation.y = -0.1;
  g.add(bx2);
  w.collide(3.2 + 0.5, zi - 0.45, 3.2 + 1.0, zi - 0.1, { y1: 0.6 });
  // 子供用の自転車（403の前）
  const bike = new THREE.Group();
  const bm = M.get('metalDark', 'cor');
  const wheel = (x) => {
    const t = mkMesh(new THREE.TorusGeometry(0.2, 0.012, 6, 20), bm);
    t.position.set(x, 0.22, 0);
    return t;
  };
  bike.add(wheel(-0.28), wheel(0.28));
  const fr = mkBox(0.6, 0.02, 0.02, new THREE.MeshStandardMaterial({ color: 0xc23b3b, roughness: 0.4 }));
  fr.position.set(0, 0.34, 0);
  fr.rotation.z = 0.2;
  bike.add(fr);
  const hb = mkBox(0.02, 0.02, 0.28, bm);
  hb.position.set(0.26, 0.5, 0);
  bike.add(hb);
  bike.position.set(-3.2 + 0.1, 0.0, zi - 0.28);
  bike.rotation.y = Math.PI / 2 + 0.15;
  g.add(bike);
  w.collide(-3.4, zi - 0.7, -3.0, zi - 0.1, { y1: 0.6 });
  // 水たまり風反射の濡れ跡（床の質感）
}

// ======================================================================= 玄関
function buildGenkan(w, g) {
  const { B, M } = w;
  B.target = g;
  B.cast = false;
  B.receive = true;
  const wall = M.get('wallGenkan', 'genkan');
  const ceil = M.get('ceilIn', 'genkan');
  const floorG = M.get('floorGenkan', 'genkan');
  const trim = M.get('trim', 'genkan');
  const z0 = 0.1;
  const z1 = DIM.genkanZ1;
  const y0 = -0.12;
  B.floor(floorG, -WX, z0, WX, z1 - 0.05, y0);
  B.ceil(ceil, -WX, z0, WX, z1, CEIL);
  // 北壁（玄関ドア開口）
  B.wall(wall, 'z', z0, -WX, WX, y0, CEIL, +1, [{ c: 0, w: 0.92, h: DOOR_H + 0.12 + 0.05 }], { skirt: trim });
  // 東西壁
  B.wall(wall, 'x', -WX, z0, z1, y0, CEIL, +1, [], { skirt: trim });
  B.wall(wall, 'x', +WX, z0, z1, y0, CEIL, -1, [], { skirt: trim });
  // 上がり框
  const wood = M.get('woodLight', 'genkan');
  B.box(-WX, y0, z1 - 0.05, WX, 0.0, z1, { all: wood, ny: null });
  // 衝突（壁）
  B.wallCollide('x', -WX, z0, z1 + 0.0, [], -1, 0.3, { y1: 3 });
  B.wallCollide('x', WX, z0, z1, [], +1, 0.3, { y1: 3 });
  B.collide(-WX - 0.3, 0.0, -0.46, 0.25, { y1: 3 });
  // 外壁側（玄関ドアの両脇は壁）
  B.wallCollide('z', z0, -WX, WX, [{ c: 0, w: 0.92 }], -1, 0.3, { y1: 3 });

  // 開口の見込み（壁厚 0.2）と枠
  const zi = DIM.corZ1;
  // 枠
  const fm = M.get('metalDark', 'genkan');
  const frL = mkBox(0.06, DOOR_H + 0.06, 0.2, fm, { cast: false });
  frL.position.set(-0.49, (DOOR_H + 0.06) / 2, 0.0);
  const frR = frL.clone();
  frR.position.x = 0.49;
  const frT = mkBox(1.04, 0.06, 0.2, fm, { cast: false });
  frT.position.set(0, DOOR_H + 0.03, 0.0);
  g.add(frL, frR, frT);
  // 外壁側の壁（z=-0.1）は共用廊下側のファサードに開口がある。厚み部分は枠が隠す。
  // 沓摺（敷居）
  const th = mkBox(1.0, 0.04, 0.22, M.get('metal', 'genkan'), { cast: false });
  th.position.set(0, -0.1, 0.0);
  g.add(th);
  buildFrontDoor(w, g);
}

function buildFrontDoor(w, g) {
  const { M } = w;
  const zi = 0.0;
  const hingeX = 0.45; // 東側ヒンジ（廊下から見て右）
  const pivot = new THREE.Group();
  pivot.position.set(hingeX, 0, zi);
  g.add(pivot);
  const mat = M.get('steelDoor', 'genkan');
  const leaf = mkBox(0.9, DOOR_H, 0.045, mat, { cast: true });
  leaf.position.set(-0.45, DOOR_H / 2, 0);
  pivot.add(leaf);
  // 廊下側の面の意匠：ドアの上下枠
  const edge = mkBox(0.9, 0.03, 0.05, M.get('metalDark', 'genkan'), { cast: false });
  edge.position.set(-0.45, DOOR_H - 0.015, 0);
  pivot.add(edge);
  // レバーハンドル（内/外）
  const hm = M.get('chrome', 'genkan');
  const hIn = mkBox(0.14, 0.025, 0.04, hm, { cast: false });
  hIn.position.set(-0.82, 1.0, 0.045);
  pivot.add(hIn);
  const hOut = mkBox(0.14, 0.025, 0.04, hm, { cast: false });
  hOut.position.set(-0.82, 1.0, -0.045);
  pivot.add(hOut);
  // サムターン・ドアチェーン
  const tt = mkMesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 10), hm, { cast: false });
  tt.rotation.x = Math.PI / 2;
  tt.position.set(-0.82, 1.15, 0.035);
  pivot.add(tt);
  w.thumbTurn = tt;
  const chain = mkBox(0.01, 0.01, 0.12, hm, { cast: false });
  chain.position.set(-0.78, 1.45, 0.06);
  pivot.add(chain);
  // 覗き穴
  const pe = mkMesh(new THREE.CylinderGeometry(0.012, 0.012, 0.06, 8), hm, { cast: false });
  pe.rotation.x = Math.PI / 2;
  pe.position.set(-0.45, 1.52, 0);
  pivot.add(pe);
  // 廊下側ネームプレート・号室
  const plate = w.numberPlate('404');
  plate.position.set(-0.45, 1.72, -0.0235);
  plate.rotation.y = Math.PI;
  pivot.add(plate);
  const nm = w.nameplate('');
  nm.position.set(-0.12, 1.62, -0.0235);
  nm.rotation.y = Math.PI;
  pivot.add(nm);
  w.namePlate404 = nm;
  w.pickable(nm, { id: 'nameplate', tag: 'sign', name: '表札', dist: 2.4 });
  // ポスト口（ドア下側）
  const slot = mkBox(0.26, 0.04, 0.02, M.get('metalDark', 'genkan'), { cast: false });
  slot.position.set(-0.45, 0.95, -0.03);
  pivot.add(slot);

  const col = w.collide(-0.45, -0.05, 0.45, 0.1, { y1: 3 });
  const door = new Door(w, {
    id: 'front',
    pivot,
    closedAngle: 0,
    openAngle: (105 * Math.PI) / 180,
    collider: col,
    pos: new THREE.Vector3(0, 1, 0),
    sound: 'steel',
    speed: 1.3,
  });
  w.doors.front = door;
  w.pickable(leaf, { id: 'frontDoor', tag: 'door', name: '玄関ドア', dist: 2.2 });
  w.frontLeaf = leaf;
}

// ======================================================================= 廊下（dzで延長可能）
export function buildHall(w, dz) {
  const { B, M } = w;
  const g = w.groups.hall;
  // 既存を破棄
  for (const c of [...g.children]) {
    g.remove(c);
    c.geometry?.dispose();
  }
  w.removeColliders((c) => c.hall);
  w.hallDecals ||= [];
  w.hallDecals.length = 0;
  B.target = g;
  B.cast = false;
  B.receive = true;
  const z0 = DIM.hallZ0;
  const z1 = DIM.hallZ1 + dz;
  const wall = M.get('wallHall', 'hall');
  const ceil = M.get('ceilIn', 'hall');
  const floor = M.get('floorWood', 'hall');
  const trim = M.get('trim', 'hall');
  const crown = M.get('trim', 'hall');
  B.floor(floor, -WX, z0, WX, z1, 0);
  B.ceil(ceil, -WX, z0, WX, z1, CEIL);
  const bathDoorZ = 2.2;
  const toiletDoorZ = 1.95;
  const west = [{ c: bathDoorZ, w: 0.78, h: DOOR_H }];
  const east = [{ c: toiletDoorZ, w: 0.72, h: DOOR_H }];
  B.wall(wall, 'x', -WX, z0, z1, 0, CEIL, +1, west, { skirt: trim, crown });
  B.wall(wall, 'x', +WX, z0, z1, 0, CEIL, -1, east, { skirt: trim, crown });
  const cs = (c) => {
    c.hall = true;
    c.y1 = 3;
  };
  B.wallCollide('x', -WX, z0, z1, west, -1, 0.3, { y1: 3, hall: true });
  B.wallCollide('x', +WX, z0, z1, east, +1, 0.3, { y1: 3, hall: true });
  B.flush(g);
  // 床・天井の壁際AO（バッチ）
  const len = z1 - z0;
  for (const s of [-1, 1]) {
    const ry = s > 0 ? -Math.PI / 2 : Math.PI / 2;
    w.decals.wall(g, s * (WX - 0.001), 0.21, (z0 + z1) / 2, len, 0.42, ry, Math.PI, 0.5);
    w.decals.wall(g, s * (WX - 0.001), CEIL - 0.175, (z0 + z1) / 2, len, 0.35, ry, 0, 0.4);
  }
  w.decals.flush(g);
  // 奥行きが増えた分だけ暗い奥を作る（廊下の奥の闇）
  return { z1 };
}

// ======================================================================= 水回り（浴室・トイレ）
function buildWet(w, g) {
  const { B, M } = w;
  B.target = g;
  B.cast = false;
  B.receive = true;
  const D = DIM.bath;
  const tile = M.get('tile', 'bath');
  const tf = M.get('tileFloor', 'bath');
  const ceil = M.get('ceilIn', 'bath');
  const trim = M.get('trim', 'bath');
  const ops = [{ c: 2.2, w: 0.78, h: DOOR_H }];
  B.floor(tf, D.x0, D.z0, D.x1, D.z1, 0);
  B.ceil(ceil, D.x0, D.z0, D.x1, D.z1, CEIL);
  B.wall(tile, 'x', D.x0, D.z0, D.z1, 0, CEIL, +1);
  B.wall(tile, 'x', D.x1, D.z0, D.z1, 0, CEIL, -1, ops, { skirt: trim });
  B.wall(tile, 'z', D.z0, D.x0, D.x1, 0, CEIL, +1);
  B.wall(tile, 'z', D.z1, D.x0, D.x1, 0, CEIL, -1);
  B.wallCollide('x', D.x0, D.z0, D.z1, [], -1, 0.3, { y1: 3 });
  B.wallCollide('x', D.x1, D.z0, D.z1, ops, +1, 0.1, { y1: 3 });
  B.wallCollide('z', D.z0, D.x0, D.x1, [], -1, 0.3, { y1: 3 });
  B.wallCollide('z', D.z1, D.x0, D.x1, [], +1, 0.3, { y1: 3 });
  // 見込み（ドア枠）
  doorFrame(w, g, 'x', -0.96, 2.2, 0.78, DOOR_H, 0.14, M.get('trim', 'bath'));

  // 扉（ヒンジは手前=南側）
  makeSimpleDoor(w, g, { id: 'bath', axis: 'x', plane: -0.96, center: 2.2, width: 0.74, hingeSide: +1, room: 'hall', mat: 'doorPaint', openSign: -1, glass: false });

  const t = DIM.toilet;
  const opsT = [{ c: 1.95, w: 0.72, h: DOOR_H }];
  const wallT = M.get('wallBed', 'toilet');
  const floorT = M.get('floorWood', 'toilet');
  B.floor(floorT, t.x0, t.z0, t.x1, t.z1, 0);
  B.ceil(M.get('ceilIn', 'toilet'), t.x0, t.z0, t.x1, t.z1, CEIL);
  B.wall(wallT, 'x', t.x0, t.z0, t.z1, 0, CEIL, +1, opsT, { skirt: M.get('trim', 'toilet') });
  B.wall(wallT, 'x', t.x1, t.z0, t.z1, 0, CEIL, -1, [], { skirt: M.get('trim', 'toilet') });
  B.wall(wallT, 'z', t.z0, t.x0, t.x1, 0, CEIL, +1, [], { skirt: M.get('trim', 'toilet') });
  B.wall(wallT, 'z', t.z1, t.x0, t.x1, 0, CEIL, -1, [], { skirt: M.get('trim', 'toilet') });
  B.wallCollide('x', t.x0, t.z0, t.z1, opsT, -1, 0.1, { y1: 3 });
  B.wallCollide('x', t.x1, t.z0, t.z1, [], +1, 0.3, { y1: 3 });
  B.wallCollide('z', t.z0, t.x0, t.x1, [], -1, 0.3, { y1: 3 });
  B.wallCollide('z', t.z1, t.x0, t.x1, [], +1, 0.3, { y1: 3 });
  doorFrame(w, g, 'x', 0.96, 1.95, 0.72, DOOR_H, 0.14, M.get('trim', 'toilet'));
  makeSimpleDoor(w, g, { id: 'toilet', axis: 'x', plane: 0.96, center: 1.95, width: 0.7, hingeSide: +1, room: 'hall', mat: 'doorPaint', openSign: +1, glass: false });
}

/** 見込み付きドア枠。axis:'x' → 平面 x=plane（z方向に開口）、'z' → 平面 z=plane */
export function doorFrame(w, g, axis, plane, center, width, height, depth, mat) {
  const t = 0.05;
  const mk = (sx, sy, sz, px, py, pz) => {
    const m = mkBox(sx, sy, sz, mat, { cast: false });
    m.position.set(px, py, pz);
    g.add(m);
  };
  if (axis === 'x') {
    mk(depth, height + t, t, plane, (height + t) / 2, center - width / 2 - t / 2);
    mk(depth, height + t, t, plane, (height + t) / 2, center + width / 2 + t / 2);
    mk(depth, t, width + 2 * t, plane, height + t / 2, center);
  } else {
    mk(t, height + t, depth, center - width / 2 - t / 2, (height + t) / 2, plane);
    mk(t, height + t, depth, center + width / 2 + t / 2, (height + t) / 2, plane);
    mk(width + 2 * t, t, depth, center, height + t / 2, plane);
  }
}

/**
 * 簡易ヒンジドア
 * axis:'x' 平面 x=plane の壁（z方向に幅）。hingeSide: +1 → 中心+width/2 側にヒンジ。
 * openSign: 開く向き (+1: +x方向へ, -1: -x方向へ)
 */
export function makeSimpleDoor(w, g, cfg) {
  const { M } = w;
  const wd = cfg.width;
  const room = cfg.room || 'hall';
  const pivot = new THREE.Group();
  const mat = M.get(cfg.mat || 'doorPaint', room);
  const leaf = mkBox(cfg.axis === 'x' ? 0.04 : wd, DOOR_H - 0.02, cfg.axis === 'x' ? wd : 0.04, mat, { cast: true });
  const hm = M.get('chrome', room);
  let hinge;
  if (cfg.axis === 'x') {
    hinge = new THREE.Vector3(cfg.plane, 0, cfg.center + cfg.hingeSide * (wd / 2));
    leaf.position.set(0, (DOOR_H - 0.02) / 2, -cfg.hingeSide * (wd / 2));
  } else {
    hinge = new THREE.Vector3(cfg.center + cfg.hingeSide * (wd / 2), 0, cfg.plane);
    leaf.position.set(-cfg.hingeSide * (wd / 2), (DOOR_H - 0.02) / 2, 0);
  }
  pivot.position.copy(hinge);
  pivot.add(leaf);
  // ハンドル（両面）
  for (const sd of [-1, 1]) {
    const h = mkBox(cfg.axis === 'x' ? 0.045 : 0.13, 0.025, cfg.axis === 'x' ? 0.13 : 0.045, hm, { cast: false });
    const off = -cfg.hingeSide * (wd / 2 - 0.09);
    if (cfg.axis === 'x') h.position.set(sd * 0.04, 0.01, off);
    else h.position.set(off, 0.01, sd * 0.04);
    leaf.add(h);
  }
  if (cfg.glass) {
    const gm = new THREE.MeshBasicMaterial({ color: 0x08090a });
    const gp = new THREE.Mesh(new THREE.BoxGeometry(cfg.axis === 'x' ? 0.02 : wd - 0.22, 1.05, cfg.axis === 'x' ? wd - 0.22 : 0.02), gm);
    gp.position.set(0, 0.28, 0);
    leaf.add(gp);
    w.props.ldkGlass = gm;
  }
  g.add(pivot);
  // 開き角度：開く向きに合わせる
  const ang = cfg.axis === 'x' ? -cfg.openSign * cfg.hingeSide * (Math.PI / 2) : cfg.openSign * cfg.hingeSide * (Math.PI / 2);
  const open = ang * (cfg.openFrac ?? 1.0);
  const colRect =
    cfg.axis === 'x'
      ? w.collide(cfg.plane - 0.05, cfg.center - wd / 2, cfg.plane + 0.05, cfg.center + wd / 2, { y1: 3 })
      : w.collide(cfg.center - wd / 2, cfg.plane - 0.05, cfg.center + wd / 2, cfg.plane + 0.05, { y1: 3 });
  if (cfg.deep) colRect.deep = true;
  const door = new Door(w, {
    id: cfg.id,
    pivot,
    closedAngle: 0,
    openAngle: open,
    collider: colRect,
    pos: new THREE.Vector3(cfg.axis === 'x' ? cfg.plane : cfg.center, 1, cfg.axis === 'x' ? cfg.center : cfg.plane),
    sound: cfg.sound || 'wood',
    speed: cfg.speed || 1.7,
  });
  w.doors[cfg.id] = door;
  w.pickable(leaf, { id: cfg.id + 'Door', tag: 'door', name: cfg.name || 'ドア', dist: 2.2, door: cfg.id });
  door.leaf = leaf;
  if (cfg.deep) g.userData.deepDoors = true;
  return door;
}

// ======================================================================= LDK・寝室・ベランダ（奥エリア）
function buildDeep(w, g) {
  const { B, M } = w;
  const D = DIM.ldk;
  B.target = g;
  B.cast = false;
  B.receive = true;
  const wall = M.get('wallLDK', 'ldk');
  const ceil = M.get('ceilIn', 'ldk');
  const floor = M.get('floorWood', 'ldk');
  const trim = M.get('trim', 'ldk');
  const markDeep = (arr) => arr.forEach((c) => (c.deep = true));
  const colStart = B.colliders.length;

  // ---- LDK
  const doorHall = [{ c: 0, w: 0.9, h: DOOR_H }];
  const doorBed = [{ c: 4.9, w: 0.8, h: DOOR_H }];
  B.floor(floor, D.x0, D.z0, D.x1, D.z1, 0);
  B.ceil(ceil, D.x0, D.z0, D.x1, D.z1, CEIL);
  B.wall(wall, 'z', D.z0, D.x0, D.x1, 0, CEIL, +1, doorHall, { skirt: trim, crown: trim });
  B.wall(wall, 'z', D.z1, D.x0, D.x1, 0, CEIL, -1, [{ c: -1.4, w: 3.4, h: 2.1, sill: 0.08 }], { skirt: trim, crown: trim });
  B.wall(wall, 'x', D.x0, D.z0, D.z1, 0, CEIL, +1, [], { skirt: trim, crown: trim });
  B.wall(wall, 'x', D.x1, D.z0, D.z1, 0, CEIL, -1, doorBed, { skirt: trim, crown: trim });
  B.wallCollide('z', D.z0, D.x0, D.x1, doorHall, -1, 0.3, { y1: 3 });
  B.wallCollide('z', D.z1, D.x0, D.x1, [], +1, 0.3, { y1: 3 });
  B.wallCollide('x', D.x0, D.z0, D.z1, [], -1, 0.3, { y1: 3 });
  B.wallCollide('x', D.x1, D.z0, D.z1, doorBed, +1, 0.1, { y1: 3 });

  // 廊下側の壁面（廊下の終端：dz変化で一緒に動く）
  const hallEnd = DIM.hallZ1; // 3.5 (deep local)
  B.wall(M.get('wallHall', 'hall'), 'z', hallEnd, -WX, WX, 0, CEIL, -1, [{ c: 0, w: 0.9, h: DOOR_H }], { skirt: M.get('trim', 'hall'), crown: M.get('trim', 'hall') });
  B.wallCollide('z', hallEnd, -WX, WX, [{ c: 0, w: 0.9 }], +1, 0.3, { y1: 3 });
  // 出入口の見込み
  const jm = M.get('trim', 'ldk');
  B.quad(wall, [-0.45, 0, hallEnd], [-0.45, 0, D.z0], [-0.45, DOOR_H, D.z0], [-0.45, DOOR_H, hallEnd]);
  B.quad(wall, [0.45, 0, D.z0], [0.45, 0, hallEnd], [0.45, DOOR_H, hallEnd], [0.45, DOOR_H, D.z0]);
  B.quad(wall, [-0.45, DOOR_H, hallEnd], [0.45, DOOR_H, hallEnd], [0.45, DOOR_H, D.z0], [-0.45, DOOR_H, D.z0]);

  // 窓（掃き出し）
  buildBalcony(w, g);

  // ---- 寝室
  buildBedroomShell(w, g);

  // 奥エリアの衝突は dz オフセット対象
  for (let i = colStart; i < B.colliders.length; i++) B.colliders[i].deep = true;

  // LDK出入口・寝室ドア
  doorFrame(w, g, 'z', 3.56, 0, 0.9, DOOR_H, 0.14, M.get('trim', 'ldk'));
  makeSimpleDoor(w, g, { id: 'ldk', axis: 'z', plane: 3.56, center: 0, width: 0.86, hingeSide: -1, room: 'ldk', mat: 'doorPaint', openSign: +1, glass: true, deep: true, name: 'リビングのドア' });
  doorFrame(w, g, 'x', 0.96, 4.9, 0.8, DOOR_H, 0.14, M.get('trim', 'ldk'));
  makeSimpleDoor(w, g, { id: 'bed', axis: 'x', plane: 0.96, center: 4.9, width: 0.78, hingeSide: +1, room: 'ldk', mat: 'doorPaint', openSign: +1, deep: true, name: '寝室のドア' });
  // ドア2枚は deep グループ内
}

function buildBalcony(w, g) {
  const { B, M } = w;
  const D = DIM.ldk;
  // 窓枠・サッシ
  const alu = M.get('metal', 'ldk');
  const cx = -1.4;
  const wd = 3.4;
  const y0 = 0.08;
  const y1 = 2.1;
  const zz = D.z1 - 0.02;
  // サッシ枠
  const fr = (sx, sy, sz, x, y, z) => {
    const m = mkBox(sx, sy, sz, alu, { cast: false });
    m.position.set(x, y, z);
    g.add(m);
  };
  fr(wd + 0.1, 0.06, 0.1, cx, y0, zz);
  fr(wd + 0.1, 0.06, 0.1, cx, y1, zz);
  fr(0.05, y1 - y0, 0.1, cx - wd / 2 - 0.025, (y0 + y1) / 2, zz);
  fr(0.05, y1 - y0, 0.1, cx + wd / 2 + 0.025, (y0 + y1) / 2, zz);
  fr(0.05, y1 - y0, 0.1, cx, (y0 + y1) / 2, zz);
  fr(0.04, y1 - y0, 0.06, cx - wd / 4, (y0 + y1) / 2, zz + 0.02);
  fr(0.04, y1 - y0, 0.06, cx + wd / 4, (y0 + y1) / 2, zz + 0.02);
  // ガラス
  const glass = mkBox(wd, y1 - y0, 0.01, M.get('glass', 'ldk'), { cast: false, receive: false });
  glass.position.set(cx, (y0 + y1) / 2, zz);
  g.add(glass);
  glass.renderOrder = 3;
  w.windowGlassLDK = glass;
  // クレセント錠
  const lock = mkBox(0.03, 0.08, 0.03, M.get('chrome', 'ldk'), { cast: false });
  lock.position.set(cx + 0.06, 1.05, zz - 0.06);
  g.add(lock);
  w.pickable(glass, { id: 'window', tag: 'window', name: 'ベランダの窓', dist: 3.0 });
  w.sashLock = lock;
  // 外：ベランダ
  const bz0 = D.z1 + 0.1;
  const bz1 = bz0 + 1.3;
  B.target = g;
  B.cast = false;
  const conc = M.get('concrete', 'out');
  const outFloor = M.get('concrete', 'out');
  B.floor(outFloor, D.x0 - 0.2, bz0, D.x1 + 0.2, bz1, -0.02);
  B.box(D.x0 - 0.2, 0, bz1 - 0.12, D.x1 + 0.2, 1.1, bz1, { all: conc });
  B.box(D.x0 - 0.2, 0, bz0, D.x0 - 0.08, 1.1, bz1, { all: conc });
  B.box(D.x1 + 0.08, 0, bz0, D.x1 + 0.2, 1.1, bz1, { all: conc });
  B.ceil(M.get('ceilCor', 'out'), D.x0 - 0.2, bz0, D.x1 + 0.2, bz1, 2.45);
  B.collide(D.x0 - 0.3, bz0, D.x1 + 0.3, bz1 + 0.3, { y1: 3 });
  // 室外機・物干し
  const ac = mkBox(0.8, 0.6, 0.3, M.get('plastic', 'out'));
  ac.position.set(-3.0, 0.3, bz1 - 0.35);
  g.add(ac);
  const fan = mkMesh(new THREE.CylinderGeometry(0.2, 0.2, 0.02, 20), M.get('plasticDark', 'out'));
  fan.rotation.x = Math.PI / 2;
  fan.position.set(-3.0, 0.3, bz1 - 0.5);
  g.add(fan);
  const pole = mkMesh(new THREE.CylinderGeometry(0.012, 0.012, 3.0, 6), M.get('metal', 'out'));
  pole.rotation.z = Math.PI / 2;
  pole.position.set(-1.4, 2.1, bz0 + 0.3);
  g.add(pole);
  // ハンガーに掛かった服
  const shirt = mkBox(0.45, 0.65, 0.02, M.get('fabricBed', 'out'));
  shirt.position.set(-1.0, 1.7, bz0 + 0.3);
  shirt.rotation.y = 0.2;
  shirt.userData.sway = 1;
  shirt.userData.keep = true;
  g.add(shirt);
  w.laundry = shirt;
  // 屋外側の暗い壁（隣接ビルへの反射を避けるため）
}

function buildBedroomShell(w, g) {
  const { B, M } = w;
  const D = DIM.bed;
  const wall = M.get('wallBed', 'bed');
  const ceil = M.get('ceilIn', 'bed');
  const floor = M.get('floorWood', 'bed');
  const trim = M.get('trim', 'bed');
  const doorW = [{ c: 4.9, w: 0.8, h: DOOR_H }];
  B.floor(floor, D.x0, D.z0, D.x1, D.z1, 0);
  B.ceil(ceil, D.x0, D.z0, D.x1, D.z1, CEIL);
  B.wall(wall, 'x', D.x0, D.z0, D.z1, 0, CEIL, +1, doorW, { skirt: trim, crown: trim });
  B.wall(wall, 'x', D.x1, D.z0, D.z1, 0, CEIL, -1, [{ c: 4.0, w: 1.3, h: 2.05, sill: 0.95 }], { skirt: trim, crown: trim });
  B.wall(wall, 'z', D.z0, D.x0, D.x1, 0, CEIL, +1, [], { skirt: trim, crown: trim });
  B.wall(wall, 'z', D.z1, D.x0, D.x1, 0, CEIL, -1, [], { skirt: trim, crown: trim });
  B.wallCollide('x', D.x0, D.z0, D.z1, doorW, -1, 0.1, { y1: 3 });
  B.wallCollide('x', D.x1, D.z0, D.z1, [], +1, 0.3, { y1: 3 });
  B.wallCollide('z', D.z0, D.x0, D.x1, [], -1, 0.3, { y1: 3 });
  B.wallCollide('z', D.z1, D.x0, D.x1, [], +1, 0.3, { y1: 3 });
  // 窓の見込みと窓枠
  const zc = 4.0;
  const sillY = 0.95;
  const top = 2.05;
  const t = 0.2;
  const tw = M.get('trim', 'bed');
  const xx = D.x1;
  B.quad(tw, [xx, sillY, zc - 0.65], [xx + t, sillY, zc - 0.65], [xx + t, top, zc - 0.65], [xx, top, zc - 0.65]);
  B.quad(tw, [xx + t, sillY, zc + 0.65], [xx, sillY, zc + 0.65], [xx, top, zc + 0.65], [xx + t, top, zc + 0.65]);
  B.quad(tw, [xx, top, zc + 0.65], [xx + t, top, zc + 0.65], [xx + t, top, zc - 0.65], [xx, top, zc - 0.65]);
  B.quad(tw, [xx, sillY, zc - 0.65], [xx, sillY, zc + 0.65], [xx + t, sillY, zc + 0.65], [xx + t, sillY, zc - 0.65]);
  const glass = mkBox(0.01, top - sillY, 1.3, M.get('glass', 'bed'), { cast: false, receive: false });
  glass.position.set(xx + 0.1, (top + sillY) / 2, zc);
  glass.renderOrder = 3;
  g.add(glass);
  w.bedWindow = glass;
  w.pickable(glass, { id: 'bedWindow', tag: 'window', name: '寝室の窓', dist: 2.6 });
}
