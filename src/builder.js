// 静的ジオメトリのバッチビルダー：面単位で積み、(マテリアル, 影設定, 親グループ)ごとに1メッシュへ統合する
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _n = new THREE.Vector3();

export class Batcher {
  constructor() {
    this.batches = new Map();
    this.target = null; // 追加先 THREE.Group
    this.cast = false;
    this.receive = true;
    this.colliders = [];
    this.stats = { quads: 0 };
  }

  _batch(mat) {
    const key = `${mat.uuid}|${this.target.uuid}|${this.cast ? 1 : 0}${this.receive ? 1 : 0}`;
    let b = this.batches.get(key);
    if (!b) {
      b = { mat, target: this.target, cast: this.cast, receive: this.receive, pos: [], nor: [], uv: [] };
      this.batches.set(key, b);
    }
    return b;
  }

  /** 四角形（a,b,c,d は表から見て反時計回り）*/
  quad(mat, a, b, c, d, uvmode) {
    const bt = this._batch(mat);
    _a.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    _b.set(d[0] - a[0], d[1] - a[1], d[2] - a[2]);
    _n.crossVectors(_a, _b).normalize();
    const tile = mat.userData.tile || 1;
    const k = 1 / tile;
    let mode = uvmode;
    if (!mode) {
      const ax = Math.abs(_n.x);
      const ay = Math.abs(_n.y);
      mode = ay > 0.5 ? 'xz' : ax > 0.5 ? 'zy' : 'xy';
    }
    const uvOf = (p) => (mode === 'xz' ? [p[0] * k, p[2] * k] : mode === 'zy' ? [p[2] * k, p[1] * k] : [p[0] * k, p[1] * k]);
    const ua = uvOf(a);
    const ub = uvOf(b);
    const uc = uvOf(c);
    const ud = uvOf(d);
    const P = bt.pos;
    const N = bt.nor;
    const U = bt.uv;
    const tri = (p, q, r, up, uq, ur) => {
      P.push(p[0], p[1], p[2], q[0], q[1], q[2], r[0], r[1], r[2]);
      N.push(_n.x, _n.y, _n.z, _n.x, _n.y, _n.z, _n.x, _n.y, _n.z);
      U.push(up[0], up[1], uq[0], uq[1], ur[0], ur[1]);
    };
    tri(a, b, c, ua, ub, uc);
    tri(a, c, d, ua, uc, ud);
    this.stats.quads++;
  }

  /** 直方体。m は単一マテリアル or {px,nx,py,ny,pz,nz,all}。省略面は描かない */
  box(x0, y0, z0, x1, y1, z1, m, opts = {}) {
    const get = (k) => (m.isMaterial ? m : (k in m ? m[k] : m.all) || null);
    const px = get('px');
    const nx = get('nx');
    const py = get('py');
    const ny = get('ny');
    const pz = get('pz');
    const nz = get('nz');
    if (px) this.quad(px, [x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]);
    if (nx) this.quad(nx, [x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]);
    if (py) this.quad(py, [x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]);
    if (ny) this.quad(ny, [x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]);
    if (pz) this.quad(pz, [x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]);
    if (nz) this.quad(nz, [x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]);
    if (opts.collide) this.collide(x0, z0, x1, z1, opts.collide === true ? {} : opts.collide);
  }

  /** 中心・寸法指定の箱（回転なし）*/
  boxC(cx, cy, cz, w, h, d, m, opts) {
    this.box(cx - w / 2, cy - h / 2, cz - d / 2, cx + w / 2, cy + h / 2, cz + d / 2, m, opts);
  }

  /** 任意ジオメトリ（Y回転・位置・スケール）を追加 */
  geo(geometry, mat, x = 0, y = 0, z = 0, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
    let g = geometry.index ? geometry.toNonIndexed() : geometry;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ'));
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz));
    const nm = new THREE.Matrix3().getNormalMatrix(m);
    const bt = this._batch(mat);
    const pa = g.attributes.position;
    const na = g.attributes.normal;
    const ua = g.attributes.uv;
    const v = new THREE.Vector3();
    for (let i = 0; i < pa.count; i++) {
      v.fromBufferAttribute(pa, i).applyMatrix4(m);
      bt.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(na, i).applyMatrix3(nm).normalize();
      bt.nor.push(v.x, v.y, v.z);
      if (ua) bt.uv.push(ua.getX(i), ua.getY(i));
      else bt.uv.push(0, 0);
    }
    if (g !== geometry) g.dispose();
  }

  /** 衝突用AABB（xz平面）。deep: 奥エリア（廊下延長でオフセットされる）*/
  collide(x0, z0, x1, z1, extra = {}) {
    const c = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), on: true, ...extra };
    c.bx0 = c.x0;
    c.bx1 = c.x1;
    c.bz0 = c.z0;
    c.bz1 = c.z1;
    this.colliders.push(c);
    return c;
  }

  /**
   * 壁面（片面）を開口付きで生成。
   * axis: 'x' → 平面 x=plane が z 方向に伸びる / 'z' → 平面 z=plane が x 方向に伸びる
   * facing: +1 / -1（面が向いている向き）
   */
  wall(mat, axis, plane, a0, a1, y0, y1, facing, openings = [], opts = {}) {
    const ops = [...openings].sort((p, q) => p.c - q.c);
    const segs = []; // 床から天井までの柱部分
    let cur = a0;
    for (const o of ops) {
      const lo = o.c - o.w / 2;
      const hi = o.c + o.w / 2;
      if (lo > cur) segs.push([cur, lo]);
      cur = hi;
      // 開口上部
      const top = y0 + (o.h ?? 2.0);
      if (top < y1) this._wallRect(mat, axis, plane, lo, hi, top, y1, facing);
      if (o.sill) this._wallRect(mat, axis, plane, lo, hi, y0, y0 + o.sill, facing);
    }
    if (cur < a1) segs.push([cur, a1]);
    for (const [s0, s1] of segs) this._wallRect(mat, axis, plane, s0, s1, y0, y1, facing);

    if (opts.skirt) {
      const t = 0.012;
      const h = opts.skirtH ?? 0.075;
      for (const [s0, s1] of segs) {
        if (axis === 'z') this.box(s0, y0, plane + (facing > 0 ? 0 : -t), s1, y0 + h, plane + (facing > 0 ? t : 0), opts.skirt);
        else this.box(plane + (facing > 0 ? 0 : -t), y0, s0, plane + (facing > 0 ? t : 0), y0 + h, s1, opts.skirt);
      }
    }
    if (opts.crown) {
      const t = 0.02;
      const h = 0.035;
      if (axis === 'z') this.box(a0, y1 - h, plane + (facing > 0 ? 0 : -t), a1, y1, plane + (facing > 0 ? t : 0), opts.crown);
      else this.box(plane + (facing > 0 ? 0 : -t), y1 - h, a0, plane + (facing > 0 ? t : 0), y1, a1, opts.crown);
    }
    return segs;
  }

  _wallRect(mat, axis, plane, s0, s1, y0, y1, facing) {
    if (s1 - s0 < 1e-4 || y1 - y0 < 1e-4) return;
    if (axis === 'z') {
      if (facing > 0) this.quad(mat, [s0, y0, plane], [s1, y0, plane], [s1, y1, plane], [s0, y1, plane]);
      else this.quad(mat, [s1, y0, plane], [s0, y0, plane], [s0, y1, plane], [s1, y1, plane]);
    } else {
      if (facing > 0) this.quad(mat, [plane, y0, s1], [plane, y0, s0], [plane, y1, s0], [plane, y1, s1]);
      else this.quad(mat, [plane, y0, s0], [plane, y0, s1], [plane, y1, s1], [plane, y1, s0]);
    }
  }

  floor(mat, x0, z0, x1, z1, y) {
    this.quad(mat, [x0, y, z1], [x1, y, z1], [x1, y, z0], [x0, y, z0]);
  }

  ceil(mat, x0, z0, x1, z1, y) {
    this.quad(mat, [x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1]);
  }

  /** 壁の衝突体を開口を避けて生成。solid: 壁の裏側の方向 */
  wallCollide(axis, plane, a0, a1, openings, solid, thick = 0.25, extra = {}) {
    const ops = [...openings].sort((p, q) => p.c - q.c);
    let cur = a0;
    const out = [];
    const mk = (s0, s1) => {
      if (s1 - s0 < 1e-3) return;
      const p0 = solid > 0 ? plane : plane - thick;
      const p1 = solid > 0 ? plane + thick : plane;
      out.push(axis === 'z' ? this.collide(s0, p0, s1, p1, extra) : this.collide(p0, s0, p1, s1, extra));
    };
    for (const o of ops) {
      mk(cur, o.c - o.w / 2);
      cur = o.c + o.w / 2;
    }
    mk(cur, a1);
    return out;
  }

  /** メッシュ化して target に追加 */
  flush(target) {
    const meshes = [];
    for (const [key, b] of [...this.batches.entries()]) {
      if (target && b.target !== target) continue;
      this.batches.delete(key);
      if (!b.pos.length) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(b.nor, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.computeBoundingSphere();
      g.computeBoundingBox();
      const m = new THREE.Mesh(g, b.mat);
      m.castShadow = b.cast;
      m.receiveShadow = b.receive;
      m.matrixAutoUpdate = false;
      m.updateMatrix();
      m.name = 'batch:' + b.mat.name;
      b.target.add(m);
      meshes.push(m);
    }
    return meshes;
  }
}

// ---------------------------------------------------------------- 動的メッシュ用ヘルパ

/** UVをメートル基準にした箱ジオメトリ */
export function boxGeo(w, h, d, tile = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [
    [d, h],
    [d, h],
    [w, d],
    [w, d],
    [w, h],
    [w, h],
  ];
  for (let f = 0; f < 6; f++) {
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, (uv.getX(k) * dims[f][0]) / tile, (uv.getY(k) * dims[f][1]) / tile);
    }
  }
  return g;
}

export function mkBox(w, h, d, mat, opts = {}) {
  const m = new THREE.Mesh(boxGeo(w, h, d, mat.userData.tile || 1), mat);
  m.castShadow = opts.cast ?? true;
  m.receiveShadow = opts.receive ?? true;
  return m;
}

export function mkMesh(geo, mat, opts = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = opts.cast ?? true;
  m.receiveShadow = opts.receive ?? true;
  return m;
}

/** 地面デカール（接地影・足跡・光だまり）*/
export function decalFloor(tex, w, d, { y = 0.003, opacity = 0.5, color = 0x000000, blending = THREE.NormalBlending, fog = true } = {}) {
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending,
    fog,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const g = new THREE.PlaneGeometry(w, d);
  g.rotateX(-Math.PI / 2);
  const m = new THREE.Mesh(g, mat);
  m.position.y = y;
  m.renderOrder = 2;
  m.matrixAutoUpdate = true;
  return m;
}

/** 縦面デカール（壁の隅AO）*/
export function decalWall(tex, w, h, { opacity = 0.5, color = 0x000000, fog = true } = {}) {
  const mat = new THREE.MeshBasicMaterial({
    map: tex,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    fog,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  m.renderOrder = 2;
  return m;
}

// ---------------------------------------------------------------- 描画統合（ドローコール削減）
const _tmpM = new THREE.Matrix4();

function relMatrix(obj, root, out) {
  const chain = [];
  let o = obj;
  while (o && o !== root) {
    chain.push(o);
    o = o.parent;
  }
  out.identity();
  for (let i = chain.length - 1; i >= 0; i--) {
    chain[i].updateMatrix();
    out.multiply(chain[i].matrix);
  }
  return out;
}

function hiddenChain(obj, root) {
  let o = obj;
  while (o && o !== root) {
    if (!o.visible || o.userData.noBake) return true;
    o = o.parent;
  }
  return false;
}

function cleanGeo(g) {
  if (g.index) g = g.toNonIndexed();
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal' && k !== 'uv') g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  return g;
}

/**
 * グループ内の静的メッシュをマテリアルごとに1メッシュへ統合する。
 * directOnly: 直下の子だけ（入れ子グループは触らない）
 */
export function bakeGroup(root, { directOnly = false } = {}) {
  const buckets = new Map();
  const cand = [];
  const visit = (o) => {
    for (const c of o.children) {
      if (c.isMesh) cand.push(c);
      else if (!directOnly && c.isGroup && !c.userData.noBake) visit(c);
      else if (!directOnly && c.isObject3D && !c.isSprite && !c.isPoints && !c.isLine && c.children.length && !c.userData.noBake && !c.isMesh) visit(c);
    }
  };
  visit(root);
  for (const m of cand) {
    if (m.userData.it || m.userData.noBake || m.userData.update || m.userData.redraw || m.name.startsWith('batch:') || m.userData.keep) continue;
    const mat = m.material;
    if (!mat || Array.isArray(mat) || mat.transparent || m.renderOrder !== 0 || m.isInstancedMesh || m.isSkinnedMesh) continue;
    if (hiddenChain(m, root)) continue;
    const key = `${mat.uuid}|${m.castShadow ? 1 : 0}${m.receiveShadow ? 1 : 0}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { mat, cast: m.castShadow, recv: m.receiveShadow, items: [] }));
    b.items.push(m);
  }
  let merged = 0;
  for (const b of buckets.values()) {
    if (b.items.length < 2) continue;
    const geos = [];
    for (const m of b.items) {
      const g = cleanGeo(m.geometry.clone());
      g.applyMatrix4(relMatrix(m, root, _tmpM));
      geos.push(g);
    }
    let mg;
    try {
      mg = mergeGeometries(geos, false);
    } catch (e) {
      continue;
    }
    if (!mg) continue;
    mg.computeBoundingSphere();
    mg.computeBoundingBox();
    const mesh = new THREE.Mesh(mg, b.mat);
    mesh.castShadow = b.cast;
    mesh.receiveShadow = b.recv;
    mesh.name = 'baked:' + (b.mat.name || '');
    root.add(mesh);
    for (const m of b.items) {
      m.parent.remove(m);
      m.geometry.dispose();
    }
    for (const g of geos) g.dispose();
    merged += b.items.length;
  }
  return merged;
}

/** 接地影・壁際AOなどのデカールを、テクスチャ種別×グループごとに1メッシュへ統合 */
export class DecalBatch {
  constructor(world) {
    this.w = world;
    this.items = []; // {group, kind, pos[], uv[], col[]}
    this.meshes = new Map();
  }

  _push(group, kind, verts, op) {
    this.items.push({ group, kind, verts, op });
  }

  /** 床の接地影。x0..x1, z0..z1 の周囲に pad ぶん広げる */
  floor(group, x0, z0, x1, z1, { pad = 0.1, op = 0.5, y = 0.004 } = {}) {
    const a = x0 - pad;
    const b = x1 + pad;
    const c = z0 - pad;
    const d = z1 + pad;
    this._push(group, 'box', [[a, y, d, 0, 0], [b, y, d, 1, 0], [b, y, c, 1, 1], [a, y, c, 0, 1]], op);
  }

  /** 壁際の勾配。w×h の矩形を中心(cx,cy,cz)に置き、rotZ→rotY の順に回す */
  wall(group, cx, cy, cz, w, h, rotY, rotZ, op) {
    const e = new THREE.Euler(0, rotY, rotZ, 'XYZ');
    const m = new THREE.Matrix4().makeRotationFromEuler(e);
    m.setPosition(cx, cy, cz);
    const pts = [
      [-w / 2, -h / 2, 0, 0, 0],
      [w / 2, -h / 2, 0, 1, 0],
      [w / 2, h / 2, 0, 1, 1],
      [-w / 2, h / 2, 0, 0, 1],
    ];
    const v = new THREE.Vector3();
    const out = pts.map((p) => {
      v.set(p[0], p[1], p[2]).applyMatrix4(m);
      return [v.x, v.y, v.z, p[3], p[4]];
    });
    this._push(group, 'edge', out, op);
  }

  flush(group) {
    const tex = { box: this.w.tex.boxShadow, edge: this.w.tex.edgeGrad };
    const buckets = new Map();
    const rest = [];
    for (const it of this.items) {
      if (group && it.group !== group) {
        rest.push(it);
        continue;
      }
      const key = it.group.uuid + '|' + it.kind;
      let b = buckets.get(key);
      if (!b) buckets.set(key, (b = { group: it.group, kind: it.kind, pos: [], uv: [], col: [] }));
      const v = it.verts;
      for (const i of [0, 1, 2, 0, 2, 3]) {
        b.pos.push(v[i][0], v[i][1], v[i][2]);
        b.uv.push(v[i][3], v[i][4]);
        b.col.push(0, 0, 0, it.op);
      }
    }
    this.items = rest;
    for (const b of buckets.values()) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(b.pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(b.uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(b.col, 4));
      const mat = new THREE.MeshBasicMaterial({
        map: tex[b.kind],
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        fog: true,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
      });
      const mesh = new THREE.Mesh(g, mat);
      mesh.renderOrder = 2;
      mesh.frustumCulled = false;
      mesh.name = 'decals';
      b.group.add(mesh);
    }
  }
}
