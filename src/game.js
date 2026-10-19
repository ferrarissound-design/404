// ゲーム本体：初期化・メインループ・インタラクト・セーブ・描画制御
import * as THREE from 'three';
import { createRenderer, Post, TIERS, fovFor } from './gfx.js';
import { World } from './world/index.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { UI } from './ui.js';
import { AudioEngine } from './audio.js';
import { Director } from './director.js';
import { H } from './interactions.js';
import { applyState, defaultWorldState, tickWorld, setTV } from './state.js';
import { loadSave, writeSave, clearSave, loadSettings, writeSettings } from './save.js';
import { buildStandingShadow } from './world/figure.js';
import { endingLines } from './story.js';
import { segHitsBox } from './world/core.js';
import { clamp, damp, lerp, nextFrame, sleep, fmtTime, rand } from './util.js';

const $ = (id) => document.getElementById(id);

export function newState() {
  const log = makeLog();
  return {
    phase: 'prologue',
    phaseT: 0,
    playSec: 0,
    clock: 23 * 60 + 47,
    entries: 0,
    act: 0,
    flags: {},
    world: defaultWorldState(),
    memory: null,
    decisions: {},
    trust: 0,
    log,
    mutations: [],
    messages: [],
  };
}

export function makeLog(src) {
  const log = {
    gaze: {},
    gazeId: {},
    inspected: {},
    inspectedId: {},
    doors: {},
    lights: {},
    rooms: {},
    choices: [],
    events: [],
    targeted: [],
    totalInspect: 0,
    lookBacks: 0,
    ...(src || {}),
  };
  Object.defineProperty(log, 'inspect', {
    enumerable: false,
    value(tag, id) {
      this.inspected[tag] = (this.inspected[tag] || 0) + 1;
      this.inspectedId[id] = (this.inspectedId[id] || 0) + 1;
      this.totalInspect++;
    },
  });
  return log;
}

export class Game {
  constructor() {
    this.settings = loadSettings();
    this.S = newState();
    this.timers = [];
    this.time = 0;
    this.running = false; // ゲーム進行中（タイトルを除く）
    this.paused = false;
    this.started = false;
    this.zone = 'cor';
    this.gazeNow = null;
    this.gazeHold = 0;
    this.resScale = 1;
    this.frames = 0;
    this.ftAvg = 16;
    this.tierName = 'high';
    this.fadeColor = 'black';
    this.view = null;
    this._sayId = 0;
    this._lastInteract = 0;
    this._lastFar = 0;
    this._gazeT = 0;
    this._pickT = 0;
    this.fog = { d: 0.03, c: new THREE.Color(0x0a0d12) };
    this.mirrorT = 0;
    this.hallShadow = null;
  }

  get log() {
    return this.S.log;
  }

  get overlayOpen() {
    return this.ui.examineOpen || this.ui.choiceOpen || this.ui.phoneOpen || this.paused || !!this.view || this.ui.el.settings.classList.contains('hidden') === false;
  }

  // ======================================================================= 起動
  async boot() {
    const ui = (this.ui = new UI());
    ui.vibrate = this.settings.haptic;
    ui.setLoading(0.02, '');
    await nextFrame();

    this.canvas = $('gl');
    this.renderer = createRenderer(this.canvas);
    const tierName = this.pickInitialTier();
    this.tierName = tierName;
    this.tier = TIERS[tierName];
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0a0d12, 0.03);
    this.camera = new THREE.PerspectiveCamera(70, 2, 0.05, 420);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    this.feedCam = new THREE.PerspectiveCamera(100, 4 / 3, 0.05, 300);
    this.feedCam.rotation.order = 'YXZ';
    this.scene.add(this.feedCam);

    this.post = new Post(this.renderer, this.tier);
    this.world = new World(this.renderer, this.scene, this.tier);
    this.player = new Player(this.camera);
    this.audio = new AudioEngine();
    this.input = new Input($('app'), this.canvas);
    this.director = new Director(this);

    this.world.on('door', (e) => this.onDoorSound(e));
    this.world.on('switch', () => {});
    this.player.onStep = (surf, vol, side) => this.audio.footstep(surf, vol, side);

    await this.world.build((p) => ui.setLoading(0.05 + p * 0.9, ['壁の染みを数えています…', '家具を並べています…', '電気をつけています…'][Math.min(2, Math.floor(p * 3))]));
    // スマホライトをカメラに取り付け
    const fl = this.world.lFlash;
    this.camera.add(fl);
    this.camera.add(fl.target);
    fl.position.set(0.12, -0.12, 0);
    fl.target.position.set(0, 0, -6);
    this.setFlashlight(false);

    this.hallShadow = buildStandingShadow(this.world, 'hall');
    this.hallShadow.visible = false;
    this.world.root.add(this.hallShadow);
    this.world.props.shadowHall = this.hallShadow;
    this.intercomShadow = buildStandingShadow(this.world, 'cor');
    this.intercomShadow.position.set(0, 0, -0.75);
    this.intercomShadow.rotation.y = 0;
    this.intercomShadow.visible = false;
    this.world.root.add(this.intercomShadow);

    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      ui.el.loading.classList.remove('hidden');
      ui.el.loading.style.opacity = '1';
      ui.el.loading.querySelector('.l-text').textContent = '描画が中断されました。画面をタップして再読み込みします。';
      ui.el.loading.onclick = () => location.reload();
    });
    this.bindUI();
    this.bindInput();
    this.applySettings();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('orientationchange', () => setTimeout(() => this.resize(), 200));
    document.addEventListener('visibilitychange', () => this.onVisibility());
    window.addEventListener('pagehide', () => this.save());

    // タイトル画面の背景：廊下で玄関を見つめる
    this.S = newState();
    this.apply({ instant: true });
    this.titleT = 0;
    ui.setLoading(1, '');
    await sleep(300);
    ui.hideLoading();
    const save = loadSave();
    ui.showTitle(true, !!save && save.phase && save.phase !== 'ending');
    this.mode = 'title';
    this.last = performance.now();
    requestAnimationFrame((t) => this.loop(t));
    this.exposeDebug();
  }

  pickInitialTier() {
    const q = this.settings.quality;
    if (q && q !== 'auto' && TIERS[q]) return q;
    const ua = navigator.userAgent || '';
    const mem = navigator.deviceMemory || 4;
    const cores = navigator.hardwareConcurrency || 4;
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    if (isIOS) return 'high';
    if (isAndroid) return mem <= 3 || cores <= 6 ? 'low' : 'mid';
    return mem <= 2 ? 'low' : 'high';
  }

  setTier(name) {
    this.tierName = name;
    this.tier = TIERS[name];
    this.post.setTier(this.tier);
    const L = this.world.lLDK;
    L.castShadow = this.tier.shadow > 0;
    if (this.tier.shadow > 0) {
      L.shadow.mapSize.set(this.tier.shadow, this.tier.shadow);
      if (L.shadow.map) {
        L.shadow.map.dispose();
        L.shadow.map = null;
      }
    }
    this.resize();
  }

  // ======================================================================= リサイズ・画質
  resize() {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const dpr = Math.min(window.devicePixelRatio || 1, this.tier.dpr) * this.resScale;
    const w = Math.max(2, Math.floor(W * dpr));
    const h = Math.max(2, Math.floor(H * dpr));
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(w, h, false);
    this.post.resize(w, h);
    this.camera.aspect = W / H;
    this.camera.fov = fovFor(W / H);
    this.camera.updateProjectionMatrix();
    this.feedCam.aspect = W / H;
    this.feedCam.updateProjectionMatrix();
    const portrait = this.input.isTouch && H > W * 1.05;
    this.ui.showRotate(portrait);
    this.portrait = portrait;
  }

  adaptQuality(dtMs) {
    this.ftAvg = this.ftAvg * 0.94 + dtMs * 0.06;
    this.frames++;
    if (this.frames % 90 !== 0 || this.settings.quality !== 'auto') return;
    if (document.hidden || this.paused) return;
    const slow = this.ftAvg > 23;
    const fast = this.ftAvg < 13.5;
    if (slow) {
      if (this.resScale > 0.62) {
        this.resScale = Math.max(0.6, this.resScale - 0.1);
        this.resize();
      } else if (this.tierName !== 'low') {
        this.setTier(this.tierName === 'high' ? 'mid' : 'low');
        this.resScale = 0.85;
        this.resize();
      }
    } else if (fast && this.resScale < 1) {
      this.resScale = Math.min(1, this.resScale + 0.05);
      this.resize();
    }
  }

  // ======================================================================= UI・入力の結線
  bindUI() {
    const ui = this.ui;
    const s = this.settings;
    $('btnStart').onclick = () => this.startNew();
    $('btnContinue').onclick = () => this.continueGame();
    $('btnSettings').onclick = () => this.openSettings();
    $('btnPause').onclick = () => this.togglePause();
    $('pResume').onclick = () => this.resumePlay();
    $('pSettings').onclick = () => this.openSettings();
    $('pTitle').onclick = () => this.toTitle();
    $('sBack').onclick = () => this.closeSettings();
    $('sFull').onclick = () => this.toggleFullscreen();
    $('sReset').onclick = () => {
      if (confirm('セーブデータを削除しますか？')) {
        clearSave();
        ui.showTitle(true, false);
      }
    };
    $('btnPhone').onclick = () => {
      this.audio.play('ui');
      ui.openPhone(this.clockLabel());
      this.input.setEnabled(false);
      this.input.unlockPointer();
    };
    $('phoneClose').onclick = () => {
      ui.closePhone();
      this.input.setEnabled(true);
      this.input.lockPointer();
    };
    $('banner').onclick = () => $('btnPhone').click();
    $('btnFlash').onclick = () => this.setFlashlight(!this.flashOn);
    $('interactBtn').onclick = () => this.interactCenter();
    $('viewClose').onclick = () => this.exitView();
    $('eTitle').onclick = () => this.toTitle(true);
    $('eAgain').onclick = () => this.startNew();

    ui.onChoiceOpen = () => {
      this.input.setEnabled(false);
      this.input.unlockPointer();
    };
    ui.onChoiceClose = () => {
      this.input.setEnabled(true);
      this.input.lockPointer();
    };
    ui.onExamineOpen = ui.onChoiceOpen;
    ui.onExamineClose = ui.onChoiceClose;

    // 設定UI
    const bind = (id, key, ev = 'input', conv = (v) => v) => {
      const el = $(id);
      if (el.type === 'checkbox') el.checked = !!s[key];
      else el.value = s[key];
      el.addEventListener('change', () => {
        s[key] = el.type === 'checkbox' ? el.checked : conv(el.value);
        this.applySettings();
        writeSettings(s);
      });
      if (el.type === 'range')
        el.addEventListener('input', () => {
          s[key] = conv(el.value);
          this.applySettings();
        });
    };
    bind('sMaster', 'master', 'input', parseFloat);
    bind('sAmb', 'amb', 'input', parseFloat);
    bind('sSfx', 'sfx', 'input', parseFloat);
    bind('sSens', 'sens', 'input', parseFloat);
    bind('sQuality', 'quality');
    bind('sFlicker', 'reduceFlicker');
    bind('sHaptic', 'haptic');
    bind('sInvertY', 'invertY');
    $('sQuality').addEventListener('change', () => {
      const q = this.settings.quality;
      this.resScale = 1;
      if (q === 'auto') this.setTier(this.pickInitialTier());
      else this.setTier(q);
    });
  }

  bindInput() {
    const inp = this.input;
    inp.onTap = (x, y, kind) => this.onTap(x, y, kind);
    inp.onTouchDetected = () => {
      if (this.running) this.input.showTouchHints(true);
      this.resize();
    };
    inp.onUnlock = () => {
      if (this.running && !this.overlayOpen && this.mode === 'play') this.pause();
    };
    inp.onKey = (code) => {
      if (this.mode === 'title') {
        return;
      }
      if (code === 'Escape' || code === 'KeyP') {
        if (this.ui.examineOpen) return this.ui.el.examine.querySelector('.ex-close').click();
        if (this.ui.phoneOpen) return $('phoneClose').click();
        if (this.view) return this.exitView();
        if (!this.ui.el.settings.classList.contains('hidden')) return this.closeSettings();
        if (this.paused) return this.resumePlay();
        if (this.mode === 'play') return this.pause();
        return;
      }
      if (!this.running || this.paused) return;
      if (code === 'KeyE' || code === 'Space' || code === 'Enter') {
        if (this.ui.choiceOpen) return;
        this.interactCenter();
      } else if (code === 'KeyF') {
        if (this.S.flags.hasFlash) this.setFlashlight(!this.flashOn);
      } else if (code === 'KeyM') {
        $('btnPhone').click();
      } else if (code === 'Digit1') this.ui.choiceKey(0);
      else if (code === 'Digit2') this.ui.choiceKey(1);
    };
    window.addEventListener('keydown', (e) => {
      if (this.ui.choiceOpen && (e.code === 'Digit1' || e.code === 'Digit2')) this.ui.choiceKey(e.code === 'Digit1' ? 0 : 1);
    });
  }

  applySettings() {
    const s = this.settings;
    this.audio.setVolumes({ master: s.master, amb: s.amb, sfx: s.sfx });
    this.input.sens = s.sens;
    this.input.invertY = s.invertY;
    this.ui.vibrate = s.haptic;
    this.ui.reduceFlicker = !!s.reduceFlicker;
    document.body.classList.toggle('noflicker', !!s.reduceFlicker);
    if (this.world) this.world.reduceFlicker = !!s.reduceFlicker;
  }

  openSettings() {
    this.ui.show(this.ui.el.settings, true);
    this.prevPausedForSettings = this.paused;
    this.audio.start();
    this.input.setEnabled(false);
  }
  closeSettings() {
    writeSettings(this.settings);
    this.ui.show(this.ui.el.settings, false);
    if (this.mode === 'play' && !this.paused && !this.overlayOpenExceptSettings()) this.input.setEnabled(true);
  }
  overlayOpenExceptSettings() {
    return this.ui.examineOpen || this.ui.choiceOpen || this.ui.phoneOpen || !!this.view;
  }

  toggleFullscreen() {
    const el = document.documentElement;
    try {
      if (!document.fullscreenElement) (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el);
      else (document.exitFullscreen || document.webkitExitFullscreen)?.call(document);
    } catch (e) {}
  }

  onVisibility() {
    if (document.hidden) {
      this.save();
      if (this.mode === 'play' && !this.paused) this.pause();
      this.audio.suspend();
    } else {
      this.audio.resume();
    }
  }

  // ======================================================================= 開始・再開・終了
  async startNew() {
    this.tryImmersive();
    clearSave();
    this.S = newState();
    this.ui.messages = [];
    this.ui.unread = 0;
    this.ui.updateBadge();
    await this.beginSession(false);
  }

  /** Androidなどでは全画面＋横固定を試みる（iPhone Safariは非対応なので何もしない）*/
  tryImmersive() {
    try {
      if (!this.input.isTouch) return;
      const el = document.documentElement;
      const req = el.requestFullscreen || el.webkitRequestFullscreen;
      if (req && !document.fullscreenElement) {
        const p = req.call(el);
        p?.then?.(() => screen.orientation?.lock?.('landscape')?.catch?.(() => {}))?.catch?.(() => {});
      }
    } catch (e) {}
  }

  async continueGame() {
    this.tryImmersive();
    const sv = loadSave();
    if (!sv) return this.startNew();
    const S = newState();
    Object.assign(S, sv);
    S.world = { ...defaultWorldState(), ...sv.world };
    S.log = makeLog(sv.log);
    S.flags = sv.flags || {};
    S.decisions = sv.decisions || {};
    S.mutations = sv.mutations || [];
    S.act = S.entries || 0;
    this.S = S;
    this.ui.messages = (sv.messages || []).map((m) => ({ ...m, unread: false }));
    this.ui.unread = 0;
    this.ui.updateBadge();
    await this.beginSession(true);
  }

  async beginSession(resume) {
    const ui = this.ui;
    this.audio.start();
    this.applySettings();
    this.audio.resume();
    ui.hideEnding();
    ui.el.fade.style.opacity = '1';
    ui.showTitle(false);
    ui.showHUD(true);
    this.input.showTouchHints(this.input.isTouch);
    const ch = $('ctrlHint');
    if (this.input.isTouch && !resume) {
      ch.classList.remove('hidden');
      ch.style.animation = 'none';
      void ch.offsetWidth;
      ch.style.animation = '';
      setTimeout(() => ch.classList.add('hidden'), 8200);
    } else ch.classList.add('hidden');
    this.setupAudioSources();
    this.fadeColor = 'black';
    this.view = null;
    this.paused = false;
    this.player.frozen = false;
    this.player.lookTween = null;
    this._applied = {};
    this.timers.length = 0;
    this.director = new Director(this);
    this.hallShadow.visible = false;
    this.setFlashlight(false);
    ui.el.btnFlash.classList.toggle('hidden', !this.S.flags.hasFlash);
    this.running = true;
    this.mode = 'play';
    this.input.setEnabled(true);
    this.input.lockPointer();
    if (resume) this.director.resumeFrom();
    else this.director.beginNew();
    this.apply({ instant: true });
    await sleep(120);
    await ui.fade(0, 2400);
    this.autoSaveT = 0;
  }

  setupAudioSources() {
    const a = this.audio;
    if (!a.ready || a.hums.cor) return;
    a.addHum('cor', { kind: 'fluor', x: 0, y: 2.3, z: -0.9, base: 0.1 });
    a.addHum('hall', { kind: 'led', x: 0, y: 2.3, z: 2.0, base: 0.07 });
    a.addHum('ldk', { kind: 'fluor', x: -1.35, y: 2.3, z: 5.9, base: 0.07 });
    a.addHum('bed', { kind: 'led', x: 2.35, y: 2.3, z: 4.75, base: 0.04 });
    a.addHum('fan', { kind: 'fan', x: -1.25, y: 2.3, z: 2.9, base: 0.06 });
    a.addFridge(-3.2, 0.9, 4.0);
  }

  toTitle(fromEnding = false) {
    this.save();
    this.running = false;
    this.mode = 'title';
    this.ui.show(this.ui.el.pause, false);
    this.ui.show(this.ui.el.settings, false);
    this.ui.hideEnding();
    this.ui.showHUD(false);
    this.input.showTouchHints(false);
    this.input.setEnabled(false);
    this.input.unlockPointer();
    this.audio.silence(0.1, 1);
    this.paused = false;
    this.S = newState();
    this.apply({ instant: true });
    this.ui.el.fade.style.opacity = '0';
    this.setFlashlight(false);
    const sv = loadSave();
    this.ui.showTitle(true, !!sv && sv.phase !== 'ending');
  }

  finishGame(kind) {
    const S = this.S;
    this.settings.endings = this.settings.endings || {};
    this.settings.endings[kind] = true;
    writeSettings(this.settings);
    clearSave();
    const lines = endingLines(kind, S.trust);
    const stats = this.statsHtml(kind);
    this.ui.showHUD(false);
    this.ui.playEnding(lines, stats);
    this.running = false;
    this.mode = 'ending';
  }

  statsHtml(kind) {
    const S = this.S;
    const log = S.log;
    const NAMES = {
      photo: '家族写真', clock: '時計', tv: 'テレビ', fridge: '冷蔵庫', window: '窓', bed: 'ベッド', bath: '浴槽', mirror: '鏡', mug: 'マグカップ', shoes: '靴', keys: '鍵',
      calendar: 'カレンダー', closet: 'クローゼット', drawing: '子どもの絵', toy: 'ぬいぐるみ', sofa: 'ソファ', table: '食卓', chair: '椅子', coffee: 'コーヒーメーカー', alarm: '目覚まし時計',
      mail: '郵便物', phone: '固定電話', toilet: 'トイレ', door: 'ドア',
    };
    const score = {};
    for (const [k, v] of Object.entries(log.gaze)) score[k] = (score[k] || 0) + v;
    const top = Object.entries(score)
      .filter(([k]) => NAMES[k] && k !== 'door')
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    const topHtml = top.length ? top.map(([k, v]) => `<span class="em">${NAMES[k]}</span>（${Math.round(v)}秒）`).join('　') : '—';
    const trust = Object.values(S.decisions).filter((v) => v === 'trust').length;
    const doubt = Object.values(S.decisions).filter((v) => v === 'doubt').length;
    const targeted = (log.targeted || []).map((k) => NAMES[k]).filter(Boolean);
    const inspectN = log.totalInspect;
    const lights = Object.values(log.lights).reduce((a, b) => a + b, 0);
    return `
      <h3>この部屋が観察していたあなた</h3>
      最も長く見つめたもの：${topHtml}<br>
      記憶を信じた回数：<span class="em">${trust}</span>　疑った回数：<span class="em">${doubt}</span><br>
      調べた回数：${inspectN}　照明を触った回数：${lights}<br>
      ${targeted.length ? `あなたの視線に応えて現れたもの：${targeted.join('、')}<br>` : ''}
      プレイ時間：${fmtTime(S.playSec)}<br>
      <br><span style="color:#9c9a92">体験版はここまでです。遊んでくれてありがとうございました。<br>${kind === 'accept' ? '結末：ただいま' : '結末：見なかったこと'}</span>`;
  }

  // ======================================================================= 一時停止
  pause() {
    if (this.paused || this.mode !== 'play') return;
    this.paused = true;
    this.ui.show(this.ui.el.pause, true);
    this.input.setEnabled(false);
    this.input.unlockPointer();
    this.save();
  }
  resumePlay() {
    this.ui.show(this.ui.el.pause, false);
    this.ui.show(this.ui.el.settings, false);
    this.paused = false;
    this.input.setEnabled(true);
    this.input.lockPointer();
    this.audio.resume();
  }
  togglePause() {
    if (this.paused) this.resumePlay();
    else this.pause();
  }

  // ======================================================================= セーブ
  save() {
    if (!this.running || this.mode !== 'play') return;
    const S = this.S;
    if (S.phase === 'ending') return;
    const p = this.player.pos;
    writeSave({
      phase: S.phase,
      phaseT: S.phaseT,
      playSec: S.playSec,
      clock: S.clock,
      entries: S.entries,
      flags: S.flags,
      world: S.world,
      memory: S.memory,
      decisions: S.decisions,
      trust: S.trust,
      log: S.log,
      mutations: S.mutations,
      messages: this.ui.messages.slice(0, 30).map((m) => ({ ...m, unread: false })),
      pos: { x: p.x, z: p.z, yaw: this.player.yaw },
    });
  }

  // ======================================================================= タイマー
  after(sec, fn) {
    this.timers.push({ t: sec, fn });
  }
  sleep(sec) {
    return new Promise((res) => this.after(sec, res));
  }

  // ======================================================================= 独白
  say(lines, { gap = 0.3, ms } = {}) {
    const id = ++this._sayId;
    const arr = Array.isArray(lines) ? lines.filter(Boolean) : [lines];
    return (async () => {
      for (let i = 0; i < arr.length; i++) {
        if (this._sayId !== id) return;
        const d = this.ui.say(arr[i], ms);
        await this.sleep(d / 1000 + gap);
      }
    })();
  }

  examine(opts) {
    this.audio.play('ui');
    return this.ui.examine(opts);
  }

  apply(opts = {}) {
    applyState(this, opts);
  }

  setTV(mode) {
    this.S.world.tv = mode;
    setTV(this, mode);
    this.audio.play('click', {});
  }

  setFlashlight(on) {
    this.flashOn = !!on;
    this.world.lFlash.intensity = on ? 34 : 0;
    $('btnFlash').classList.toggle('on', !!on);
    if (this.audio.ready) this.audio.play('click', {});
  }

  clockLabel() {
    const m = Math.floor(this.S.clock);
    return `${Math.floor((m / 60) % 24)}:${String(m % 60).padStart(2, '0')}`;
  }

  // ======================================================================= 視界
  inView(pos, margin = 0.1) {
    const v = pos.clone().project(this.camera);
    if (v.z > 1) return false;
    return Math.abs(v.x) < 1 + margin && Math.abs(v.y) < 1 + margin;
  }

  /** 視界の端に一瞬だけ現れて、見ようとすると消える人影 */
  flickerShadow() {
    const w = this.world;
    const sh = this.hallShadow;
    // LDKにいて、廊下の奥を見ていないとき
    const P = this.player.pos;
    const dz = w.hallDz;
    const pos = new THREE.Vector3(0, 0, 3.0 + dz * 0.5);
    if (this.inView(new THREE.Vector3(0, 1.0, pos.z), 0.0)) return false;
    sh.position.copy(pos);
    sh.rotation.y = Math.PI; // こちらを向く
    sh.visible = true;
    sh.userData.mat.opacity = 1;
    this.audio.play('creak', { x: 0, y: 0.3, z: pos.z, gain: 0.7 });
    const t0 = this.time;
    let seen = 0;
    const tick = () => {
      if (!sh.visible) return;
      const dt = this.time - t0;
      if (this.inView(new THREE.Vector3(0, 1.0, pos.z), -0.2)) seen += 1;
      if (seen > 3 || dt > 4.5) {
        sh.visible = false;
        return;
      }
      requestAnimationFrame(tick);
    };
    tick();
    return true;
  }

  mirrorGhost(sec) {
    this.mirrorT = sec;
  }

  // ======================================================================= ドア音
  onDoorSound(e) {
    const a = this.audio;
    if (!a.ready) return;
    const p = e.pos;
    const o = { x: p.x, y: p.y, z: p.z };
    if (e.sound === 'steel') a.play(e.kind === 'open' ? 'steelOpen' : 'steelDoor', o);
    else if (e.sound === 'fridge') a.play('fridgeOpen', o);
    else if (e.kind === 'open') a.play('door', { ...o, long: this.S.phase === 'act3' });
    else a.play('doorShut', o);
  }

  // ======================================================================= インタラクト
  pickAt(sx, sy, maxDist = 9) {
    const cam = this.camera;
    const rc = (this._rc ||= new THREE.Raycaster());
    const ndc = new THREE.Vector2((sx / window.innerWidth) * 2 - 1, -(sy / window.innerHeight) * 2 + 1);
    rc.setFromCamera(ndc, cam);
    rc.far = maxDist;
    const hits = rc.intersectObjects(this.world.picks, true);
    for (const h of hits) {
      // 非表示は除外
      let o = h.object;
      let vis = true;
      let it = null;
      while (o) {
        if (!o.visible) {
          vis = false;
          break;
        }
        if (!it && o.userData && o.userData.it) it = o.userData.it;
        o = o.parent;
      }
      if (!vis || !it) continue;
      // 壁・家具による遮蔽
      const camPos = cam.position;
      if (this.blockedBetween(camPos, h.point)) return null;
      return { it, hit: h, dist: h.distance };
    }
    return null;
  }

  blockedBetween(a, b) {
    for (const c of this.world.colliders) {
      if (!c.on) continue;
      // 目標点がコライダ内部（家具そのもの）なら除外
      const m = 0.14;
      if (b.x > c.x0 - m && b.x < c.x1 + m && b.z > c.z0 - m && b.z < c.z1 + m && b.y < (c.y1 ?? 2.6) + 0.2) continue;
      if (a.x > c.x0 && a.x < c.x1 && a.z > c.z0 && a.z < c.z1) continue;
      if (segHitsBox(a, b, c)) return true;
    }
    return false;
  }

  interactCenter() {
    if (this.overlayOpen || !this.running || this.player.frozen) return;
    const r = this.pickAt(window.innerWidth / 2, window.innerHeight / 2, 8);
    if (r && r.dist <= (r.it.dist || 2.2)) this.interact(r.it);
  }

  onTap(x, y, kind) {
    if (!this.running || this.overlayOpen || this.player.frozen || this.mode !== 'play') return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    let r = null;
    if (kind === 'center') r = this.pickAt(W / 2, H / 2, 8);
    else {
      r = this.pickAt(x, y, 8);
      if (!r) {
        // タップのずれを許容：周囲を探索
        const rad = Math.min(W, H) * 0.045;
        for (const [dx, dy] of [
          [rad, 0],
          [-rad, 0],
          [0, rad],
          [0, -rad],
        ]) {
          r = this.pickAt(x + dx, y + dy, 8);
          if (r) break;
        }
      }
    }
    if (!r) return;
    const lim = r.it.dist || 2.2;
    if (r.dist <= lim) this.interact(r.it);
    else if (this.time - this._lastFar > 3) {
      this._lastFar = this.time;
      this.say('もう少し近づこう。', { ms: 1600 });
    }
  }

  interact(it) {
    if (this.time - this._lastInteract < 0.35) return;
    this._lastInteract = this.time;
    this.log.inspect(it.tag || 'misc', it.id);
    this.input.look.dx = this.input.look.dy = 0;
    // 特殊ケース
    if (it.id === 'frontDoor') return this.director.onFrontDoor();
    if (it.id === 'elevCall') {
      this.audio.play('click');
      return this.say('呼出ボタンは点灯している。……もう、ここに来ているはずなのに。');
    }
    if (it.id === 'elevDoor') {
      return this.say(this.S.world.elevator ? 'エレベーターのかごは、空だ。明かりだけが、ついている。' : 'エレベーターの扉。静かだ。');
    }
    if (it.id === 'elevPanel') return this.director.useElevatorPanel();
    if (it.id === 'directory') {
      return this.say(['館内案内。6、5、3、2、1。', '……4階が、載っていない。']);
    }
    if (it.id === 'fireDoor') {
      this.audio.play('knob', { x: -9.8, y: 1, z: -0.9 });
      return this.say('非常階段へのドア。鍵がかかっている。');
    }
    if (it.id === 'nameplate') return this.say('表札は、空白だ。……越してきたばかりだからだ。たぶん。');
    if (it.id && it.id.startsWith('neighbor')) {
      const no = it.id.slice(8);
      if (no === '403') return this.say('403号室。さっきまで聞こえていたテレビの音が、消えている。');
      if (no === '405') return this.say('405号室。表札はない。郵便受けにチラシが溢れている。');
      return this.say(`${no}号室。静かだ。`);
    }
    const h = H[it.id] || null;
    if (h) return h(this, it);
    if (it.door && this.world.doors[it.door]) return this.useDoor(it.door);
    const t = H[it.tag];
    if (t) return t(this, it);
    return H.default(this, it);
  }

  useDoor(id) {
    const d = this.world.doors[id];
    if (!d) return;
    d.toggle();
    this.log.doors[id] = (this.log.doors[id] || 0) + 1;
    if (id === 'bed') this.S.world.bedDoor = d.target > 0.5 ? 2 : 0;
  }

  // ======================================================================= インターホン・覗き穴
  enterView(kind) {
    const cam = this.feedCam;
    cam.position.set(0, 1.5, -0.09);
    cam.rotation.set(-0.04, 0, 0);
    cam.fov = 92;
    cam.updateProjectionMatrix();
    this.view = { kind, cam };
    this.input.setEnabled(false);
    this.input.unlockPointer();
    this.ui.showView('intercom', '● 玄関カメラ  CH-1');
    this.ui.hideBanner();
    this.audio.play('click');
    // 第3幕：玄関前に人影が立つ
    this.intercomShadow.visible = !!(this.S.flags.intercomFigure && this.S.phase === 'act3');
    if (this.S.phase === 'act3') {
      this.audio.play('stepsAbove', { x: 0, y: 1, z: -0.8, n: 3, gap: 0.8, gain: 0.5 });
    }
  }

  exitView() {
    if (!this.view) return;
    this.view = null;
    this.ui.hideView();
    this.intercomShadow.visible = false;
    this.input.setEnabled(true);
    this.input.lockPointer();
    this.audio.play('click');
  }

  // ======================================================================= ゾーン判定
  computeZone() {
    const { x, z } = this.player.pos;
    const dz = this.world.hallDz;
    if (z < 0.05) return 'cor';
    if (Math.abs(x) <= 0.95 && z < 1.4) return 'genkan';
    if (x > -2.75 && x < -1.0 && z > 1.4 && z < 3.35) return 'bath';
    if (x > 1.0 && x < 2.15 && z > 1.4 && z < 2.6) return 'toilet';
    if (Math.abs(x) <= 0.95 && z < 3.55 + dz) return 'hall';
    if (x > 0.95 && z > 2.7 + dz) return 'bed';
    if (z >= 3.55 + dz) return 'ldk';
    return 'hall';
  }

  // ======================================================================= メインループ
  loop(now) {
    requestAnimationFrame((t) => this.loop(t));
    const dtMs = Math.min(100, now - this.last);
    this.last = now;
    let dt = dtMs / 1000;
    if (this.mode === 'title') {
      this.updateTitle(dt);
      this.adaptQuality(dtMs);
      this.render(dt);
      return;
    }
    if (this.portrait && this.input.isTouch) dt = 0;
    dt *= this.timeScale || 1;
    if (this.paused) {
      this.render(0);
      return;
    }
    if (this.mode === 'ending') {
      this.time += dt;
      this.world.update(dt, this.time, this.player.pos);
      tickWorld(this, dt, this.time);
      this.render(dt);
      return;
    }
    this.time += dt;
    this.adaptQuality(dtMs);
    this.update(dt);
    this.render(dt);
  }

  updateTitle(dt) {
    this.titleT += dt;
    this.time += dt;
    const t = this.titleT;
    const cam = this.camera;
    // 玄関前をゆっくり歩み寄る
    const k = (Math.sin(t * 0.12) + 1) / 2;
    cam.position.set(Math.sin(t * 0.07) * 0.22, 1.5 + Math.sin(t * 0.5) * 0.004, -1.5 + k * 0.1);
    cam.rotation.set(-0.02, Math.PI + Math.sin(t * 0.09) * 0.05, 0);
    this.player.pos.set(0, 0, -1.0);
    this.world.update(dt, this.time, { x: 0, z: -1 });
    // ときどき点滅
    if (Math.random() < dt * 0.15 && !this.settings.reduceFlicker) this.world.corridorFixtures[3].burst(0.5, 0.8);
    tickWorld(this, dt, this.time);
    this.tuneVisuals(dt, 'cor', 0.15);
  }

  update(dt) {
    const S = this.S;
    const player = this.player;
    // タイマー
    for (let i = this.timers.length - 1; i >= 0; i--) {
      const tm = this.timers[i];
      tm.t -= dt;
      if (tm.t <= 0) {
        this.timers.splice(i, 1);
        try {
          tm.fn();
        } catch (e) {
          console.error(e);
        }
      }
    }
    const frozen = this.overlayOpen || !!this.view;
    player.frozen = frozen || this.mode !== 'play';
    const inp = this.input.poll();
    if (this.view) {
      inp.mx = inp.my = inp.lx = inp.ly = 0;
    }
    // 振り返り検出
    const prevYaw = player.yaw;
    player.update(dt, inp, this.world, this.director.tension);
    const turn = Math.abs(((player.yaw - prevYaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
    if (dt > 0 && turn / dt > 4.5) this._turnAcc = (this._turnAcc || 0) + turn;
    else this._turnAcc = Math.max(0, (this._turnAcc || 0) - dt * 1.5);
    if (this._turnAcc > 2.4) {
      this._turnAcc = 0;
      this.log.lookBacks++;
    }
    player.applyCamera();
    this.zone = this.computeZone();

    player.pos.zone = this.zone;
    this.world.update(dt, this.time, player.pos);
    tickWorld(this, dt, this.time);
    this.director.update(dt);
    this.updateGaze(dt);
    this.updateTicks(dt);
    this.updateAudio(dt);
    this.updateMirror(dt);

    // 自動保存
    this.autoSaveT = (this.autoSaveT || 0) + dt;
    if (this.autoSaveT > 20) {
      this.autoSaveT = 0;
      if (!this.director.busy) this.save();
    }
  }

  updateGaze(dt) {
    this._pickT -= dt;
    if (this._pickT > 0) return;
    this._pickT = 0.12;
    if (this.overlayOpen || this.player.frozen) {
      this.ui.setTarget(null);
      return;
    }
    const r = this.pickAt(window.innerWidth / 2, window.innerHeight / 2, 8);
    // UI（手の届く範囲のみ）
    if (r && r.dist <= (r.it.dist || 2.2)) this.ui.setTarget({ name: r.it.name, verb: this.verbFor(r.it) });
    else this.ui.setTarget(null);
    // 視線ログ
    const key = r ? r.it.id : null;
    if (r && r.dist < 7) {
      const tag = r.it.tag;
      this.log.gaze[tag] = (this.log.gaze[tag] || 0) + 0.12;
      this.log.gazeId[r.it.id] = (this.log.gazeId[r.it.id] || 0) + 0.12;
      if (this.gazeNow && this.gazeNow.id === r.it.id) this.gazeHold += 0.12;
      else this.gazeHold = 0;
      this.gazeNow = { tag, id: r.it.id, dist: r.dist };
    } else {
      this.gazeNow = null;
      this.gazeHold = 0;
    }
  }

  verbFor(it) {
    if (it.tag === 'door' || it.door) return '開閉';
    if (it.tag === 'switch') return '押す';
    if (it.id === 'intercom') return '見る';
    if (it.id === 'figure') return '近づく';
    return '調べる';
  }

  // 時計の音
  updateTicks(dt) {
    this._tickT = (this._tickT || 0) - dt;
    if (this._tickT > 0) return;
    this._tickT = 1;
    const c = this.world.props.clock.pos;
    const P = this.player.pos;
    const dz = this.world.hallDz;
    const d = Math.hypot(P.x - c.x, P.z - (c.z + dz));
    if (d < 9 && this.S.world.clockMode !== 'stop404') {
      this._alt = !this._alt;
      this.audio.tick(c.x, c.y, c.z + dz, false, this._alt);
    } else if (this.S.world.clockMode === 'stop404' && Math.random() < 0.18) {
      this.audio.tick(c.x, c.y, c.z + dz, true, false);
    }
  }

  updateMirror(dt) {
    const g = this.world.props.mirrorGhost;
    if (!g) return;
    let target = 0;
    if (this.mirrorT > 0) {
      this.mirrorT -= dt;
      // 浴室にいて、鏡の方を向いているときに濃くなる
      const P = this.player.pos;
      const near = this.zone === 'bath';
      target = near ? 0.55 + Math.sin(this.time * 7) * 0.08 : 0.0;
    }
    g.material.opacity = damp(g.material.opacity, target, 3, dt);
  }

  updateAudio(dt) {
    const a = this.audio;
    if (!a.ready) return;
    const p = this.player;
    const w = this.world;
    const P = p.pos;
    const f = w.fx;
    // 音源の動的更新
    const dz = w.hallDz;
    const h = a.hums;
    if (h.cor) {
      let best = w.corridorFixtures[0];
      for (const c of w.corridorFixtures) if (Math.abs(c.pos.x - P.x) < Math.abs(best.pos.x - P.x)) best = c;
      a.moveSpatial(h.cor.sp, best.pos.x, 2.3, -0.9);
      h.cor.setLevel(best.f);
      h.hall.setLevel(f.hall.f);
      h.ldk.setLevel(f.ldk.f);
      h.bed.setLevel(f.bed.f);
      h.fan.setLevel(Math.max(f.bath.f, f.toilet.f * 0.6));
      if (h.ldk.sp.z !== 5.9 + dz) {
        a.moveSpatial(h.ldk.sp, -1.35, 2.3, 5.9 + dz);
        a.moveSpatial(h.bed.sp, 2.35, 2.3, 4.75 + dz);
        if (h.fridge) a.moveSpatial(h.fridge.sp, -3.2, 0.9, 4.0 + dz);
      }
    }
    const zoneAudio = this.zone === 'cor' ? 'cor' : this.zone === 'hall' || this.zone === 'genkan' ? 'hall' : 'apt';
    const doorOpen = w.doors.front.t > 0.2;
    a.update(dt, { x: P.x, y: p.eyeY, z: P.z, yaw: p.yaw }, { zone: zoneAudio, doorOpen, tension: this.director.tension }, w);
  }

  // ======================================================================= 描画
  tuneVisuals(dt, zone, tension) {
    const post = this.post;
    const u = post.uni;
    const reduce = this.settings.reduceFlicker;
    const inCor = zone === 'cor';
    const blackout = !this.S.world.power;
    // フォグ
    const fogTarget = inCor ? 0.055 : blackout ? 0.05 : 0.016 + tension * 0.012;
    this.fog.d = damp(this.fog.d, fogTarget, 1.2, dt);
    const fc = inCor ? new THREE.Color(0x161d28) : new THREE.Color(0x0b0b0d);
    this.fog.c.lerp(fc, 1 - Math.exp(-dt * 1.5));
    this.scene.fog.density = this.fog.d;
    this.scene.fog.color.copy(this.fog.c);
    // ポスト
    const ex = inCor ? 1.3 : blackout ? 1.8 : 1.3;
    u.uExposure.value = damp(u.uExposure.value, ex, 2, dt);
    u.uVig.value = 0.5 + tension * 0.35;
    u.uGrain.value = 0.045 + tension * 0.035;
    u.uCA.value = 0.0009 + tension * 0.0013;
    u.uSat.value = 0.9 - tension * 0.2;
    u.uBloom.value = this.tier.bloom ? (reduce ? 0.16 : 0.34) : 0;
    u.uDistort.value = tension > 0.8 ? 0.06 : 0.0;
    u.uWarp.value = damp(u.uWarp.value, this.audio.ready && this.audio.duck < 0.2 ? 0.6 : 0, 2.5, dt);
    u.uFadeColor.value.set(this.fadeColor === 'white' ? 0xffffff : 0x000000);
  }

  render(dt) {
    const cam = this.view ? this.view.cam : this.camera;
    const post = this.post;
    const tension = this.mode === 'play' ? this.director.tension : 0.1;
    const zone = this.mode === 'title' ? 'cor' : this.zone;
    if (this.mode !== 'title') this.tuneVisuals(dt, zone, tension);
    post.uni.uMode.value = this.view ? 1 : 0;
    if (this.view) {
      // インターホンのカメラ：廊下ライトを玄関前に固定
      this.world.corridorFixtures.forEach((c) => (c.on = true));
    }
    // 影はLDKがある室内でだけ更新（最初の数フレームは必ず描く）
    this._shadowFrames = (this._shadowFrames || 0) + 1;
    this.renderer.shadowMap.autoUpdate = false;
    this.renderer.shadowMap.needsUpdate = this.tier.shadow > 0 && (this._shadowFrames < 4 || (this.mode !== 'title' && this.zone !== 'cor'));
    this.renderer.info.reset();
    post.render(this.scene, cam, this.time);
  }

  // ======================================================================= デバッグ
  exposeDebug() {
    window.__game = this;
    window.__dbg = {
      teleport: (x, z, yaw = 0, pitch = 0) => this.player.teleport(x, z, yaw, pitch),
      interactId: (id) => {
        const o = this.world.picks.find((p) => p.userData.it && p.userData.it.id === id);
        if (!o) return 'missing ' + id;
        this._lastInteract = -9;
        this.interact(o.userData.it);
        return 'ok';
      },
      speed: (k) => (this.timeScale = k),
      drawList: () => {
        const cam = this.camera;
        cam.updateMatrixWorld(true);
        const fr = new THREE.Frustum().setFromProjectionMatrix(new THREE.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
        const out = {};
        let total = 0;
        this.scene.traverse((o) => {
          if (!(o.isMesh || o.isSprite || o.isPoints || o.isLine)) return;
          let v = true;
          for (let p = o; p; p = p.parent) if (!p.visible) v = false;
          if (!v) return;
          if (o.frustumCulled !== false && !fr.intersectsObject(o)) return;
          const m = Array.isArray(o.material) ? o.material[0] : o.material;
          const key = (o.parent && o.parent.name ? o.parent.name : o.parent && o.parent.type) + ' | ' + (m && m.name ? m.name : m ? m.type : '?') + (o.isSprite ? ' [sprite]' : '') + (m && m.transparent ? ' [T]' : '');
          out[key] = (out[key] || 0) + 1;
          total++;
        });
        const arr = Object.entries(out).sort((a, b) => b[1] - a[1]).slice(0, 40);
        return { total, top: arr };
      },
      info: () => ({ calls: this.renderer.info.render.calls, tris: this.renderer.info.render.triangles, geos: this.renderer.info.memory.geometries, tex: this.renderer.info.memory.textures, tier: this.tierName, scale: this.resScale, ft: this.ftAvg }),
    };
  }
}
