// プレイヤー（一人称）：移動・衝突・視点・歩行揺れ・足音
import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep, angleDiff } from './util.js';
import { resolveCircle } from './world/core.js';

export const EYE = 1.55;
export const RADIUS = 0.23;

/** 地面の高さ（玄関の段差）*/
export function groundAt(x, z) {
  if (Math.abs(x) > 1.0) return 0;
  if (z < 0.0) return 0;
  // 玄関ドアの敷居 → 土間へ降りる
  const down = smoothstep(0.02, 0.3, z);
  // 上がり框
  const up = smoothstep(1.3, 1.55, z);
  const y = -0.12 * down * (1 - up);
  return y;
}

export function surfaceAt(x, z) {
  if (z < 0.05) return 'concrete';
  if (x > -2.7 && x < -1.0 && z > 1.4 && z < 3.3) return 'tile';
  if (x > 1.0 && x < 2.1 && z > 1.4 && z < 2.6) return 'wood';
  if (Math.abs(x) <= 1.0 && z < 1.35) return 'tile';
  if (x > -1.9 && x < 0.15 && z > 6.0) return 'rug';
  return 'wood';
}

export class Player {
  constructor(camera) {
    this.camera = camera;
    this.pos = new THREE.Vector3(0, 0, -0.9);
    this.yaw = Math.PI;
    this.pitch = 0;
    this.vel = new THREE.Vector2();
    this.eyeY = EYE;
    this.bobPhase = 0;
    this.stride = 0;
    this.speed = 0;
    this.frozen = false;
    this.onStep = null;
    this.sway = 0; // 緊張時の微揺れ
    this.roll = 0;
    this.targetFov = 70;
    this.lookTween = null;
    this.zoom = 0;
    this._stepSide = 1;
    this.lastYaw = this.yaw;
    this.turnRate = 0;
  }

  teleport(x, z, yaw, pitch = 0) {
    this.pos.set(x, groundAt(x, z), z);
    this.yaw = yaw;
    this.pitch = pitch;
    this.vel.set(0, 0);
    this.eyeY = this.pos.y + EYE;
  }

  /** 一定時間かけて視線を向ける（演出用・短く控えめに）*/
  lookAtPoint(x, y, z, dur = 0.8) {
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    const ty = Math.atan2(-dx, -dz);
    const dist = Math.hypot(dx, dz);
    const tp = Math.atan2(y - (this.pos.y + EYE), dist);
    this.lookTween = { t: 0, dur, y0: this.yaw, dy: angleDiff(this.yaw, ty), p0: this.pitch, p1: clamp(tp, -1, 1) };
  }

  update(dt, inp, world, tension = 0) {
    // 視点
    if (this.lookTween) {
      const lt = this.lookTween;
      lt.t += dt;
      const k = smoothstep(0, 1, lt.t / lt.dur);
      this.yaw = lt.y0 + lt.dy * k;
      this.pitch = lerp(lt.p0, lt.p1, k);
      if (lt.t >= lt.dur) this.lookTween = null;
      // 入力があれば中断
      if (Math.abs(inp.lx) + Math.abs(inp.ly) > 0.02) this.lookTween = null;
    }
    if (!this.frozen) {
      this.yaw -= inp.lx;
      this.pitch = clamp(this.pitch - inp.ly, -1.25, 1.25);
    }
    this.turnRate = damp(this.turnRate, Math.abs(angleDiff(this.lastYaw, this.yaw)) / Math.max(dt, 1e-3), 8, dt);
    this.lastYaw = this.yaw;

    // 移動
    let mx = 0;
    let my = 0;
    if (!this.frozen) {
      mx = inp.mx;
      my = inp.my;
    }
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);
    const fwd = -my; // 前進が正
    const maxSp = (inp.run ? 2.35 : 1.5) * (this.speedMul ?? 1);
    const tx = (-sinY * fwd + cosY * mx) * maxSp;
    const tz = (-cosY * fwd - sinY * mx) * maxSp;
    this.vel.x = damp(this.vel.x, tx, 14, dt);
    this.vel.y = damp(this.vel.y, tz, 14, dt);
    const px = this.pos.x;
    const pz = this.pos.z;
    this.pos.x += this.vel.x * dt;
    this.pos.z += this.vel.y * dt;
    resolveCircle(this.pos, RADIUS, world.colliders, 1.0);
    // 実際に動いた距離
    const moved = Math.hypot(this.pos.x - px, this.pos.z - pz);
    this.speed = moved / Math.max(dt, 1e-4);

    // 歩行の揺れと足音
    this.stride += moved;
    const stepLen = inp.run ? 0.95 : 0.68;
    if (this.stride >= stepLen) {
      this.stride -= stepLen;
      this._stepSide *= -1;
      this.onStep?.(surfaceAt(this.pos.x, this.pos.z), clamp(this.speed / 1.5, 0.4, 1.3), this._stepSide);
    }
    const mov = clamp(this.speed / 1.5, 0, 1.4);
    this.bobPhase += moved * 4.2;
    const bob = Math.sin(this.bobPhase) * 0.018 * mov;
    const bobX = Math.cos(this.bobPhase * 0.5) * 0.012 * mov;

    // 地面の高さ
    const gy = groundAt(this.pos.x, this.pos.z);
    this.pos.y = damp(this.pos.y, gy, 16, dt);

    // 呼吸・緊張による揺れ
    const t = performance.now() * 0.001;
    const breathe = Math.sin(t * 1.3) * 0.0035 * (1 + tension);
    this.eyeY = this.pos.y + EYE + bob + breathe;
    this.roll = damp(this.roll, -mx * 0.012 + Math.sin(t * 0.7) * 0.002 * tension, 6, dt);
  }

  applyCamera() {
    const c = this.camera;
    c.position.set(this.pos.x + Math.cos(this.yaw) * Math.cos(this.bobPhase * 0.5) * 0.012 * clamp(this.speed / 1.5, 0, 1.4), this.eyeY, this.pos.z);
    c.rotation.set(this.pitch, this.yaw, this.roll, 'YXZ');
  }

  get forward() {
    return new THREE.Vector3(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }
}
