// ワールド全体：構築・更新・衝突・インタラクト管理
import * as THREE from 'three';
import { Batcher, DecalBatch } from '../builder.js';
import { MatLib, makeEnvironment, NP, NS } from '../gfx.js';
import { buildTextures, defineMaterials } from '../materials.js';
import * as T from '../tex.js';
import { Emitter, Door, Fixture, resolveCircle, segHitsBox } from './core.js';
import { installSignHelpers } from './signs.js';
import { buildShell, buildHall, DIM, CEIL } from './shell.js';
import { buildOutside } from './outside.js';
import { buildDust, updateDust } from './dust.js';
import { buildFurniture } from './furniture.js';
import { nextFrame, clamp, lerp } from '../util.js';

export class World extends Emitter {
  constructor(renderer, scene, tier) {
    super();
    this.renderer = renderer;
    this.scene = scene;
    this.tier = tier;
    this.root = new THREE.Group();
    this.root.name = 'world';
    scene.add(this.root);
    this.B = new Batcher();
    this.decals = new DecalBatch(this);
    this.colliders = this.B.colliders;
    this.doors = {};
    this.fixtures = [];
    this.picks = [];
    this.props = {};
    this.updaters = [];
    this.hallDz = 0;
    this.time = 0;
    this.points = [];
    this.spots = [];
    this.dyn = []; // 動的に更新するもの
  }

  collide(x0, z0, x1, z1, extra) {
    return this.B.collide(x0, z0, x1, z1, extra);
  }
  removeColliders(pred) {
    for (let i = this.colliders.length - 1; i >= 0; i--) if (pred(this.colliders[i])) this.colliders.splice(i, 1);
  }

  pickable(obj, cfg) {
    obj.userData.it = cfg;
    cfg.obj = obj;
    this.picks.push(obj);
    return obj;
  }

  async build(onProgress = () => {}) {
    const tier = this.tier;
    T.TEX.scale = tier.tex;
    T.TEX.aniso = tier.aniso;
    const textures = await buildTextures((p) => onProgress(p * 0.6));
    const env = makeEnvironment(this.renderer);
    this.env = env;
    this.tex = {
      glow: T.glowTex(),
      edgeGrad: T.edgeGradTex(),
      boxShadow: T.boxShadowTex(),
      softShadow: T.softShadowTex(),
      dust: T.dustTex(),
      fpL: T.footprintTex(true),
      fpR: T.footprintTex(false),
    };
    this.M = new MatLib(textures, env);
    defineMaterials(this.M);
    installSignHelpers(this);
    this.createLights();
    await nextFrame();

    buildShell(this);
    onProgress(0.7);
    await nextFrame();
    buildFurniture(this);
    onProgress(0.85);
    await nextFrame();
    buildOutside(this, tier.particles);
    if (tier.particles > 0.3) buildDust(this, tier.particles);
    // 最終フラッシュ（すべてのバッチ）
    this.B.flush();
    this.decals.flush();
    onProgress(1);
  }

  createLights() {
    const mk = (color, intensity) => {
      const l = new THREE.PointLight(color, intensity, 0, 2);
      l.castShadow = false;
      this.root.add(l);
      this.points.push(l);
      return l;
    };
    // 順序が ROOM_MASK のインデックスに対応
    this.lHall = mk(0xffe4c8, 0);
    this.lBed = mk(0xffb070, 0);
    this.lWet = mk(0xf4f8ff, 0);
    this.lCorA = mk(0xe6f2ff, 0);
    this.lCorB = mk(0xe6f2ff, 0);
    this.lHall.position.set(0, 2.2, 1.9);
    this.lBed.position.set(2.35, 2.2, 4.75);
    this.lWet.position.set(-1.85, 2.2, 2.35);

    const s0 = new THREE.SpotLight(0xe9f0ff, 0, 0, 1.5, 0.95, 2);
    s0.position.set(-1.35, 2.32, 5.9);
    s0.target.position.set(-1.35, 0, 5.9);
    this.root.add(s0, s0.target);
    if (this.tier.shadow > 0) {
      s0.castShadow = true;
      s0.shadow.mapSize.set(this.tier.shadow, this.tier.shadow);
      s0.shadow.bias = -0.0006;
      s0.shadow.normalBias = 0.025;
      s0.shadow.radius = 4;
      s0.shadow.camera.near = 0.3;
      s0.shadow.camera.far = 9;
    }
    this.lLDK = s0;
    const s1 = new THREE.SpotLight(0xfff4e0, 0, 14, 0.5, 0.6, 1.6);
    s1.castShadow = false;
    this.root.add(s1, s1.target);
    this.lFlash = s1;
    this.spots.push(s0, s1);
    // 固定ライトの定義（Fixture）
    const fx = (id, room, light, intensity, color, pos, extra = {}) => {
      const f = new Fixture(this, { id, room, light, intensity, color, pos, ...extra });
      this.fixtures.push(f);
      this.fx[id] = f;
      return f;
    };
    this.fx = {};
    fx('hall', 'hall', this.lHall, 4.4, 0xfff0dc, new THREE.Vector3(0, 2.3, 1.9), { hum: 0.35, humKind: 'led' });
    fx('ldk', 'ldk', s0, 19, 0xe9f0ff, new THREE.Vector3(-1.35, 2.35, 5.9), { hum: 0.55 });
    fx('bed', 'bed', this.lBed, 2.1, 0xffb070, new THREE.Vector3(2.35, 2.35, 4.75), { hum: 0.2, on: false, humKind: 'led' });
    fx('bath', 'bath', null, 3.4, 0xf4f8ff, new THREE.Vector3(-1.85, 2.3, 2.35), { hum: 0.3, humKind: 'fluor', on: false, shared: true });
  }

  /** 廊下の延長（奥エリアをずらす）*/
  setHallDz(dz) {
    this.hallDz = dz;
    buildHall(this, dz);
    this.groups.deep.position.z = dz;
    for (const c of this.colliders) {
      if (c.deep) {
        c.z0 = c.bz0 + dz;
        c.z1 = c.bz1 + dz;
      }
    }
    this.lBed.position.z = 4.75 + dz;
    this.lLDK.position.z = 5.9 + dz;
    this.lLDK.target.position.z = 5.9 + dz;
    this.fx.ldk.pos.z = 5.9 + dz;
    this.fx.bed.pos.z = 4.75 + dz;
    // 廊下の主灯は伸びた廊下の中ほどに寄せる（奥が暗くなる）
    this.emit('hallDz', dz);
  }

  /** 線分がコライダで遮られるか */
  occluded(a, b) {
    for (const c of this.colliders) {
      if (!c.on) continue;
      if (segHitsBox(a, b, c)) return true;
    }
    return false;
  }

  update(dt, time, player) {
    this.time = time;
    for (const d of Object.values(this.doors)) d.update(dt);
    for (const f of this.fixtures) f.update(dt, time);
    // 廊下ライトは最寄りの2灯に追従
    const px = player.x;
    const fs = this.corridorFixtures;
    if (fs) {
      let a = 0;
      let b = 1;
      let da = 1e9;
      let db = 1e9;
      for (let i = 0; i < fs.length; i++) {
        const d = Math.abs(fs[i].pos.x - px);
        if (d < da) {
          db = da;
          b = a;
          da = d;
          a = i;
        } else if (d < db) {
          db = d;
          b = i;
        }
      }
      const fa = fs[a];
      const fb = fs[b];
      for (const c of fs) for (const gl of c.glows) gl.sprite.visible = Math.abs(c.pos.x - px) < 9.5;
      this.lCorA.position.set(fa.pos.x, 2.25, -0.9);
      this.lCorB.position.set(fb.pos.x, 2.25, -0.9);
      this.lCorA.intensity = 3.6 * fa.f;
      this.lCorB.intensity = 3.6 * fb.f;
      this.lCorA.color.copy(fa.color);
      this.lCorB.color.copy(fb.color);
    }
    // 水回りの実ライトは、点灯している方（近い方）に載せ替える
    {
      const fb = this.fx.bath;
      const ft = this.fx.toilet;
      if (fb && ft) {
        const db = Math.hypot(player.x - -1.85, player.z - 2.35);
        const dt2 = Math.hypot(player.x - 1.55, player.z - 1.97);
        const useBath = fb.f > 0.02 && (ft.f <= 0.02 || db < dt2);
        const f = useBath ? fb : ft;
        const act = useBath ? fb : ft.f > 0.02 ? ft : fb;
        this.lWet.position.copy(act.pos).setY(2.2);
        this.lWet.intensity = 3.4 * Math.max(fb.f, ft.f);
      }
    }
    // 間接光の近似（部屋ごとの照明レベルに連動）
    {
      const f = this.fx;
      const cor = this.corridorFixtures ? this.corridorFixtures.reduce((a, c) => a + c.f, 0) / this.corridorFixtures.length : 0;
      const lv = { hall: f.hall.f, genkan: f.hall.f, ldk: f.ldk.f, bed: f.bed.f, bath: f.bath.f, toilet: f.toilet.f, cor: Math.min(1, cor * 1.6), out: 0 };
      for (const m of this.M.bounceMats) m.emissiveIntensity = m.userData.bounce * (lv[m.userData.room] ?? 0);
      if (this.props.ldkGlass) {
        const k = lv.ldk;
        this.props.ldkGlass.color.setRGB(0.03 + k * 0.85, 0.032 + k * 0.9, 0.04 + k * 1.0);
      }
    }
    if (this.dustSets) {
      const f = this.fx;
      const cor = this.corridorFixtures.reduce((a, c) => a + c.f, 0) / this.corridorFixtures.length;
      updateDust(this, dt, player.zone || 'cor', { cor, hall: f.hall.f, ldk: Math.max(f.ldk.f, f.bed.f) });
    }
    for (const u of this.updaters) u(dt, time, player);
  }

  /** 走査用：ワールドのレイキャスト（インタラクト候補）*/
  collidersFor() {
    return this.colliders;
  }
}
