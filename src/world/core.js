// ワールド基盤：ドア・照明器具・インタラクト登録・衝突
import * as THREE from 'three';
import { clamp, lerp, easeInOut, rand, damp } from '../util.js';
import { setMaterialMask, ROOM_MASK } from '../gfx.js';

export class Emitter {
  constructor() {
    this.h = {};
  }
  on(ev, fn) {
    (this.h[ev] ||= []).push(fn);
    return () => this.off(ev, fn);
  }
  off(ev, fn) {
    this.h[ev] = (this.h[ev] || []).filter((f) => f !== fn);
  }
  emit(ev, data) {
    for (const f of this.h[ev] || []) f(data);
  }
}

/** ヒンジドア */
export class Door {
  constructor(world, cfg) {
    this.w = world;
    this.id = cfg.id;
    this.pivot = cfg.pivot; // THREE.Group（ヒンジ位置）
    this.closedAngle = cfg.closedAngle ?? 0;
    this.openAngle = cfg.openAngle ?? Math.PI / 2;
    this.t = cfg.open ? 1 : 0; // 0..1
    this.target = this.t;
    this.speed = cfg.speed ?? 1.6; // 秒^-1
    this.locked = !!cfg.locked;
    this.collider = cfg.collider || null; // 閉時のみ有効
    this.pos = cfg.pos || new THREE.Vector3(); // 音の位置
    this.sound = cfg.sound || 'door';
    this.auto = cfg.autoClose || 0; // 自動で閉まるまでの秒（0なら無効）
    this.autoTimer = 0;
    this.ajar = cfg.ajar ?? this.openAngle;
    this._lastT = this.t;
    this.apply();
  }
  get isOpen() {
    return this.target > 0.5;
  }
  worldPos() {
    return { x: this.pos.x, y: this.pos.y, z: this.pos.z + (this.deep ? this.w.hallDz : 0) };
  }
  open(amount = 1, speed) {
    this.target = amount;
    if (speed) this.speed = speed;
    this.autoTimer = 0;
  }
  close(speed) {
    this.target = 0;
    if (speed) this.speed = speed;
  }
  toggle() {
    if (this.target > 0.05) this.close();
    else this.open(1);
  }
  setInstant(t) {
    this.t = this.target = t;
    this.apply();
  }
  apply() {
    const e = easeInOut(clamp(this.t, 0, 1));
    this.pivot.rotation.y = lerp(this.closedAngle, this.openAngle, e);
    if (this.collider) this.collider.on = this.t < 0.25;
  }
  update(dt) {
    if (Math.abs(this.t - this.target) > 1e-4) {
      const dir = Math.sign(this.target - this.t);
      this.t += dir * this.speed * dt;
      if ((dir > 0 && this.t > this.target) || (dir < 0 && this.t < this.target)) this.t = this.target;
      this.apply();
      // 開閉開始/完了イベント
      if (this._lastT === 0 && this.t > 0) this.w.emit('door', { id: this.id, kind: 'open', pos: this.worldPos(), sound: this.sound });
      if (this.t === 0 && this._lastT > 0) this.w.emit('door', { id: this.id, kind: 'shut', pos: this.worldPos(), sound: this.sound });
      this._lastT = this.t;
    }
  }
}

/**
 * 照明器具：実ライト + 発光メッシュ + グロー + 点滅
 */
export class Fixture {
  constructor(world, cfg) {
    this.w = world;
    this.id = cfg.id;
    this.room = cfg.room;
    this.light = cfg.light || null; // THREE.PointLight / SpotLight（共有の場合あり）
    this.base = cfg.intensity ?? 1;
    this.color = new THREE.Color(cfg.color ?? 0xffffff);
    this.emissives = []; // {mat, scale}
    this.glows = []; // sprites
    this.on = cfg.on ?? true;
    this.level = this.on ? 1 : 0; // 0..1 スイッチ状態に追従
    this.dim = 1; // 外部からの調光
    this.flicker = 0; // 残り秒
    this.flickerAmt = 0.9;
    this.dying = 0; // 0..1 弱ったまま
    this.f = 1; // 現在の係数
    this.pos = cfg.pos || new THREE.Vector3();
    this.hum = cfg.hum ?? 0.5; // 音の大きさ
    this.humKind = cfg.humKind || 'fluor';
    this.group = cfg.group || null; // 同じスイッチで連動
    this.seed = Math.random() * 100;
    this.shared = !!cfg.shared;
  }
  addEmissive(mat, scale = 3) {
    mat.userData.baseColor = mat.color.clone();
    this.emissives.push({ mat, scale });
  }
  addGlow(sprite, scale = 1) {
    sprite.userData.baseOpacity = sprite.material.opacity;
    this.glows.push({ sprite, scale });
  }
  setOn(v) {
    this.on = v;
    this.w.emit('switch', { id: this.id, on: v, pos: this.pos });
  }
  burst(sec = 0.8, amt = 0.9) {
    if (this.w.reduceFlicker) {
      sec = Math.min(sec, 0.9);
      amt = Math.min(amt, 0.3);
    }
    this.flicker = Math.max(this.flicker, sec);
    this.flickerAmt = amt;
  }
  update(dt, time) {
    this.level = damp(this.level, this.on ? 1 : 0, this.on ? 40 : 60, dt);
    let f = 1;
    if (this.flicker > 0) {
      this.flicker -= dt;
      // 乱数列でON/OFF
      if (this.w.reduceFlicker) {
        // 光感受性への配慮：ゆっくりした明滅のみ（急な点滅を避ける）
        f = 1 - this.flickerAmt * (0.5 + 0.5 * Math.sin(time * 5 + this.seed));
      } else {
        const k = Math.sin(time * 91.3 + this.seed) * Math.sin(time * 37.1 + this.seed * 2.3) + Math.sin(time * 173.0);
        f = k > 0.25 ? 1 : lerp(1 - this.flickerAmt, 1, Math.random() * 0.4);
      }
    }
    if (this.dying > 0) f *= 1 - this.dying * (0.5 + 0.5 * Math.sin(time * 3.1 + this.seed) * Math.sin(time * 7.7));
    this.f = f * this.level * this.dim;
    for (const e of this.emissives) {
      const c = e.mat.userData.baseColor;
      const k = this.f * e.scale + 0.02;
      e.mat.color.setRGB(c.r * k, c.g * k, c.b * k);
    }
    for (const g of this.glows) g.sprite.material.opacity = g.sprite.userData.baseOpacity * this.f * g.scale;
    if (this.light && !this.shared) this.light.intensity = this.base * this.f;
  }
}

export function glowSprite(tex, color, size, opacity = 0.5) {
  const m = new THREE.SpriteMaterial({ map: tex, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: true });
  const s = new THREE.Sprite(m);
  s.scale.set(size, size, 1);
  return s;
}

/** AABB と円の押し出し */
export function resolveCircle(pos, r, colliders, y = 1.0) {
  for (let it = 0; it < 3; it++) {
    let hit = false;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (!c.on) continue;
      if (c.y1 !== undefined && (y > c.y1 || y < (c.y0 ?? -1))) continue;
      const cx = clamp(pos.x, c.x0, c.x1);
      const cz = clamp(pos.z, c.z0, c.z1);
      let dx = pos.x - cx;
      let dz = pos.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 < r * r) {
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          pos.x = cx + (dx / d) * r;
          pos.z = cz + (dz / d) * r;
        } else {
          // 中心がAABB内：最短脱出
          const l = pos.x - c.x0;
          const rr = c.x1 - pos.x;
          const t = pos.z - c.z0;
          const b = c.z1 - pos.z;
          const m = Math.min(l, rr, t, b);
          if (m === l) pos.x = c.x0 - r;
          else if (m === rr) pos.x = c.x1 + r;
          else if (m === t) pos.z = c.z0 - r;
          else pos.z = c.z1 + r;
        }
        hit = true;
      }
    }
    if (!hit) break;
  }
}

/** 線分(3D)とAABBの交差（遮蔽判定）*/
export function segHitsBox(o, p, c) {
  const y0 = c.y0 ?? 0;
  const y1 = c.y1 ?? 2.6;
  let tmin = 0;
  let tmax = 1;
  const d = [p.x - o.x, p.y - o.y, p.z - o.z];
  const org = [o.x, o.y, o.z];
  const lo = [c.x0, y0, c.z0];
  const hi = [c.x1, y1, c.z1];
  for (let i = 0; i < 3; i++) {
    if (Math.abs(d[i]) < 1e-9) {
      if (org[i] < lo[i] || org[i] > hi[i]) return false;
    } else {
      let t1 = (lo[i] - org[i]) / d[i];
      let t2 = (hi[i] - org[i]) / d[i];
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return false;
    }
  }
  return true;
}
