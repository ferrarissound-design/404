// 音響エンジン：Web Audio による全合成（外部音源なし＝権利問題なし）
// 空間音響（パンナー）・遮蔽（ローパス）・残響（合成IR）・環境音ループ・怪異SE
import { clamp, lerp, rand, damp } from './util.js';

const AC = window.AudioContext || window.webkitAudioContext;

function setPos(node, x, y, z) {
  if (node.positionX) {
    node.positionX.value = x;
    node.positionY.value = y;
    node.positionZ.value = z;
  } else if (node.setPosition) node.setPosition(x, y, z);
}

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.vol = { master: 0.8, amb: 1, sfx: 1 };
    this.listener = { x: 0, y: 1.5, z: 0 };
    this.zone = 'cor';
    this.doorOpen = false;
    this.tension = 0;
    this.duck = 1; // 環境音の一時ダッキング（不自然な静寂）
    this.duckTarget = 1;
    this.world = null;
    this.hums = {};
    this.spatials = [];
    this._occT = 0;
    this._paramT = 0;
    this.musicBox = null;
    this.tv = null;
    this.fridgeOn = true;
    this._fridgeT = 8;
    this.muted = false;
  }

  /** ユーザー操作内で呼ぶ */
  start() {
    if (this.ctx) {
      this.ctx.resume?.();
      return;
    }
    if (!AC) return;
    try {
      // iOS：マナーモード中でも再生させる
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch (e) {}
    const ctx = (this.ctx = new AC({ latencyHint: 'interactive' }));
    ctx.resume?.();
    // ミュートスイッチ対策：無音のaudio要素を再生（iOS旧バージョン）
    try {
      const a = document.createElement('audio');
      a.setAttribute('playsinline', '');
      a.src =
        'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=';
      a.loop = true;
      a.volume = 0.01;
      a.play().catch(() => {});
      this._silent = a;
    } catch (e) {}

    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 5;
    this.comp.attack.value = 0.004;
    this.comp.release.value = 0.25;
    this.master.connect(this.comp);
    this.comp.connect(ctx.destination);

    this.ambBus = ctx.createGain();
    this.sfxBus = ctx.createGain();
    this.ambBus.connect(this.master);
    this.sfxBus.connect(this.master);

    // 残響（合成IR）
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._makeIR(2.4, 2.6);
    this.revGain = ctx.createGain();
    this.revGain.gain.value = 0.25;
    this.revIn = ctx.createGain();
    this.revIn.connect(this.reverb);
    this.reverb.connect(this.revGain);
    this.revGain.connect(this.master);

    // ノイズバッファ
    this.nWhite = this._noise('white', 2);
    this.nPink = this._noise('pink', 4);
    this.nBrown = this._noise('brown', 4);

    // 屋外音（ドア・壁越し）
    this.outBus = ctx.createGain();
    this.outLP = ctx.createBiquadFilter();
    this.outLP.type = 'lowpass';
    this.outLP.frequency.value = 400;
    this.outBus.connect(this.outLP);
    this.outLP.connect(this.ambBus);
    this._buildOutside();
    this._buildRoomTone();
    this._buildDrone();
    this.applyVolumes();
    this.master.gain.setTargetAtTime(1, ctx.currentTime, 0.4);
    this.ready = true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.vol.master, t, 0.05);
    this.ambBus.gain.setTargetAtTime(this.vol.amb, t, 0.05);
    this.sfxBus.gain.setTargetAtTime(this.vol.sfx, t, 0.05);
  }

  setVolumes(v) {
    Object.assign(this.vol, v);
    this.applyVolumes();
  }

  suspend() {
    this.ctx?.suspend?.();
  }
  resume() {
    this.ctx?.resume?.();
  }

  // ------------------------------------------------------------------ 基礎部品
  _noise(kind, sec) {
    const ctx = this.ctx;
    const len = ctx.sampleRate * sec;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === 'white') d[i] = w;
      else if (kind === 'pink') {
        b0 = 0.99765 * b0 + w * 0.099046;
        b1 = 0.963 * b1 + w * 0.2965164;
        b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      } else {
        last = (last + 0.02 * w) / 1.02;
        d[i] = last * 3.5;
      }
    }
    // ループの継ぎ目をなじませる
    const f = Math.min(2000, len >> 2);
    for (let i = 0; i < f; i++) {
      const a = i / f;
      d[i] = d[i] * a + d[len - f + i] * (1 - a) * 0;
    }
    return buf;
  }

  _makeIR(sec, decay) {
    const ctx = this.ctx;
    const len = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // 高域が早く減衰するように、ローパス的に重み付け
        const n = Math.random() * 2 - 1;
        d[i] = n * Math.pow(1 - t, decay * 2) * (i < 80 ? i / 80 : 1);
      }
      // 簡易ローパス
      let y = 0;
      for (let i = 0; i < len; i++) {
        const a = 0.55 + 0.4 * (i / len);
        y = y + (d[i] - y) * (1 - a * 0.9);
        d[i] = y * 1.6;
      }
    }
    return buf;
  }

  _src(buf, loop = true) {
    const s = this.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = loop;
    return s;
  }

  _gain(v = 1) {
    const g = this.ctx.createGain();
    g.gain.value = v;
    return g;
  }

  _filter(type, f, q = 1) {
    const b = this.ctx.createBiquadFilter();
    b.type = type;
    b.frequency.value = f;
    b.Q.value = q;
    return b;
  }

  /** 空間音源ノード：in → (遮蔽LP) → panner → sfx/amb バス + 残響送り */
  _spatial({ x = 0, y = 1.2, z = 0, bus = 'sfx', ref = 1.2, roll = 1.3, rev = 0.5, occ = true } = {}) {
    const ctx = this.ctx;
    const input = ctx.createGain();
    const lp = this._filter('lowpass', 18000, 0.5);
    const pan = ctx.createPanner();
    pan.panningModel = 'equalpower';
    pan.distanceModel = 'inverse';
    pan.refDistance = ref;
    pan.rolloffFactor = roll;
    pan.maxDistance = 60;
    setPos(pan, x, y, z);
    input.connect(lp);
    lp.connect(pan);
    pan.connect(bus === 'amb' ? this.ambBus : this.sfxBus);
    const send = ctx.createGain();
    send.gain.value = rev;
    pan.connect(send);
    send.connect(this.revIn);
    const sp = { input, lp, pan, send, x, y, z, occ, occLevel: 0, dead: false };
    this.spatials.push(sp);
    return sp;
  }

  _kill(sp, afterSec) {
    setTimeout(() => {
      sp.dead = true;
      try {
        sp.pan.disconnect();
        sp.send.disconnect();
        sp.lp.disconnect();
      } catch (e) {}
      this.spatials = this.spatials.filter((s) => s !== sp);
    }, afterSec * 1000 + 100);
  }

  /** 非空間（頭の中）出力先 */
  _dry(bus = 'sfx') {
    return bus === 'amb' ? this.ambBus : this.sfxBus;
  }

  // ------------------------------------------------------------------ 環境音（常駐）
  _buildRoomTone() {
    const ctx = this.ctx;
    // 室内の空気：ブラウンノイズを低域に
    const s = this._src(this.nBrown);
    const lp = this._filter('lowpass', 160, 0.4);
    this.toneG = this._gain(0.05);
    s.connect(lp);
    lp.connect(this.toneG);
    this.toneG.connect(this.ambBus);
    s.start();
    // 高域の「耳鳴りに近い」微かな空気
    const s2 = this._src(this.nPink);
    const bp = this._filter('bandpass', 4200, 2.5);
    this.airG = this._gain(0.0025);
    s2.connect(bp);
    bp.connect(this.airG);
    this.airG.connect(this.ambBus);
    s2.start();
  }

  _buildOutside() {
    const ctx = this.ctx;
    // 遠い車の走行音（低域）
    const s = this._src(this.nBrown);
    const lp = this._filter('lowpass', 220, 0.5);
    this.trafficG = this._gain(0.32);
    s.connect(lp);
    lp.connect(this.trafficG);
    this.trafficG.connect(this.outBus);
    s.start();
    // 風
    const w = this._src(this.nPink);
    const bp = this._filter('bandpass', 520, 0.8);
    this.windG = this._gain(0.07);
    w.connect(bp);
    bp.connect(this.windG);
    this.windG.connect(this.outBus);
    w.start();
    this.windBP = bp;
    // 風の揺らぎ
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.13;
    const lg = this._gain(0.045);
    lfo.connect(lg);
    lg.connect(this.windG.gain);
    lfo.start();
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.09;
    const lg2 = this._gain(260);
    lfo2.connect(lg2);
    lg2.connect(bp.frequency);
    lfo2.start();
    // 遠い街の高域ざわめき
    const c = this._src(this.nPink);
    const hp = this._filter('bandpass', 1800, 0.6);
    this.cityG = this._gain(0.012);
    c.connect(hp);
    hp.connect(this.cityG);
    this.cityG.connect(this.outBus);
    c.start();
    this._nextCar = 6;
  }

  _buildDrone() {
    const ctx = this.ctx;
    // 低周波のうなり（ほとんど聞こえない）— 緊張度で増減
    this.drone = ctx.createGain();
    this.drone.gain.value = 0;
    const o1 = ctx.createOscillator();
    o1.frequency.value = 38;
    const o2 = ctx.createOscillator();
    o2.frequency.value = 41.2;
    const o3 = ctx.createOscillator();
    o3.type = 'triangle';
    o3.frequency.value = 76.5;
    const g3 = this._gain(0.25);
    o1.connect(this.drone);
    o2.connect(this.drone);
    o3.connect(g3);
    g3.connect(this.drone);
    this.drone.connect(this.ambBus);
    o1.start();
    o2.start();
    o3.start();
  }

  // ------------------------------------------------------------------ 常時音源の登録
  /** 蛍光灯・LEDのうなり */
  addHum(id, { kind = 'fluor', x = 0, y = 2.3, z = 0, base = 0.1 } = {}) {
    if (!this.ready || this.hums[id]) return this.hums[id];
    const ctx = this.ctx;
    const sp = this._spatial({ x, y, z, bus: 'amb', ref: 1.2, roll: 1.1, rev: 0.25 });
    const out = this._gain(0);
    const hz = 100; // 東日本 50Hz の倍
    const oscs = [];
    const mk = (type, f, g) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const gg = this._gain(g);
      o.connect(gg);
      gg.connect(out);
      o.start();
      oscs.push(o);
    };
    if (kind === 'fluor') {
      mk('sawtooth', hz, 0.5);
      mk('sine', hz * 2, 0.4);
      mk('sine', hz * 3, 0.22);
      mk('square', hz * 6.02, 0.05);
      const n = this._src(this.nWhite);
      const bp = this._filter('bandpass', 7000, 4);
      const ng = this._gain(0.07);
      n.connect(bp);
      bp.connect(ng);
      ng.connect(out);
      n.start();
    } else if (kind === 'led') {
      mk('sine', 9000, 0.02);
      mk('sine', hz * 2, 0.12);
      const n = this._src(this.nPink);
      const bp = this._filter('bandpass', 5200, 6);
      const ng = this._gain(0.02);
      n.connect(bp);
      bp.connect(ng);
      ng.connect(out);
      n.start();
    } else if (kind === 'fan') {
      const n = this._src(this.nPink);
      const bp = this._filter('bandpass', 380, 0.9);
      const ng = this._gain(0.5);
      n.connect(bp);
      bp.connect(ng);
      ng.connect(out);
      n.start();
      mk('sine', 52, 0.12);
    }
    const lp = this._filter('lowpass', kind === 'fluor' ? 9000 : 6000, 0.6);
    out.connect(lp);
    lp.connect(sp.input);
    const h = { sp, out, base, level: 0, kind, setLevel: (v) => (h.level = v) };
    this.hums[id] = h;
    return h;
  }

  addFridge(x, y, z) {
    if (!this.ready || this.hums.fridge) return;
    const ctx = this.ctx;
    const sp = this._spatial({ x, y, z, bus: 'amb', ref: 1.0, roll: 1.4, rev: 0.2 });
    const out = this._gain(0);
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = 50;
    const o2 = ctx.createOscillator();
    o2.type = 'square';
    o2.frequency.value = 100.3;
    const g1 = this._gain(0.4);
    const g2 = this._gain(0.12);
    const lp = this._filter('lowpass', 320, 0.9);
    o1.connect(g1);
    o2.connect(g2);
    g1.connect(lp);
    g2.connect(lp);
    lp.connect(out);
    const n = this._src(this.nBrown);
    const nlp = this._filter('lowpass', 400, 0.5);
    const ng = this._gain(0.5);
    n.connect(nlp);
    nlp.connect(ng);
    ng.connect(out);
    o1.start();
    o2.start();
    n.start();
    out.connect(sp.input);
    this.hums.fridge = { sp, out, base: 0.2, level: 1, kind: 'fridge', setLevel: (v) => (this.hums.fridge.level = v) };
  }

  /** 空間音源の位置を更新（旧Safari対応）*/
  moveSpatial(sp, x, y, z) {
    sp.x = x;
    sp.y = y;
    sp.z = z;
    setPos(sp.pan, x, y, z);
  }

  // ------------------------------------------------------------------ 更新
  update(dt, L, info, world) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    this.world = world;
    this.zone = info.zone;
    this.doorOpen = info.doorOpen;
    this.tension = info.tension;
    const lis = ctx.listener;
    if (lis.positionX) {
      lis.positionX.value = L.x;
      lis.positionY.value = L.y;
      lis.positionZ.value = L.z;
      const fx = -Math.sin(L.yaw);
      const fz = -Math.cos(L.yaw);
      lis.forwardX.value = fx;
      lis.forwardY.value = 0;
      lis.forwardZ.value = fz;
      lis.upX.value = 0;
      lis.upY.value = 1;
      lis.upZ.value = 0;
    } else {
      lis.setPosition?.(L.x, L.y, L.z);
      lis.setOrientation?.(-Math.sin(L.yaw), 0, -Math.cos(L.yaw), 0, 1, 0);
    }
    this.listener.x = L.x;
    this.listener.y = L.y;
    this.listener.z = L.z;

    // ダッキング
    this.duck = damp(this.duck, this.duckTarget, this.duckTarget < this.duck ? 6 : 1.2, dt);
    const duck = this.duck;

    // AudioParam の更新は 12Hz 程度に間引く（自動化イベントの蓄積を防ぐ）
    this._paramT -= dt;
    if (this._paramT <= 0) {
      this._paramT = 0.08;
      // 屋外音の通り方
      const inCor = info.zone === 'cor';
      const outGain = inCor ? 1 : info.doorOpen ? 0.5 : 0.22;
      const outCut = inCor ? 9000 : info.doorOpen ? 1600 : 420;
      this.outBus.gain.setTargetAtTime(outGain * duck, t, 0.15);
      this.outLP.frequency.setTargetAtTime(outCut, t, 0.2);
      // 室内の部屋鳴き
      this.toneG.gain.setTargetAtTime((inCor ? 0.018 : 0.05) * duck, t, 0.3);
      this.airG.gain.setTargetAtTime((0.0025 + this.tension * 0.0035) * duck, t, 0.3);
      // 残響量（廊下は長く）
      const rv = info.zone === 'cor' ? 0.5 : info.zone === 'hall' ? 0.3 : 0.18;
      this.revGain.gain.setTargetAtTime(rv, t, 0.3);
      // ドローン
      this.drone.gain.setTargetAtTime(this.tension * 0.07 * duck, t, 0.5);
      // うなりの音量
      for (const k in this.hums) {
        const h = this.hums[k];
        h.out.gain.setTargetAtTime(h.base * h.level * duck, t, 0.05);
      }
    }

    // 遠くを通る車
    this._nextCar -= dt;
    if (this._nextCar < 0) {
      this._nextCar = rand(9, 22);
      this._car();
    }

    // 冷蔵庫のサイクル
    this._fridgeT -= dt;
    if (this._fridgeT < 0 && this.hums.fridge) {
      this.fridgeOn = !this.fridgeOn;
      this._fridgeT = this.fridgeOn ? rand(40, 70) : rand(14, 26);
      this.hums.fridge.level = this.fridgeOn ? 1 : 0;
      if (this.hums.fridge.sp) this.thunk(this.hums.fridge.sp.x, 0.9, this.hums.fridge.sp.z, 0.12);
    }

    // 遮蔽（0.2秒ごと）
    this._occT -= dt;
    if (this._occT <= 0) {
      this._occT = 0.2;
      this._updateOcclusion(world, t);
    }
  }

  _updateOcclusion(world, t) {
    if (!world) return;
    const A = { x: this.listener.x, y: this.listener.y, z: this.listener.z };
    for (const sp of this.spatials) {
      if (!sp.occ) continue;
      const B = { x: sp.x, y: Math.min(sp.y, 2.2), z: sp.z };
      const blocked = world.occluded(A, B);
      const dist = Math.hypot(A.x - B.x, A.z - B.z);
      const target = blocked ? 520 + Math.max(0, 1200 - dist * 120) : 16000;
      sp.lp.frequency.setTargetAtTime(Math.max(300, target), t, 0.12);
    }
  }

  // ------------------------------------------------------------------ 一回きりのSE
  /** 汎用：エンベロープ付きオシレータ */
  _tone(dest, { type = 'sine', f0 = 440, f1, dur = 0.3, a = 0.005, peak = 0.3, t0 = 0, detune = 0 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + t0;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    if (detune) o.detune.value = detune;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + dur + 0.05);
    return o;
  }

  _burst(dest, { buf = this.nWhite, type = 'bandpass', f = 1000, q = 1, dur = 0.1, a = 0.002, peak = 0.3, t0 = 0, f1 }) {
    const ctx = this.ctx;
    const t = ctx.currentTime + t0;
    const s = ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    const flt = this._filter(type, f, q);
    if (f1) {
      flt.frequency.setValueAtTime(f, t);
      flt.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(flt);
    flt.connect(g);
    g.connect(dest);
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  _at(x, y, z, o = {}) {
    const sp = this._spatial({ x, y, z, ...o });
    return sp;
  }

  /** 公開：名前で再生。opts: {x,y,z,gain,rate} */
  play(name, o = {}) {
    if (!this.ready) return;
    const fn = this['sfx_' + name];
    if (!fn) return;
    fn.call(this, o);
  }

  _out(o, life = 2, extra = {}) {
    // 位置があれば空間、なければ頭内
    if (o.x !== undefined) {
      const sp = this._at(o.x, o.y ?? 1.2, o.z, extra);
      this._kill(sp, life);
      const g = this._gain(o.gain ?? 1);
      g.connect(sp.input);
      return g;
    }
    const g = this._gain(o.gain ?? 1);
    g.connect(this._dry());
    return g;
  }

  // ---- ドア
  sfx_door(o) {
    // 蝶番のきしみ
    const d = this._out(o, 2.5, { rev: 0.5 });
    const dur = o.long ? 1.6 : 0.8;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(rand(120, 150), t);
    osc.frequency.linearRampToValueAtTime(rand(190, 260), t + dur * 0.7);
    osc.frequency.linearRampToValueAtTime(rand(150, 190), t + dur);
    const bp = this._filter('bandpass', rand(650, 900), 6);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.22 * (o.creak ?? 1), t + 0.15);
    g.gain.linearRampToValueAtTime(0.1, t + dur * 0.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(bp);
    bp.connect(g);
    g.connect(d);
    osc.start(t);
    osc.stop(t + dur + 0.1);
    // ラッチ
    this._burst(d, { f: 2400, q: 3, dur: 0.05, peak: 0.25, t0: 0.02 });
    this._tone(d, { f0: 180, f1: 90, dur: 0.1, peak: 0.12 });
  }

  sfx_doorShut(o) {
    const d = this._out(o, 2.5, { rev: 0.6 });
    this._tone(d, { f0: 95, f1: 42, dur: 0.28, peak: 0.55 });
    this._burst(d, { type: 'lowpass', f: 900, q: 0.5, dur: 0.2, peak: 0.45 });
    this._burst(d, { f: 2600, q: 4, dur: 0.05, peak: 0.2, t0: 0.01 });
  }

  sfx_steelDoor(o) {
    const d = this._out(o, 3.5, { rev: 0.9 });
    this._tone(d, { f0: 70, f1: 38, dur: 0.5, peak: 0.7 });
    this._burst(d, { type: 'lowpass', f: 1100, dur: 0.3, peak: 0.55 });
    // 金属の鳴り
    for (const [f, g] of [
      [410, 0.08],
      [640, 0.06],
      [1180, 0.05],
      [1720, 0.03],
    ])
      this._tone(d, { f0: f, dur: 0.9, peak: g, detune: rand(-12, 12) });
    this._burst(d, { f: 3200, q: 5, dur: 0.06, peak: 0.3 });
  }

  sfx_steelOpen(o) {
    const d = this._out(o, 2.5, { rev: 0.7 });
    this._burst(d, { f: 2800, q: 5, dur: 0.05, peak: 0.28 });
    this._tone(d, { f0: 150, f1: 70, dur: 0.15, peak: 0.25, t0: 0.03 });
    const ctx = this.ctx;
    // ドアクローザーのきしみ
    this._burst(d, { type: 'bandpass', f: 900, q: 9, f1: 1500, dur: 0.9, peak: 0.07, t0: 0.12 });
  }

  sfx_unlock(o) {
    const d = this._out(o, 1.5, { rev: 0.4 });
    this._burst(d, { f: 3400, q: 6, dur: 0.04, peak: 0.3 });
    this._tone(d, { f0: 220, f1: 140, dur: 0.07, peak: 0.2 });
    this._burst(d, { f: 2200, q: 6, dur: 0.05, peak: 0.28, t0: 0.16 });
    this._tone(d, { f0: 180, f1: 110, dur: 0.08, peak: 0.2, t0: 0.16 });
  }

  sfx_keys(o) {
    const d = this._out(o, 1.5, { rev: 0.3 });
    for (let i = 0; i < 7; i++) this._burst(d, { f: rand(4200, 7000), q: 8, dur: 0.07, peak: rand(0.08, 0.16), t0: i * rand(0.03, 0.06) });
  }

  sfx_knob(o) {
    const d = this._out(o, 1.5, { rev: 0.3 });
    for (let i = 0; i < 4; i++) this._burst(d, { f: rand(1800, 3200), q: 5, dur: 0.04, peak: 0.16, t0: i * 0.07 + rand(0, 0.03) });
    this._tone(d, { f0: 300, f1: 200, dur: 0.12, peak: 0.1, t0: 0.05 });
  }

  sfx_chain(o) {
    const d = this._out(o, 1.5, { rev: 0.3 });
    for (let i = 0; i < 9; i++) this._burst(d, { f: rand(3000, 6000), q: 7, dur: 0.05, peak: 0.12, t0: i * 0.045 });
  }

  // ---- 打撃・足音
  thunk(x, y, z, g = 0.4) {
    const d = this._out({ x, y, z, gain: 1 }, 1.5, { rev: 0.5 });
    this._tone(d, { f0: 100, f1: 50, dur: 0.18, peak: g });
    this._burst(d, { type: 'lowpass', f: 600, dur: 0.1, peak: g * 0.5 });
  }

  sfx_knock(o) {
    const n = o.n ?? 3;
    const gap = o.gap ?? 0.28;
    const d = this._out(o, n * gap + 2, { rev: 0.7 });
    for (let i = 0; i < n; i++) {
      const t0 = i * gap + rand(-0.015, 0.015);
      this._tone(d, { f0: rand(150, 190), f1: 80, dur: 0.16, peak: 0.7, t0 });
      this._burst(d, { type: 'lowpass', f: 1400, dur: 0.07, peak: 0.5, t0 });
      this._burst(d, { f: 3000, q: 2, dur: 0.02, peak: 0.2, t0 });
    }
  }

  sfx_stepsAbove(o) {
    // 天井越し・壁越しの足音
    const n = o.n ?? 5;
    const gap = o.gap ?? 0.62;
    const d = this._out(o, n * gap + 2, { rev: 0.8 });
    const lp = this._filter('lowpass', 420, 0.7);
    lp.connect(d);
    for (let i = 0; i < n; i++) {
      const t0 = i * gap + rand(-0.03, 0.03);
      this._tone(lp, { f0: rand(70, 95), f1: 40, dur: 0.22, peak: rand(0.45, 0.7), t0 });
      this._burst(lp, { type: 'lowpass', f: 500, dur: 0.12, peak: 0.4, t0 });
    }
  }

  footstep(surface = 'wood', vol = 1, side = 1) {
    if (!this.ready) return;
    const d = this._gain(0.55 * vol);
    d.connect(this._dry());
    // 足音は頭内で、わずかに左右
    const pan = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
    if (pan) {
      pan.pan.value = side * 0.12;
      d.disconnect();
      d.connect(pan);
      pan.connect(this._dry());
    }
    const r = this.ctx.createGain();
    r.gain.value = 0.08;
    d.connect(r);
    r.connect(this.revIn);
    switch (surface) {
      case 'concrete':
        this._burst(d, { f: rand(1400, 1900), q: 1.2, dur: 0.07, peak: 0.5 });
        this._tone(d, { f0: 140, f1: 60, dur: 0.09, peak: 0.28 });
        this._burst(d, { f: 4200, q: 3, dur: 0.02, peak: 0.12 });
        break;
      case 'tile':
        this._burst(d, { f: rand(2200, 3000), q: 2, dur: 0.05, peak: 0.45 });
        this._tone(d, { f0: 170, f1: 80, dur: 0.08, peak: 0.25 });
        break;
      case 'rug':
        this._burst(d, { type: 'lowpass', f: 500, dur: 0.1, peak: 0.25 });
        break;
      default: // wood（靴下の足音）
        this._burst(d, { f: rand(500, 800), q: 0.9, dur: 0.09, peak: 0.32 });
        this._tone(d, { f0: rand(100, 130), f1: 55, dur: 0.1, peak: 0.3 });
        break;
    }
  }

  // ---- 水・設備
  sfx_drip(o) {
    const d = this._out(o, 2.5, { rev: 0.9 });
    this._tone(d, { f0: rand(1300, 1900), f1: 500, dur: 0.07, peak: 0.35 });
    this._tone(d, { f0: rand(2600, 3400), f1: 900, dur: 0.04, peak: 0.1, t0: 0.01 });
  }

  sfx_flush(o) {
    const d = this._out(o, 7, { rev: 0.7 });
    this._burst(d, { type: 'bandpass', f: 500, q: 0.6, f1: 1800, dur: 2.6, a: 0.4, peak: 0.28 });
    this._burst(d, { type: 'bandpass', f: 2400, q: 0.8, f1: 900, dur: 3.4, a: 0.6, peak: 0.12, t0: 0.5 });
    for (let i = 0; i < 6; i++) this._tone(d, { f0: rand(300, 700), f1: rand(150, 300), dur: 0.15, peak: 0.07, t0: 2.4 + i * 0.25 });
  }

  sfx_water(o) {
    const d = this._out(o, (o.dur ?? 4) + 1.5, { rev: 0.7 });
    this._burst(d, { type: 'highpass', f: 1200, q: 0.4, dur: o.dur ?? 4, a: 0.3, peak: 0.16 });
    this._burst(d, { type: 'bandpass', f: 3500, q: 0.5, dur: o.dur ?? 4, a: 0.3, peak: 0.08 });
  }

  sfx_fridgeOpen(o) {
    const d = this._out(o, 1.5, { rev: 0.3 });
    this._burst(d, { type: 'bandpass', f: 320, q: 0.8, dur: 0.18, peak: 0.28 });
    this._burst(d, { f: 2000, q: 3, dur: 0.03, peak: 0.12, t0: 0.12 });
  }

  sfx_breaker(o) {
    const d = this._out(o, 2, { rev: 0.6 });
    this._burst(d, { f: 1800, q: 4, dur: 0.05, peak: 0.45 });
    this._tone(d, { f0: 240, f1: 120, dur: 0.12, peak: 0.35 });
    this._burst(d, { type: 'lowpass', f: 700, dur: 0.15, peak: 0.25, t0: 0.02 });
  }

  sfx_powerDown(o) {
    const d = this._out(o, 3, { rev: 0.5 });
    this._tone(d, { f0: 140, f1: 28, dur: 0.9, peak: 0.5 });
    this._burst(d, { type: 'lowpass', f: 800, dur: 0.4, peak: 0.4 });
  }

  sfx_switch(o) {
    const d = this._out(o, 1, { rev: 0.2 });
    this._burst(d, { f: 2600, q: 5, dur: 0.025, peak: 0.28 });
    this._tone(d, { f0: 600, f1: 300, dur: 0.04, peak: 0.1 });
  }

  // ---- 通知・チャイム・エレベーター
  sfx_buzz(o) {
    const d = this._out({ ...o, gain: (o.gain ?? 1) * 0.9 }, 2);
    const ctx = this.ctx;
    for (let k = 0; k < 2; k++) {
      const t = ctx.currentTime + k * 0.34;
      const osc = ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 168;
      const am = ctx.createGain();
      am.gain.value = 0;
      am.gain.setValueAtTime(0, t);
      am.gain.linearRampToValueAtTime(0.22, t + 0.02);
      am.gain.setValueAtTime(0.22, t + 0.24);
      am.gain.linearRampToValueAtTime(0, t + 0.27);
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 38;
      const lg = ctx.createGain();
      lg.gain.value = 0.12;
      lfo.connect(lg);
      lg.connect(am.gain);
      const lp = this._filter('lowpass', 900, 0.8);
      osc.connect(am);
      am.connect(lp);
      lp.connect(d);
      osc.start(t);
      lfo.start(t);
      osc.stop(t + 0.3);
      lfo.stop(t + 0.3);
    }
    this._burst(d, { type: 'lowpass', f: 400, dur: 0.6, peak: 0.12 });
  }

  sfx_notify(o) {
    const d = this._out({ ...o, gain: (o.gain ?? 1) * 0.55 }, 3);
    this._tone(d, { type: 'sine', f0: 659.3, dur: 1.2, peak: 0.28 });
    this._tone(d, { type: 'sine', f0: 987.8 * 1.012, dur: 1.4, peak: 0.16, t0: 0.16 });
    this._tone(d, { type: 'sine', f0: 1318.5, dur: 0.9, peak: 0.05, t0: 0.16 });
  }

  sfx_chime(o) {
    const d = this._out(o, 4, { rev: 0.6 });
    this._tone(d, { f0: 659.3, dur: 1.4, peak: 0.34 });
    this._tone(d, { f0: 1318.6, dur: 0.8, peak: 0.08 });
    this._tone(d, { f0: 523.3, dur: 1.9, peak: 0.34, t0: 0.55 });
    this._tone(d, { f0: 1046.5, dur: 1.0, peak: 0.07, t0: 0.55 });
  }

  sfx_ding(o) {
    const d = this._out(o, 5, { rev: 1.0 });
    for (const [m, g, dur] of [
      [1, 0.4, 2.4],
      [2.76, 0.12, 1.4],
      [5.4, 0.05, 0.8],
    ])
      this._tone(d, { f0: 880 * m, dur, peak: g });
  }

  sfx_elevator(o) {
    const d = this._out(o, 6, { rev: 0.8 });
    this._burst(d, { type: 'lowpass', f: 200, dur: 4.5, a: 1, peak: 0.35, buf: this.nBrown });
    this._burst(d, { f: 700, q: 2, f1: 300, dur: 3, a: 0.5, peak: 0.05 });
  }

  sfx_slide(o) {
    const d = this._out(o, 3, { rev: 0.8 });
    this._burst(d, { type: 'bandpass', f: 900, q: 1.2, f1: 400, dur: 1.6, a: 0.2, peak: 0.12 });
    this._burst(d, { type: 'lowpass', f: 160, dur: 1.6, a: 0.2, peak: 0.25, buf: this.nBrown });
  }

  // ---- 体・声・音
  sfx_heartbeat(o) {
    const d = this._out({ gain: (o.gain ?? 0.6) }, 1.5);
    this._tone(d, { f0: 62, f1: 38, dur: 0.16, peak: 0.6 });
    this._tone(d, { f0: 56, f1: 36, dur: 0.18, peak: 0.45, t0: 0.19 });
  }

  sfx_creak(o) {
    const d = this._out(o, 3, { rev: 0.5 });
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(rand(70, 110), t);
    osc.frequency.linearRampToValueAtTime(rand(120, 180), t + 0.4);
    const bp = this._filter('bandpass', rand(300, 500), 8);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.2, t + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    osc.connect(bp);
    bp.connect(g);
    g.connect(d);
    osc.start(t);
    osc.stop(t + 0.6);
  }

  sfx_breath(o) {
    const d = this._out(o, 10, { rev: 0.7 });
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const n = o.n ?? 3;
    for (let i = 0; i < n; i++) {
      const s = this._src(this.nPink);
      const bp = this._filter('bandpass', 900, 0.7);
      const g = ctx.createGain();
      const t0 = t + i * 3.4;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.linearRampToValueAtTime(0.1, t0 + 1.4);
      g.gain.linearRampToValueAtTime(0.0001, t0 + 2.4);
      bp.frequency.setValueAtTime(700, t0);
      bp.frequency.linearRampToValueAtTime(1200, t0 + 1.4);
      s.connect(bp);
      bp.connect(g);
      g.connect(d);
      s.start(t0, Math.random());
      s.stop(t0 + 2.6);
    }
  }

  sfx_whoosh(o) {
    const d = this._out(o, 3, { rev: 0.9 });
    this._burst(d, { type: 'bandpass', f: 300, q: 0.7, f1: 1500, dur: 1.8, a: 0.9, peak: 0.25 });
  }

  sfx_gust(o) {
    const d = this._out(o, 4, { rev: 0.7 });
    this._burst(d, { type: 'bandpass', f: 400, q: 0.5, f1: 900, dur: 3, a: 1.2, peak: 0.3, buf: this.nPink });
  }

  sfx_click(o) {
    const d = this._out({ gain: 0.5 }, 0.6);
    this._burst(d, { f: 2400, q: 4, dur: 0.02, peak: 0.2 });
  }

  sfx_ui(o) {
    const d = this._out({ gain: 0.4 }, 0.6);
    this._tone(d, { f0: 520, f1: 420, dur: 0.08, peak: 0.12 });
  }

  sfx_thud(o) {
    const d = this._out(o, 2, { rev: 0.5 });
    this._tone(d, { f0: 70, f1: 38, dur: 0.35, peak: 0.7 });
    this._burst(d, { type: 'lowpass', f: 500, dur: 0.2, peak: 0.45 });
  }

  sfx_drop(o) {
    // 何かが床に落ちる
    const d = this._out(o, 2, { rev: 0.7 });
    this._tone(d, { f0: 300, f1: 90, dur: 0.15, peak: 0.4 });
    this._burst(d, { f: 2200, q: 2, dur: 0.06, peak: 0.3 });
    this._burst(d, { f: 1800, q: 3, dur: 0.05, peak: 0.18, t0: 0.12 });
    this._burst(d, { f: 2600, q: 3, dur: 0.04, peak: 0.1, t0: 0.2 });
  }

  sfx_glass(o) {
    const d = this._out(o, 2, { rev: 0.6 });
    for (const f of [2400, 3200, 4100]) this._tone(d, { f0: f, dur: 0.5, peak: 0.08, detune: rand(-20, 20) });
    this._burst(d, { f: 5000, q: 2, dur: 0.05, peak: 0.25 });
  }

  // ---- 低速テープのようなオルゴール（原曲不使用の短い旋律）
  sfx_musicbox(o) {
    const d = this._out({ ...o, gain: (o.gain ?? 1) * 0.8 }, 16, { rev: 1.0 });
    // 都節音階（陰旋法）風：E F A B C ...
    const scale = [329.6, 349.2, 440, 493.9, 523.3, 659.3, 698.5];
    const seq = [0, 2, 3, 2, 0, 1, 0, 2, 3, 4, 3, 2, 1, 0, 1, 2];
    let t = 0;
    seq.forEach((n, i) => {
      const slow = 1 + i * 0.045; // 少しずつ遅く
      const f = scale[n] * (1 - i * 0.002); // わずかに音程が下がる
      this._tone(d, { type: 'sine', f0: f, dur: 1.4, peak: 0.16, t0: t });
      this._tone(d, { type: 'triangle', f0: f * 2.01, dur: 0.6, peak: 0.05, t0: t });
      this._tone(d, { type: 'sine', f0: f * 3.98, dur: 0.25, peak: 0.02, t0: t });
      t += 0.42 * slow;
    });
  }

  // ---- 遠くの人のハミング（母音のフォルマント合成）
  sfx_hum(o) {
    const d = this._out({ ...o, gain: (o.gain ?? 1) * 0.7 }, 12, { rev: 1.0 });
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const notes = o.notes || [392, 440, 392, 329.6, 349.2, 329.6, 293.7];
    const src = ctx.createOscillator();
    src.type = 'sawtooth';
    const vib = ctx.createOscillator();
    vib.frequency.value = 5.2;
    const vg = this._gain(5);
    vib.connect(vg);
    vg.connect(src.frequency);
    const g = ctx.createGain();
    g.gain.value = 0;
    const f1 = this._filter('bandpass', 300, 5);
    const f2 = this._filter('bandpass', 900, 6);
    const f3 = this._filter('bandpass', 2400, 8);
    const mix = this._gain(1);
    src.connect(g);
    g.connect(f1);
    g.connect(f2);
    g.connect(f3);
    f1.connect(mix);
    f2.connect(mix);
    f3.connect(mix);
    mix.connect(d);
    let t = t0;
    notes.forEach((f, i) => {
      src.frequency.setValueAtTime(f * 0.5, t);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.26, t + 0.25);
      g.gain.linearRampToValueAtTime(0.18, t + 1.1);
      g.gain.linearRampToValueAtTime(0.0001, t + 1.5);
      t += 1.45;
    });
    src.start(t0);
    vib.start(t0);
    src.stop(t + 0.2);
    vib.stop(t + 0.2);
    // 息のノイズ
    this._burst(d, { type: 'bandpass', f: 1800, q: 0.7, dur: t - t0, a: 1.5, peak: 0.02 });
  }

  // ---- 時計
  tick(x, y, z, big = false, alt = false) {
    if (!this.ready) return;
    const o = { x, y, z, gain: big ? 1.4 : 0.8 };
    const d = this._out(o, 1.2, { rev: 0.4, ref: 0.8, roll: 1.6 });
    this._burst(d, { f: alt ? 2600 : 3200, q: 6, dur: 0.018, peak: 0.28 });
    this._tone(d, { f0: alt ? 780 : 940, f1: 500, dur: 0.03, peak: 0.07 });
  }

  // ---- テレビの砂嵐ループ
  tvOn(x, y, z) {
    if (!this.ready || this.tv) return;
    const sp = this._spatial({ x, y, z, bus: 'amb', ref: 1.2, roll: 1.1, rev: 0.4 });
    const s = this._src(this.nWhite);
    const bp = this._filter('bandpass', 3800, 0.5);
    const g = this._gain(0.0);
    s.connect(bp);
    bp.connect(g);
    g.connect(sp.input);
    s.start();
    g.gain.setTargetAtTime(0.1, this.ctx.currentTime, 0.05);
    // 微かな15kHz
    const o = this.ctx.createOscillator();
    o.frequency.value = 15734;
    const og = this._gain(0.004);
    o.connect(og);
    og.connect(sp.input);
    o.start();
    this.tv = { sp, s, g, o };
  }

  tvOff() {
    if (!this.tv) return;
    const { sp, s, g, o } = this.tv;
    g.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    this._tone(this._dry(), { f0: 8000, f1: 100, dur: 0.12, peak: 0.1 });
    setTimeout(() => {
      try {
        s.stop();
        o.stop();
      } catch (e) {}
      sp.dead = true;
      this.spatials = this.spatials.filter((q) => q !== sp);
    }, 400);
    this.tv = null;
  }

  // ---- 遠方の車
  _car() {
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const s = this._src(this.nPink);
    const bp = this._filter('bandpass', 300, 0.8);
    const g = ctx.createGain();
    const dir = Math.random() < 0.5 ? 1 : -1;
    const dur = rand(4, 7);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.18, t + dur * 0.5);
    g.gain.linearRampToValueAtTime(0.0001, t + dur);
    bp.frequency.setValueAtTime(220, t);
    bp.frequency.linearRampToValueAtTime(380, t + dur * 0.5);
    bp.frequency.linearRampToValueAtTime(240, t + dur);
    s.connect(bp);
    bp.connect(g);
    g.connect(this.outBus);
    s.start(t, Math.random() * 2);
    s.stop(t + dur + 0.1);
  }

  // ---- 緊張の演出
  /** 不自然な静寂：環境音を落とす */
  silence(sec = 5, depth = 0.04) {
    this.duckTarget = depth;
    clearTimeout(this._silT);
    this._silT = setTimeout(() => {
      this.duckTarget = 1;
    }, sec * 1000);
  }

  stopAll() {
    this.duckTarget = 1;
  }
}
