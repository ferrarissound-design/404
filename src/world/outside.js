// 屋外：空・街並み・路面・霧（ドローコールを最小化するため、ビル群は1メッシュに統合）
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import * as T from '../tex.js';
import { rng } from '../util.js';
import { glowSprite } from './core.js';

/** 向かいの棟の窓明かりファサード（1枚のキャンバス）*/
function facadeCanvas(cols, rows, pitchX, pitchY, seed, hole) {
  const cw = 1024;
  const ch = Math.round((cw * rows * pitchY) / (cols * pitchX));
  const c = document.createElement('canvas');
  c.width = cw;
  c.height = ch;
  const x = c.getContext('2d');
  const r = rng(seed);
  const g = x.createLinearGradient(0, 0, 0, ch);
  g.addColorStop(0, '#080b10');
  g.addColorStop(1, '#10141b');
  x.fillStyle = g;
  x.fillRect(0, 0, cw, ch);
  const cellW = cw / cols;
  const cellH = ch / rows;
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const px = i * cellW + cellW * 0.2;
      const py = j * cellH + cellH * 0.2;
      const ww = cellW * 0.6;
      const hh = cellH * 0.55;
      const isHole = hole && hole.i === i && hole.j === j;
      if (isHole) {
        x.fillStyle = '#05070a';
        x.fillRect(px - 4, py - 4, ww + 8, hh + 8);
        x.fillStyle = '#12171e';
        x.fillRect(px, py, ww, hh);
        continue;
      }
      const lit = r() < 0.22;
      if (lit) {
        const a = r.range(0.55, 1);
        const warm = r() < 0.72;
        x.fillStyle = warm ? `rgba(255,${Math.floor(r.range(185, 225))},${Math.floor(r.range(110, 155))},${a})` : `rgba(215,232,255,${a})`;
        x.fillRect(px, py, ww, hh);
        // カーテンの影・桟
        x.fillStyle = 'rgba(0,0,0,0.35)';
        x.fillRect(px + ww / 2 - 1.5, py, 3, hh);
        if (r() < 0.4) x.fillRect(px, py + hh * 0.7, ww, hh * 0.3);
      } else {
        x.fillStyle = 'rgba(22,28,38,1)';
        x.fillRect(px, py, ww, hh);
        x.fillStyle = 'rgba(60,70,90,0.12)';
        x.fillRect(px, py, ww, hh * 0.3);
      }
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildOutside(w, tierParticles = 1) {
  const g = new THREE.Group();
  g.name = 'outside';
  w.root.add(g);
  w.outside = g;

  // 空
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(300, 20, 12),
    new THREE.MeshBasicMaterial({ map: T.skyTex(), side: THREE.BackSide, fog: false, depthWrite: false })
  );
  sky.renderOrder = -10;
  g.add(sky);
  w.sky = sky;

  // ---- 遠景のビル群：1メッシュ
  const facade = T.cityFacade(1, 0.26);
  const r = rng(1234);
  const geos = [];
  const mkBuilding = (x, z, wid, dep, hei, y0 = -11) => {
    const bg = new THREE.BoxGeometry(wid, hei, dep);
    const uv = bg.attributes.uv;
    const offU = r();
    const offV = r();
    const dims = [
      [dep, hei],
      [dep, hei],
      [wid, dep],
      [wid, dep],
      [wid, hei],
      [wid, hei],
    ];
    for (let f = 0; f < 6; f++) {
      for (let i = 0; i < 4; i++) {
        const k = f * 4 + i;
        if (f === 2 || f === 3) uv.setXY(k, 0.004, 0.004);
        else uv.setXY(k, (uv.getX(k) * dims[f][0]) / 8 + offU, (uv.getY(k) * dims[f][1]) / 18 + offV);
      }
    }
    bg.translate(x, y0 + hei / 2, z);
    const br = 0.55 + r() * 0.45;
    const col = new Float32Array(bg.attributes.position.count * 3).fill(br);
    bg.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geos.push(bg);
  };
  const northZ = -15;
  mkBuilding(-26, northZ - 4, 18, 12, 42);
  mkBuilding(-8, northZ - 1, 16, 10, 36);
  mkBuilding(10, northZ - 3, 18, 12, 46);
  mkBuilding(28, northZ - 6, 20, 14, 38);
  mkBuilding(-44, northZ - 12, 22, 14, 50);
  mkBuilding(46, northZ - 14, 24, 16, 44);
  mkBuilding(-14, northZ - 24, 26, 16, 58);
  mkBuilding(18, northZ - 28, 28, 18, 64);
  mkBuilding(-60, northZ - 30, 28, 18, 54);
  mkBuilding(62, northZ - 34, 30, 18, 56);
  const southZ = 30;
  mkBuilding(-28, southZ, 18, 12, 40);
  mkBuilding(-6, southZ + 4, 16, 10, 34);
  mkBuilding(14, southZ + 2, 18, 12, 44);
  mkBuilding(34, southZ + 8, 20, 14, 36);
  mkBuilding(-50, southZ + 14, 24, 14, 52);
  mkBuilding(50, southZ + 18, 24, 16, 48);
  mkBuilding(0, southZ + 30, 36, 18, 62);
  mkBuilding(-70, 6, 14, 22, 50);
  mkBuilding(72, 4, 14, 24, 50);
  const city = new THREE.Mesh(mergeGeometries(geos, false), new THREE.MeshBasicMaterial({ map: facade, vertexColors: true, fog: true }));
  city.frustumCulled = false;
  g.add(city);
  geos.forEach((x) => x.dispose());

  // ---- 路面・街灯・車・自販機（1メッシュ）
  const sg = [];
  const col = (geo, c) => {
    const cc = new THREE.Color(c);
    const arr = new Float32Array(geo.attributes.position.count * 3);
    for (let i = 0; i < arr.length; i += 3) {
      arr[i] = cc.r;
      arr[i + 1] = cc.g;
      arr[i + 2] = cc.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
    if (geo.index) geo = geo.toNonIndexed();
    return geo;
  };
  const lamps = [
    [-12, -6],
    [9, -6],
    [30, -6],
    [-34, -6],
    [-4, 18],
    [20, 18],
  ];
  for (const [x, z] of lamps) {
    const pole = new THREE.CylinderGeometry(0.08, 0.1, 7.5, 6);
    pole.translate(x, -11 + 3.75, z);
    sg.push(col(pole, 0x15181c));
  }
  const vend = new THREE.BoxGeometry(1.0, 1.9, 0.8);
  vend.translate(-16, -10.05, -6);
  sg.push(col(vend, 0xb8c8d8));
  for (const [x, z] of [
    [-3, -5],
    [4, -5.2],
    [24, -5],
  ]) {
    const b1 = new THREE.BoxGeometry(4.2, 0.9, 1.8);
    b1.translate(x, -11 + 0.55, z);
    const b2 = new THREE.BoxGeometry(2.2, 0.7, 1.6);
    b2.translate(x - 0.2, -11 + 1.3, z);
    sg.push(col(b1, 0x0c0e12), col(b2, 0x0c0e12));
  }
  const street = new THREE.Mesh(mergeGeometries(sg, false), new THREE.MeshBasicMaterial({ vertexColors: true, fog: true }));
  g.add(street);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), new THREE.MeshBasicMaterial({ color: 0x0a0b0e, fog: true }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -11;
  g.add(ground);
  const lampTex = w.tex.glow;
  for (const [x, z] of lamps) {
    const gl = glowSprite(lampTex, 0xffd9a0, 9, 0.65);
    gl.position.set(x, -11 + 7.6, z);
    g.add(gl);
  }
  const vg = glowSprite(lampTex, 0xcfe8ff, 7, 0.4);
  vg.position.set(-16, -9.6, -5.2);
  g.add(vg);

  // ---- 向かいの棟（北：廊下から見える）
  const wz = -9.5;
  const nCols = 12;
  const nTex = facadeCanvas(nCols, 5, 2.3, 2.8, 41, { i: 7, j: 3 });
  const nWall = new THREE.Mesh(new THREE.PlaneGeometry(nCols * 2.3, 5 * 2.8), new THREE.MeshBasicMaterial({ map: nTex, fog: true }));
  nWall.position.set(-5, 4.0, wz);
  g.add(nWall);
  const wx = -5 + (7 - 5.5) * 2.3;
  const wy = 4.0 + (2 - 3) * 2.8;
  const dark = new THREE.MeshBasicMaterial({ color: 0x050403, fog: true });
  const watcher = new THREE.Group();
  const lit = new THREE.Mesh(new THREE.PlaneGeometry(1.35, 1.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.2, 1.7, 1.0), fog: true }));
  watcher.add(lit);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.55, 4, 10), dark);
  body.position.set(0, -0.1, 0.01);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 10), dark);
  head.position.set(0, 0.42, 0.01);
  watcher.add(body, head);
  watcher.position.set(wx, wy, wz + 0.04);
  watcher.visible = false;
  g.add(watcher);
  w.watcher = watcher;

  // ---- 南（ベランダの向こう）
  const sCols = 11;
  const sTex = facadeCanvas(sCols, 5, 2.4, 2.8, 77, { i: 5, j: 3 });
  const sWall = new THREE.Mesh(new THREE.PlaneGeometry(sCols * 2.4, 5 * 2.8), new THREE.MeshBasicMaterial({ map: sTex, fog: true }));
  sWall.position.set(-1.6, 4.0, 22.9);
  sWall.rotation.y = Math.PI;
  g.add(sWall);
  const swatch = new THREE.Group();
  const slit = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.5), new THREE.MeshBasicMaterial({ color: new THREE.Color(2.0, 1.8, 1.3), fog: true }));
  swatch.add(slit);
  const sb = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.6, 4, 10), dark);
  sb.position.set(0, -0.1, -0.01);
  const sh = new THREE.Mesh(new THREE.SphereGeometry(0.12, 12, 10), dark);
  sh.position.set(0, 0.46, -0.01);
  swatch.add(sb, sh);
  swatch.position.set(-1.6, 4.0 + (2 - 3) * 2.8, 22.86);
  swatch.rotation.y = Math.PI;
  swatch.visible = false;
  g.add(swatch);
  w.watcherSouth = swatch;

  // ---- 霧のスプライト（共用廊下の外側）
  w.mist = [];
  const nMist = Math.max(2, Math.round(5 * tierParticles));
  for (let i = 0; i < nMist; i++) {
    const s = glowSprite(lampTex, 0x7f8fa6, 9 + Math.random() * 5, 0.05 + Math.random() * 0.04);
    s.position.set(-14 + Math.random() * 30, -1 + Math.random() * 3, -3 - Math.random() * 6);
    s.userData.v = 0.1 + Math.random() * 0.25;
    s.userData.ph = Math.random() * 6;
    g.add(s);
    w.mist.push(s);
  }
}
