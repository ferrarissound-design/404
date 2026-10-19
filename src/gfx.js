// 描画基盤：レンダラ・ポストFX・ルーム別ライトマスク付きマテリアル
import * as THREE from 'three';
import { clamp } from './util.js';

// ---------------------------------------------------------------- 画質プリセット
export const TIERS = {
  high: { name: 'high', dpr: 2, msaa: 4, shadow: 1024, bloom: true, bloomScale: 0.25, particles: 1, aniso: 8, tex: 1 },
  mid: { name: 'mid', dpr: 1.5, msaa: 2, shadow: 512, bloom: true, bloomScale: 0.2, particles: 0.6, aniso: 4, tex: 1 },
  low: { name: 'low', dpr: 1, msaa: 0, shadow: 0, bloom: false, bloomScale: 0.2, particles: 0.25, aniso: 2, tex: 0.5 },
};

// ---------------------------------------------------------------- ライト索引
// ポイントライト: 0=廊下/玄関 1=寝室 2=水回り 3,4=共用廊下(追従)
// スポット: 0=LDK(影あり) 1=スマホライト
export const NP = 5;
export const NS = 2;

const Z = [0, 0, 0, 0, 0];
/** 部屋 → ライトマスク [point(5), spot(2)] */
export const ROOM_MASK = {
  cor: { p: [0, 0, 0, 1, 1], s: [0, 1] },
  genkan: { p: [1, 0, 0, 0.0, 0.0], s: [0.0, 1] },
  hall: { p: [1, 0, 0, 0, 0], s: [0.1, 1] },
  bath: { p: [0.06, 0, 1, 0, 0], s: [0, 1] },
  toilet: { p: [0.06, 0, 1, 0, 0], s: [0, 1] },
  ldk: { p: [0.14, 0.04, 0, 0, 0], s: [1, 1] },
  bed: { p: [0.05, 1, 0, 0, 0], s: [0.1, 1] },
  out: { p: Z, s: [0, 1] },
};

// ---------------------------------------------------------------- マテリアル
function patchMaterial(mat, mask) {
  mat.userData.maskP = new Float32Array(8);
  mat.userData.maskS = new Float32Array(4);
  mat.userData.maskP.set(mask.p);
  mat.userData.maskS.set(mask.s);
  mat.customProgramCacheKey = () => 'roomMask-v1';
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uMaskP = { value: mat.userData.maskP };
    shader.uniforms.uMaskS = { value: mat.userData.maskS };
    let chunk = THREE.ShaderChunk.lights_fragment_begin;
    chunk = chunk.replace(
      'getPointLightInfo( pointLight, geometryPosition, directLight );',
      'getPointLightInfo( pointLight, geometryPosition, directLight );\n directLight.color *= uMaskP[ i ];'
    );
    chunk = chunk.replace(
      'getSpotLightInfo( spotLight, geometryPosition, directLight );',
      'getSpotLightInfo( spotLight, geometryPosition, directLight );\n directLight.color *= uMaskS[ i ];'
    );
    shader.fragmentShader = 'uniform float uMaskP[8];\nuniform float uMaskS[4];\n' + shader.fragmentShader.replace('#include <lights_fragment_begin>', chunk);
  };
}

export function setMaterialMask(mat, mask) {
  if (!mat.userData.maskP) return;
  mat.userData.maskP.fill(0);
  mat.userData.maskS.fill(0);
  mat.userData.maskP.set(mask.p);
  mat.userData.maskS.set(mask.s);
}

/**
 * マテリアルライブラリ。get(name, room) で部屋別インスタンスを返す。
 * defs[name] = { type, params, tex: 'key' }
 */
export class MatLib {
  constructor(textures, envMap) {
    this.t = textures;
    this.env = envMap;
    this.cache = new Map();
    this.all = [];
    this.bounceMats = [];
    this.defs = {};
  }

  define(name, def) {
    this.defs[name] = def;
  }

  /** 低スペック端末向け：バンプ/発光マップを外してフラグメント負荷を下げる（切替時に1回だけ再コンパイル）*/
  setLowSpec(low) {
    if (this.low === low) return;
    this.low = low;
    for (const m of this.all) {
      if (!m.isMeshStandardMaterial) continue;
      if (low) {
        if (m.bumpMap) {
          m.userData.bumpMap = m.bumpMap;
          m.bumpMap = null;
        }
        if (m.emissiveMap) {
          m.userData.emissiveMap = m.emissiveMap;
          m.emissiveMap = null;
          m.emissive.setScalar(0.55);
        }
      } else {
        if (m.userData.bumpMap) m.bumpMap = m.userData.bumpMap;
        if (m.userData.emissiveMap) {
          m.emissiveMap = m.userData.emissiveMap;
          m.emissive.setScalar(1);
        }
      }
      m.needsUpdate = true;
    }
  }

  /** 任意パラメータのライト付きマテリアル（部屋マスク適用）*/
  custom(params, room = 'hall', envIntensity) {
    // 同一パラメータのマテリアルは共有してドローコールを減らす
    const key = JSON.stringify([params, room, envIntensity], (k, v) => (v && v.isTexture ? 't:' + v.uuid : v));
    this._customCache ||= new Map();
    const hit = this._customCache.get(key);
    if (hit) return hit;
    const m = new THREE.MeshStandardMaterial(params);
    this._customCache.set(key, m);
    if (envIntensity !== undefined && this.env) {
      m.envMap = this.env;
      m.envMapIntensity = envIntensity;
    }
    patchMaterial(m, ROOM_MASK[room] || ROOM_MASK.hall);
    m.userData.room = room;
    m.userData.tile = 1;
    this.all.push(m);
    return m;
  }

  get(name, room = 'hall') {
    const key = name + '@' + room;
    let m = this.cache.get(key);
    if (m) return m;
    const d = this.defs[name];
    if (!d) throw new Error('unknown material ' + name);
    const p = { ...(d.params || {}) };
    if (d.map) {
      const set = this.t[d.map];
      if (set) {
        p.map = set.map;
        if (set.rough && d.useRough !== false) p.roughnessMap = set.rough;
        if (set.bump && d.useBump !== false) {
          p.bumpMap = set.bump;
          p.bumpScale = d.bumpScale ?? 1.2;
        }
      }
    }
    if (d.basic) {
      m = new THREE.MeshBasicMaterial(p);
    } else {
      m = new THREE.MeshStandardMaterial(p);
      if (d.env !== undefined && this.env) {
        m.envMap = this.env;
        m.envMapIntensity = d.env;
      }
      patchMaterial(m, ROOM_MASK[room] || ROOM_MASK.hall);
      if (d.bounce && p.map) {
        // 間接光の近似：アルベドに比例した微弱な自己発光を、部屋の照明状態に連動させる
        m.emissive = new THREE.Color(1, 1, 1);
        m.emissiveMap = p.map;
        m.emissiveIntensity = 0;
        m.userData.bounce = d.bounce;
        this.bounceMats.push(m);
      }
    }
    m.name = key;
    m.userData.room = room;
    m.userData.tile = d.tile || 1;
    this.cache.set(key, m);
    this.all.push(m);
    return m;
  }
}

// ---------------------------------------------------------------- 環境マップ（反射用）
export function makeEnvironment(renderer) {
  const pm = new THREE.PMREMGenerator(renderer);
  const s = new THREE.Scene();
  const room = new THREE.Mesh(
    new THREE.BoxGeometry(10, 5, 10),
    new THREE.MeshBasicMaterial({ color: 0x6f6a62, side: THREE.BackSide })
  );
  s.add(room);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(10, 10), new THREE.MeshBasicMaterial({ color: 0x3a2c22 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.49;
  s.add(floor);
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 3.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 9.2, 9.6) }));
  panel.rotation.x = Math.PI / 2;
  panel.position.y = 2.45;
  s.add(panel);
  const win = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 1.3, 2.2) }));
  win.position.set(0, 0.2, -4.95);
  s.add(win);
  const warm = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.4, 1.0) }));
  warm.position.set(4.95, 0.3, 1.5);
  warm.rotation.y = -Math.PI / 2;
  s.add(warm);
  const tex = pm.fromScene(s, 0.03).texture;
  pm.dispose();
  s.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) o.material.dispose();
  });
  return tex;
}

// ---------------------------------------------------------------- ポスト処理
const VERT = /* glsl */ `
varying vec2 vUv;
void main(){
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}`;

const FRAG_BRIGHT = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uTexel;
uniform float uThr;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv + uTexel*vec2(-1.0,-1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel*vec2( 1.0,-1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel*vec2(-1.0, 1.0)).rgb;
  c += texture2D(tSrc, vUv + uTexel*vec2( 1.0, 1.0)).rgb;
  c *= 0.25;
  float l = max(c.r, max(c.g, c.b));
  float k = max(l - uThr, 0.0) / max(l, 1e-4);
  gl_FragColor = vec4(min(c * k, vec3(8.0)), 1.0);
}`;

const FRAG_BLUR = /* glsl */ `
precision highp float;
uniform sampler2D tSrc;
uniform vec2 uDir;
varying vec2 vUv;
void main(){
  vec3 c = texture2D(tSrc, vUv).rgb * 0.2270270270;
  c += texture2D(tSrc, vUv + uDir*1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv - uDir*1.3846153846).rgb * 0.3162162162;
  c += texture2D(tSrc, vUv + uDir*3.2307692308).rgb * 0.0702702703;
  c += texture2D(tSrc, vUv - uDir*3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(c, 1.0);
}`;

const FRAG_FINAL = /* glsl */ `
precision highp float;
uniform sampler2D tScene;
uniform sampler2D tBloom;
uniform vec2 uRes;
uniform float uTime;
uniform float uExposure;
uniform float uBloom;
uniform float uVig;
uniform float uGrain;
uniform float uCA;
uniform float uDistort;
uniform float uSat;
uniform float uFade;
uniform float uMode;
uniform float uWarp;
uniform float uFlash;
uniform vec3 uFadeColor;
varying vec2 vUv;

float hash(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec3 aces(vec3 x){
  const float a = 2.51; const float b = 0.03; const float c = 2.43; const float d = 0.59; const float e = 0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){
  return mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
}
void main(){
  vec2 uv = vUv;
  vec2 cc = uv - 0.5;
  float aspect = uRes.x / uRes.y;
  vec2 ca = vec2(cc.x * aspect, cc.y);
  float r2 = dot(ca, ca);

  float dist = uDistort;
  float circle = 1.0;
  if (uMode > 1.5) { dist = 1.6; }
  else if (uMode > 0.5) { dist = 0.55; }
  uv = 0.5 + cc * (1.0 + dist * r2);
  if (uWarp > 0.0) {
    uv.x += sin(uv.y * 14.0 + uTime * 1.7) * 0.0035 * uWarp;
    uv.y += sin(uv.x * 11.0 + uTime * 1.3) * 0.0025 * uWarp;
  }
  if (uMode > 1.5) {
    circle = 1.0 - smoothstep(0.34, 0.37, sqrt(r2));
  }

  vec2 off = cc * uCA * (0.6 + 2.0 * r2);
  vec3 col;
  col.r = texture2D(tScene, uv + off).r;
  col.g = texture2D(tScene, uv).g;
  col.b = texture2D(tScene, uv - off).b;
  vec3 bl = texture2D(tBloom, uv).rgb;
  col += bl * uBloom;

  col *= uExposure;
  col = aces(col);

  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));
  // スプリットトーン：影は冷たく、光は温かく
  col *= mix(vec3(0.93, 1.0, 1.07), vec3(1.04, 1.0, 0.95), smoothstep(0.1, 0.7, lum));
  col = mix(vec3(lum), col, uSat);

  if (uMode > 0.5) {
    float g = dot(col, vec3(0.3, 0.59, 0.11));
    float scan = 0.88 + 0.12 * sin(vUv.y * uRes.y * 1.6 + uTime * 6.0);
    float n = hash(vUv * uRes + uTime) * 0.18;
    col = vec3(0.35, 1.0, 0.55) * (g * 1.35 + n) * scan;
    if (uMode < 1.5) col *= 0.85 + 0.15 * sin(uTime * 40.0);
  }

  // ビネット
  float vg = smoothstep(0.95, 0.25, sqrt(r2) * (0.9 + uVig * 0.5));
  col *= mix(1.0, vg, clamp(uVig, 0.0, 1.0));

  col = toSRGB(col);

  // フィルムグレイン（暗部ほど強く）+ TPDFディザ
  float gn = hash(vUv * uRes + fract(uTime) * 91.7) - 0.5;
  col += gn * uGrain * (0.45 + 0.55 * (1.0 - lum));
  float d = hash(vUv * uRes + 17.3 + fract(uTime * 1.31) * 53.0) + hash(vUv * uRes * 1.37 + fract(uTime) * 29.0) - 1.0;
  col += d / 255.0;

  col += uFlash;
  col = mix(col, uFadeColor, uFade);
  col *= circle;
  gl_FragColor = vec4(col, 1.0);
}`;

class Pass {
  constructor(frag, uniforms) {
    this.mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: frag,
      uniforms,
      depthTest: false,
      depthWrite: false,
    });
    this.mat.toneMapped = false;
  }
}

export class Post {
  constructor(renderer, tier) {
    this.r = renderer;
    this.tier = tier;
    const gl = renderer.getContext();
    this.hdr = !!(renderer.extensions.has('EXT_color_buffer_float') || renderer.extensions.has('EXT_color_buffer_half_float'));
    this.rtType = this.hdr ? THREE.HalfFloatType : THREE.UnsignedByteType;

    // フルスクリーン三角形
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array([0, 0, 2, 0, 0, 2]), 2));
    this.tri = new THREE.Mesh(g, null);
    this.tri.frustumCulled = false;
    this.cam = new THREE.Camera();
    this.scene = new THREE.Scene();
    this.scene.add(this.tri);

    this.uni = {
      tScene: { value: null },
      tBloom: { value: null },
      uRes: { value: new THREE.Vector2(1, 1) },
      uTime: { value: 0 },
      uExposure: { value: 1 },
      uBloom: { value: 0.35 },
      uVig: { value: 0.55 },
      uGrain: { value: 0.045 },
      uCA: { value: 0.0015 },
      uDistort: { value: 0.0 },
      uSat: { value: 0.92 },
      uFade: { value: 0 },
      uMode: { value: 0 },
      uWarp: { value: 0 },
      uFlash: { value: 0 },
      uFadeColor: { value: new THREE.Color(0, 0, 0) },
    };
    this.final = new Pass(FRAG_FINAL, this.uni);
    this.bright = new Pass(FRAG_BRIGHT, {
      tSrc: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uThr: { value: 1.0 },
    });
    this.blur = new Pass(FRAG_BLUR, { tSrc: { value: null }, uDir: { value: new THREE.Vector2() } });
    this.rt = null;
    this.bA = null;
    this.bB = null;
    this.blank = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1);
    this.blank.needsUpdate = true;
    this.w = 2;
    this.h = 2;
  }

  setTier(tier) {
    this.tier = tier;
    if (this.w > 2) this.resize(this.w, this.h);
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    this.uni.uRes.value.set(w, h);
    if (this.rt) this.rt.dispose();
    this.rt = this._makeRT(w, h);
    if (this.bA) this.bA.dispose();
    if (this.bB) this.bB.dispose();
    this.bA = this.bB = null;
    if (this.tier.bloom) {
      const bw = Math.max(32, Math.floor(w * this.tier.bloomScale));
      const bh = Math.max(32, Math.floor(h * this.tier.bloomScale));
      const opt = { type: this.rtType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, generateMipmaps: false };
      this.bA = new THREE.WebGLRenderTarget(bw, bh, opt);
      this.bB = new THREE.WebGLRenderTarget(bw, bh, opt);
    }
  }

  /** MSAA/HDR の組み合わせが端末で使えるか検証しながらレンダーターゲットを作る */
  _makeRT(w, h) {
    const gl = this.r.getContext();
    const mk = (type, samples) => {
      const rt = new THREE.WebGLRenderTarget(w, h, {
        type,
        format: THREE.RGBAFormat,
        depthBuffer: true,
        stencilBuffer: false,
        samples,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        generateMipmaps: false,
      });
      rt.texture.colorSpace = THREE.LinearSRGBColorSpace;
      return rt;
    };
    let samples = this.tier.msaa;
    if (samples > 0 && this.rtType === THREE.HalfFloatType) {
      try {
        const s = gl.getInternalformatParameter(gl.RENDERBUFFER, gl.RGBA16F, gl.SAMPLES);
        if (!s || !s.length) samples = 0;
        else samples = Math.min(samples, s[0]);
      } catch (e) {
        samples = 0;
      }
    }
    const tries = [[this.rtType, samples]];
    if (samples > 0) tries.push([this.rtType, 0]);
    if (this.rtType !== THREE.UnsignedByteType) tries.push([THREE.UnsignedByteType, 0]);
    let last = null;
    for (const [type, sm] of tries) {
      const rt = mk(type, sm);
      // 実際にバインドして完全性を確認
      this.r.setRenderTarget(rt);
      const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
      this.r.setRenderTarget(null);
      if (st === gl.FRAMEBUFFER_COMPLETE) {
        this.rtType = type;
        this.activeSamples = sm;
        return rt;
      }
      rt.dispose();
      last = rt;
    }
    this.rtType = THREE.UnsignedByteType;
    this.activeSamples = 0;
    return mk(THREE.UnsignedByteType, 0);
  }

  _draw(mat, target) {
    this.tri.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.scene, this.cam);
  }

  render(scene, camera, time) {
    const r = this.r;
    this.uni.uTime.value = time;
    r.setRenderTarget(this.rt);
    r.render(scene, camera);
    let bloomTex = this.blank;
    if (this.bA && this.uni.uBloom.value > 0.001) {
      const b = this.bright.mat.uniforms;
      b.tSrc.value = this.rt.texture;
      b.uTexel.value.set(1 / this.w, 1 / this.h);
      b.uThr.value = 1.15;
      this._draw(this.bright.mat, this.bA);
      const u = this.blur.mat.uniforms;
      u.tSrc.value = this.bA.texture;
      u.uDir.value.set(1 / this.bA.width, 0);
      this._draw(this.blur.mat, this.bB);
      u.tSrc.value = this.bB.texture;
      u.uDir.value.set(0, 1 / this.bA.height);
      this._draw(this.blur.mat, this.bA);
      u.tSrc.value = this.bA.texture;
      u.uDir.value.set(1.5 / this.bA.width, 0);
      this._draw(this.blur.mat, this.bB);
      u.tSrc.value = this.bB.texture;
      u.uDir.value.set(0, 1.5 / this.bA.height);
      this._draw(this.blur.mat, this.bA);
      bloomTex = this.bA.texture;
    }
    this.uni.tScene.value = this.rt.texture;
    this.uni.tBloom.value = bloomTex;
    this._draw(this.final.mat, null);
  }

  dispose() {
    this.rt?.dispose();
    this.bA?.dispose();
    this.bB?.dispose();
  }
}

// ---------------------------------------------------------------- レンダラ生成
export function createRenderer(canvas) {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance',
    stencil: false,
    preserveDrawingBuffer: false,
  });
  renderer.setClearColor(0x000000, 1);
  renderer.info.autoReset = false;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.NoToneMapping;
  return renderer;
}

/** 画面アスペクトに応じた縦FOV（横FOVを約96°に保つ）*/
export function fovFor(aspect) {
  const hf = (96 * Math.PI) / 180;
  const vf = 2 * Math.atan(Math.tan(hf / 2) / Math.max(aspect, 0.5));
  return clamp((vf * 180) / Math.PI, 52, 74);
}
