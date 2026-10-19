// ディレクター：物語進行・行動ログに基づく怪奇現象の選択・緊張度・静寂の管理
import * as THREE from 'three';
import { clamp, rand, pick, damp, lerp, TAU } from './util.js';
import { NOTIF, HINT, endingLines } from './story.js';
import { AJAR } from './state.js';

const IGNORE_TAGS = new Set(['door', 'switch', 'sign', 'elevator', 'intercom', 'breaker', 'figure', 'umbrella', 'coat', 'plant', 'ac', 'toilet', 'washer', 'kitchen', 'sink', 'drawing_', 'bag']);

export class Director {
  constructor(game) {
    this.g = game;
    this.tension = 0;
    this.tensionTarget = 0;
    this.runId = 0;
    this.eventT = 20;
    this.cool = 0;
    this.targetQueue = [];
    this.zone = 'cor';
    this.prevInApt = false;
    this.inApt = false;
    this.noticed = {};
    this.doorHold = 0;
    this.busy = false; // スクリプト進行中（イベント抑制）
    this.beatT = 0;
    this.heartT = 0;
    this._noticeT = 0;
    this._bellT = 0;
    this.act1Anomaly = false;
    this.nearDoorT = 0;
    this.tripT = 0;
    this.flashOn = false;
  }

  get S() {
    return this.g.S;
  }
  get W() {
    return this.g.S.world;
  }

  // ====================================================================== 進行の開始
  beginNew() {
    const S = this.S;
    S.phase = 'prologue';
    S.phaseT = 0;
    this.g.player.teleport(0, -0.95, Math.PI);
    this.g.apply({ instant: true });
    this.prevInApt = false;
    this.runId++;
    this.g.after(2.8, () => this.g.say(['23時47分。', '終電を逃して、タクシーで帰ってきた。'], { gap: 0.6 }));
    this.g.after(9, () => this.g.ui.objective(HINT.door));
    this.setTension(0.08);
  }

  /** セーブからの再開 */
  resumeFrom() {
    const S = this.S;
    const g = this.g;
    this.runId++;
    g.apply({ instant: true });
    const ph = S.phase;
    this.prevInApt = false;
    if (ph === 'prologue' || ph === 'trip1' || ph === 'trip2') {
      g.player.teleport(0, -0.95, Math.PI);
      if (ph === 'trip1') this.startTripBeats(1, true);
      if (ph === 'trip2') this.startTripBeats(2, true);
      g.ui.objective(ph === 'prologue' ? HINT.door : HINT.corridor);
    } else {
      // 室内の入口
      g.player.teleport(0.1, 0.55, Math.PI);
      g.world.doors.front.setInstant(0);
      S.flags.figureTalk = false;
      this.prevInApt = true;
      this.inApt = true;
      if (ph === 'blackout') {
        this.beginBlackoutState(true);
      }
    }
    this.setTension(this.phaseTension());
    g.after(1.2, () => g.say('……ここまで、来ていた。'));
  }

  phaseTension() {
    return { prologue: 0.08, act1: 0.1, trip1: 0.3, act2: 0.32, trip2: 0.5, act3: 0.58, blackout: 0.9, finale: 0.72, ending: 0.3 }[this.S.phase] ?? 0.1;
  }
  setTension(v) {
    this.tensionTarget = v;
  }

  // ====================================================================== 毎フレーム
  update(dt) {
    const g = this.g;
    const S = this.S;
    const P = g.player.pos;
    this.zone = g.zone;
    const inApt = P.z > 0.2;
    this.inApt = inApt;
    S.phaseT += dt;
    S.playSec += dt;
    S.clock += dt / 28;

    // 緊張度
    this.tension = damp(this.tension, this.tensionTarget, 0.6, dt);
    if (this.tension > 0.6) {
      this.heartT -= dt;
      if (this.heartT < 0) {
        this.heartT = lerp(1.6, 0.8, (this.tension - 0.6) / 0.4);
        g.audio.play('heartbeat', { gain: 0.25 + (this.tension - 0.6) * 0.7 });
      }
    }

    // 敷居の通過
    if (inApt !== this.prevInApt) {
      if (inApt) this.onEnterApartment();
      else this.onLeaveApartment();
      this.prevInApt = inApt;
    }

    // 部屋の滞在時間
    const zn = this.zone;
    S.log.rooms[zn] = (S.log.rooms[zn] || 0) + dt;

    this.doorCloser(dt);

    // 変化に気づく
    this._noticeT -= dt;
    if (this._noticeT < 0) {
      this._noticeT = 0.35;
      this.checkNotice();
    }

    switch (S.phase) {
      case 'act1':
        this.updateAct1(dt);
        break;
      case 'trip1':
      case 'trip2':
        this.tripT += dt;
        this.updateTrip(dt);
        break;
      case 'act2':
        this.updateAct2(dt);
        break;
      case 'act3':
        this.updateAct3(dt);
        break;
      case 'blackout':
        this.updateBlackout(dt);
        break;
      case 'finale':
        this.updateFinale(dt);
        break;
    }
  }

  // ====================================================================== 玄関ドアのクローザー
  doorCloser(dt) {
    const g = this.g;
    const d = g.world.doors.front;
    const P = g.player.pos;
    if (d.target > 0.5) {
      const trip = this.S.phase === 'trip1' || this.S.phase === 'trip2';
      // 廊下イベント中は、敷居の上に立っていない限り、ドアは閉まる（世界を書き換えるため）
      const inDoorway = trip ? Math.abs(P.x) < 0.6 && P.z > -0.75 && P.z < 1.0 : Math.abs(P.x) < 0.95 && P.z > -1.25 && P.z < 1.35;
      this.doorHold = inDoorway ? 0 : this.doorHold + dt;
      if (this.doorHold > 3.2) {
        d.close(0.38);
        this.doorHold = 0;
      }
    } else this.doorHold = 0;

    // 閉まったあと、外にいるなら世界を更新
    const S = this.S;
    if (d.t === 0 && P.z < -0.5) {
      if (S.phase === 'trip1' && !S.flags.m1) this.applyMutation(1);
      if (S.phase === 'trip2' && !S.flags.m2) this.applyMutation(2);
    }
  }

  /** 玄関ドアの使用 */
  onFrontDoor() {
    const g = this.g;
    const S = this.S;
    const d = g.world.doors.front;
    const P = g.player.pos;
    const outside = P.z < 0;
    if (S.phase === 'prologue' && !S.flags.unlocked) {
      S.flags.unlocked = true;
      g.audio.play('unlock', { x: 0, y: 1.1, z: -0.1 });
      g.ui.objective('');
      g.after(0.8, () => g.ui.notify(NOTIF.lock));
      g.after(1.2, () => d.open(1, 1.0));
      g.after(3.0, () => g.say('……ただいま。', { ms: 3000 }));
      return true;
    }
    if (S.phase === 'blackout' && !S.flags.breakerDone) {
      g.audio.play('knob', { x: 0, y: 1, z: 0.2 });
      g.say('ドアノブが、回らない。……ブレーカーを上げないと。');
      return true;
    }
    if ((S.phase === 'trip1' && !S.flags.tripDone1) || (S.phase === 'trip2' && !S.flags.tripDone2)) {
      if (outside) {
        g.audio.play('knob', { x: 0, y: 1, z: -0.2 });
        g.say(['ドアが、開かない。', '……まだ、外にいるべきなのかもしれない。']);
        this.hintCorridor();
        return true;
      }
    }
    if (S.phase === 'finale' && !outside && S.flags.figureTalk !== true) {
      // 玄関から出る＝見なかったことにする
      if (d.target < 0.5) d.open(1, 1.2);
      return true;
    }
    d.toggle();
    g.log.doors.front = (g.log.doors.front || 0) + 1;
    return true;
  }

  hintCorridor() {
    this.g.ui.objective(HINT.corridor, 6000);
  }

  // ====================================================================== 敷居イベント
  onEnterApartment() {
    const g = this.g;
    const S = this.S;
    if (S.phase === 'prologue') {
      S.phase = 'act1';
      S.phaseT = 0;
      S.entries = 1;
      S.act = 1;
      S.flags.entered1 = true;
      this.setTension(0.1);
      g.ui.objective('');
      g.after(3.5, () => g.say(['いつもと変わらない部屋。', '今日は、疲れた。']));
      g.after(10, () => {
        if (!this.W.ldkLight && S.phase === 'act1') g.ui.objective(HINT.light, 12000);
      });
      g.save();
    } else if (S.phase === 'trip1' && S.flags.m1) {
      this.beginAct2();
    } else if (S.phase === 'trip2' && S.flags.m2) {
      this.beginAct3();
    } else if (S.phase === 'finale' || S.phase === 'act1' || S.phase === 'act2' || S.phase === 'act3') {
      // 再入場（廊下に出て戻った）
    }
  }

  onLeaveApartment() {
    const g = this.g;
    const S = this.S;
    this.doorHold = 0;
    if (S.phase === 'act1' && S.flags.bell) {
      S.phase = 'trip1';
      S.phaseT = 0;
      this.tripT = 0;
      S.flags.tripDone1 = false;
      this.snapshotMemory();
      this.setTension(0.3);
      this.startTripBeats(1);
      g.ui.objective('');
      g.save();
    } else if (S.phase === 'act2' && S.flags.summoned) {
      S.phase = 'trip2';
      S.phaseT = 0;
      this.tripT = 0;
      S.flags.tripDone2 = false;
      this.snapshotMemory();
      this.setTension(0.5);
      this.startTripBeats(2);
      g.ui.objective('');
      g.save();
    } else if (S.phase === 'finale') {
      this.endGame('deny');
    }
  }

  /** プレイヤーの「記憶」＝部屋を出る時点の状態 */
  snapshotMemory() {
    const w = this.W;
    this.S.memory = JSON.parse(JSON.stringify(w));
    this.S.memory.bedDoorOpen = this.g.world.doors.bed.target > 0.5;
  }

  // ====================================================================== ACT 1
  updateAct1(dt) {
    const g = this.g;
    const S = this.S;
    const t = S.phaseT;
    const inspected = g.log.totalInspect;
    // 小さな違和感（一度だけ）：冷蔵庫の音が止まる
    if (!this.act1Anomaly && t > 55 && this.zone === 'ldk') {
      this.act1Anomaly = true;
      g.audio.silence(5.5, 0.02);
      g.audio.hums.fridge && g.audio.hums.fridge.setLevel(0);
      g.after(5.4, () => g.audio.hums.fridge && g.audio.hums.fridge.setLevel(1));
    }
    // インターホン
    if (!S.flags.bell && this.inApt && !this.g.overlayOpen && ((g.log.rooms.ldk > 14 && ((inspected >= 4 && t > 75) || t > 150)) || t > 260)) {
      this.ringBell();
    }
    if (!S.flags.bell && t > 130 && (g.log.rooms.ldk || 0) < 5 && !this._ldkHint) {
      this._ldkHint = true;
      g.ui.objective('リビングの様子を見る', 9000);
    }
    if (S.flags.bell && !S.flags.intercomSeen && t > S.flags.bellAt + 18) {
      if (!this._bellHint) {
        this._bellHint = true;
        g.ui.objective(HINT.bell);
      }
    }
  }

  ringBell() {
    const g = this.g;
    const S = this.S;
    S.flags.bell = true;
    S.flags.bellAt = S.phaseT;
    this.W.intercomOn = true;
    g.apply();
    g.audio.play('chime', { x: 0.88, y: 1.4, z: 1.0 });
    g.ui.buzz([40]);
    this.setTension(0.22);
    g.after(4.5, () => g.say('……こんな時間に、誰だ。'));
  }

  useIntercom() {
    const g = this.g;
    const S = this.S;
    g.audio.play('click', {});
    if (!this.W.intercomOn) {
      g.say('インターホンの画面は、消えている。', 2600);
      return;
    }
    S.flags.intercomSeen = true;
    g.ui.objective('');
    g.enterView('intercom');
    g.after(0.1, () => {});
    // 玄関の外を見るよう促す
    if (S.phase === 'act1') g.after(6, () => g.ui.objective(HINT.outside));
    if (S.phase === 'act3') S.flags.intercomFigure = true;
  }

  // ====================================================================== TRIP（共用廊下）
  startTripBeats(n, resumed = false) {
    const g = this.g;
    const w = g.world;
    const id = ++this.runId;
    const alive = () => this.runId === id;
    const S = this.S;
    if (n === 1) {
      (async () => {
        await g.sleep(resumed ? 0.5 : 2.4);
        if (!alive()) return;
        w.corridorFixtures[3].burst(1.1, 0.9);
        g.audio.play('stepsAbove', { x: -9.7, y: 1, z: -0.9, n: 6, gap: 0.55, gain: 1.3 });
        await g.sleep(3.6);
        if (!alive()) return;
        g.audio.play('knob', { x: -9.8, y: 1, z: -0.9 });
        w.unitWindows[1].userData.setLit(0.0);
        await g.sleep(5);
        if (!alive()) return;
        this.elevatorArrive();
        await g.sleep(14);
        if (!alive()) return;
        this.elevatorLeave();
        await g.sleep(5);
        if (!alive()) return;
        S.flags.tripDone1 = true;
        g.ui.objective('玄関のドアを開ける', 8000);
      })();
    } else {
      this.W.footprints = 1;
      this.W.watcherN = true;
      g.apply();
      (async () => {
        await g.sleep(resumed ? 0.5 : 2.0);
        if (!alive()) return;
        g.audio.play('gust', { gain: 0.8 });
        w.corridorFixtures.forEach((f) => f.burst(1.4, 0.7));
        await g.sleep(5);
        if (!alive()) return;
        // 足跡の先へ誘う
        this.elevatorArrive(true);
        g.ui.objective('足跡をたどる', 9000);
        await g.sleep(60);
        if (!alive()) return;
        S.flags.tripDone2 = true;
      })();
    }
  }

  elevatorArrive(silent = false) {
    const g = this.g;
    const w = g.world;
    g.audio.play('ding', { x: 10, y: 1.6, z: -0.9, gain: 1.1 });
    g.audio.play('slide', { x: 10, y: 1.4, z: -0.9 });
    const el = w.elevator;
    const t0 = performance.now();
    this.W.elevator = 1;
    const anim = () => {
      const k = clamp((performance.now() - t0) / 1600, 0, 1);
      el.setOpen(k);
      if (k < 1) requestAnimationFrame(anim);
    };
    anim();
    el.indicator.userData.setText('4');
    el.led.material.color.setRGB(0.1, 0.1, 0.1);
  }

  elevatorLeave() {
    const g = this.g;
    const w = g.world;
    const el = w.elevator;
    const t0 = performance.now();
    this.W.elevator = 0;
    g.audio.play('slide', { x: 10, y: 1.4, z: -0.9 });
    const anim = () => {
      const k = clamp((performance.now() - t0) / 1600, 0, 1);
      el.setOpen(1 - k);
      if (k < 1) requestAnimationFrame(anim);
      else {
        g.audio.play('elevator', { x: 10, y: 1.4, z: -0.9, gain: 0.8 });
        ['3', '2', '1'].forEach((n, i) => setTimeout(() => el.indicator.userData.setText(n), 1500 + i * 1300));
      }
    };
    anim();
  }

  updateTrip(dt) {
    const g = this.g;
    const S = this.S;
    const P = g.player.pos;
    // 室内に戻ってしまった場合は、外へ向かうよう促す
    if (this.inApt && this.tripT > 35 && !this._tripHint) {
      this._tripHint = true;
      g.ui.objective('玄関の外を確認する', 9000);
    }
    if (!this.inApt) this._tripHint = false;
    if (S.phase === 'trip2') {
      // 足跡が玄関へ続く（フェードイン）→ 到達でエレベーターの扉が開く
      if (!S.flags.elevPanelDone && P.x > 6.4 && !S.flags.elevClosing) {
        // 乗り場に近づくと、扉が静かに開く
      }
    }
    if (S.phase === 'trip1' && this.tripT > 40 && !S.flags.tripDone1 && P.x > 4) {
      // 十分に歩いた
    }
  }

  async useElevatorPanel() {
    const g = this.g;
    const S = this.S;
    if (S.flags.elevPanelDone) {
      g.say('「4」のボタンは、やはり、ない。');
      return;
    }
    S.flags.elevPanelDone = true;
    g.log.inspect('elevator', 'elevPanel');
    await g.say(['階数ボタンは、1、2、3、5、6。', '……「4」だけが、ない。'], { gap: 0.5 });
    g.after(4.6, () => g.say(['ここは、何階なんだ。', 'どうやって、ここまで来たんだっけ。'], { gap: 0.6 }));
    if (S.phase === 'trip2') {
      g.after(9, () => {
        S.flags.tripDone2 = true;
        g.ui.objective('玄関のドアを開ける', 8000);
        this.elevatorLeave();
      });
    }
  }

  // ====================================================================== 変化の適用
  /** 部屋に戻る前の変化。ログと「判断」に基づく */
  applyMutation(n) {
    const g = this.g;
    const S = this.S;
    const w = this.W;
    const dec = S.decisions;
    const mem = S.memory || w;
    const trust = (k) => dec[k] === 'trust';
    const doubt = (k) => dec[k] === 'doubt';
    S.flags['m' + n] = true;
    S.mutations.push(n);
    if (n === 1) {
      w.mugs = 3;
      w.photo = 1;
      w.shoes = 1;
      w.bedDoor = mem.bedDoorOpen ? 0 : 1;
      w.chairB = 1;
      w.calendar = 1;
      w.fridgeNote = 1;
      w.drawing = 0;
      w.hallLight = true;
      w.tv = 'off';
    } else if (n === 2) {
      // 「信じた」項目は世界が元に戻る（記憶のほうを疑わせる）／「疑った」項目は悪化する
      w.mugs = trust('mugs') ? 1 : 7;
      w.photo = trust('photo') ? 0 : 2;
      w.shoes = trust('shoes') ? 0 : 3;
      w.bedDoor = trust('bedDoor') ? 0 : 2;
      w.chairA = 1;
      w.chairB = 2;
      w.calendar = 2;
      w.fridgeNote = 2;
      w.drawing = trust('photo') ? 1 : 2;
      w.mail = 1;
      w.hallDz = 1.05;
      w.closet = 1;
      w.toy = 1;
      w.hallLight = true;
      w.steam = true;
      w.incense = false;
      w.footprints = 2;
      w.curtain = 0.5;
      // 信じた人には、別の違和感を足す（元に戻したうえで、さらに）
      if (trust('mugs') || trust('photo') || trust('shoes') || trust('bedDoor')) {
        S.flags.gaslit = true;
        w.fridgeMugs = true;
      }
      this.applyTargeted(2);
    }
    // 記録（エンディング用）
    g.apply();
    g.save();
  }

  /** 行動ログから、最もよく見つめた/調べた対象を選ぶ */
  topTags(limit = 2) {
    const log = this.S.log;
    const score = {};
    for (const [k, v] of Object.entries(log.gaze)) score[k] = (score[k] || 0) + v;
    for (const [k, v] of Object.entries(log.inspected)) score[k] = (score[k] || 0) + v * 7;
    const tags = Object.entries(score)
      .filter(([k]) => !IGNORE_TAGS.has(k) && TARGETS[k])
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
    const fallback = ['clock', 'window', 'bed', 'photo'];
    for (const f of fallback) if (!tags.includes(f)) tags.push(f);
    return tags.slice(0, limit);
  }

  /** 入室時にあらかじめ仕込む「見つめたものに関係する怪異」*/
  applyTargeted(n) {
    const w = this.W;
    const tags = this.topTags(n === 2 ? 2 : 3);
    this.S.log.targeted = this.S.log.targeted || [];
    // 「信じた」項目は世界のほうが元に戻る。同じ対象を見つめていても、その世界は上書きしない（怪異は後から別の形で起きる）
    const decKey = { mug: 'mugs', coffee: 'mugs', photo: 'photo', shoes: 'shoes', keys: 'shoes' };
    tags.forEach((t) => {
      const T = TARGETS[t];
      if (!T) return;
      if (!(decKey[t] && this.S.decisions[decKey[t]] === 'trust')) T.mutate?.(w, this.S);
      this.S.log.targeted.push(t);
    });
    this.targetQueue = tags.slice();
  }

  // ====================================================================== ACT 2
  beginAct2() {
    const g = this.g;
    const S = this.S;
    S.phase = 'act2';
    S.phaseT = 0;
    S.entries = 2;
    S.act = 2;
    this.eventT = 26;
    this.cool = 6;
    this.setTension(0.32);
    this.noticed = {};
    this.targetQueue = this.topTags(1);
    g.ui.objective('');
    g.after(5.5, () => {
      g.ui.notify(NOTIF.count7);
      g.audio.play('buzz', {});
    });
    g.after(11, () => g.say(['7回……？', '今日は、一度しか、帰っていないはずだ。'], { gap: 0.5 }));
    g.after(40, () => {
      g.ui.notify(NOTIF.mother);
      g.audio.play('buzz', { gain: 0.6 });
    });
    g.save();
  }

  updateAct2(dt) {
    const g = this.g;
    const S = this.S;
    const t = S.phaseT;
    this.runEvents(dt, { min: 16, max: 28 });
    // 美咲からのメッセージ
    if (t > 75 && !S.flags.misaki1) {
      S.flags.misaki1 = true;
      g.ui.notify(NOTIF.misaki1);
      g.audio.play('buzz', { gain: 0.7 });
      this.setTension(0.4);
    }
    // 呼び出し：玄関
    const decs = Object.keys(S.decisions).length;
    if (!S.flags.summoned && t > 70 && (decs >= 2 || t > 190) && this.inApt && !g.overlayOpen && this.zone !== 'cor') {
      this.summonDoor();
    }
    if (S.flags.summoned && !S.flags.hint2 && S.phaseT > (S.flags.summonedAt || 0) + 45) {
      S.flags.hint2 = true;
      g.ui.objective(HINT.keys, 9000);
    }
    if (S.flags.summoned && !S.flags.doorSwung) {
      const P = g.player.pos;
      const d = Math.hypot(P.x, P.z - 0.4);
      if (d < 2.2 && P.z < 2.2 && g.inView(new THREE.Vector3(0, 1.0, 0.1), 0.3)) {
        S.flags.doorSwung = true;
        g.world.doors.front.open(1, 0.55);
        g.ui.objective(HINT.outside);
        w_gust(g);
      }
    }
  }

  async summonDoor() {
    const g = this.g;
    const S = this.S;
    S.flags.summoned = true;
    S.flags.summonedAt = S.phaseT;
    this.busy = true;
    const id = ++this.runId;
    g.audio.silence(4.5, 0.03);
    this.setTension(0.62);
    await g.sleep(2.4);
    if (this.runId !== id) return;
    g.audio.play('keys', { x: 0, y: 1.1, z: -0.2, gain: 1.2 });
    await g.sleep(1.6);
    g.audio.play('knob', { x: 0, y: 1.0, z: 0.1, gain: 1.3 });
    await g.sleep(1.2);
    g.audio.play('knob', { x: 0, y: 1.0, z: 0.1, gain: 1.3 });
    await g.sleep(1.4);
    g.audio.play('unlock', { x: 0, y: 1.1, z: -0.1, gain: 1.3 });
    await g.sleep(0.6);
    g.world.fx.hall.burst(1.0, 0.85);
    g.world.doors.front.open(AJAR, 0.6);
    g.audio.play('gust', { x: 0, y: 1.2, z: -0.5 });
    g.ui.objective(HINT.keys, 9000);
    this.busy = false;
  }

  // ====================================================================== ACT 3
  beginAct3() {
    const g = this.g;
    const S = this.S;
    S.phase = 'act3';
    S.phaseT = 0;
    S.entries = 3;
    S.act = 3;
    this.eventT = 14;
    this.cool = 4;
    this.noticed = {};
    this.setTension(0.58);
    g.ui.objective('');
    g.after(4, () => {
      g.ui.notify(NOTIF.count14);
      g.audio.play('buzz', {});
    });
    g.after(9, () => g.say(['……廊下が、長い。', 'こんなに、奥行きがあっただろうか。'], { gap: 0.6 }));
    g.after(50, () => {
      g.ui.notify(NOTIF.misaki2);
      g.audio.play('buzz', { gain: 0.7 });
    });
    g.save();
  }

  updateAct3(dt) {
    const g = this.g;
    const S = this.S;
    const t = S.phaseT;
    this.runEvents(dt, { min: 11, max: 19, act3: true });
    if (t > 95 && !S.flags.mgmt) {
      S.flags.mgmt = true;
      g.ui.notify(NOTIF.mgmt);
      g.audio.play('buzz', { gain: 0.8 });
    }
    if (!S.flags.blackoutPlanned && t > 80 && S.flags.eventsDone >= 3 && this.inApt && !g.overlayOpen && (this.zone === 'ldk' || this.zone === 'hall')) {
      S.flags.blackoutPlanned = true;
      this.startBlackout();
    }
    if (!S.flags.blackoutPlanned && t > 170 && this.inApt && !g.overlayOpen) {
      S.flags.blackoutPlanned = true;
      this.startBlackout();
    }
  }

  async startBlackout() {
    const g = this.g;
    const S = this.S;
    const id = ++this.runId;
    this.busy = true;
    S.phase = 'blackout';
    S.phaseT = 0;
    this.setTension(0.9);
    g.audio.silence(7, 0.0);
    g.audio.hums.fridge?.setLevel(0);
    await g.sleep(3.5);
    if (this.runId !== id) return;
    for (const k of ['hall', 'ldk', 'bed', 'bath', 'toilet']) g.world.fx[k].burst(1.5, 1.0);
    g.audio.play('powerDown', { gain: 1.2 });
    await g.sleep(1.3);
    this.W.power = false;
    this.W.tv = 'off';
    g.apply();
    g.audio.play('thud', { x: -3.2, y: 1, z: 4 });
    this.beginBlackoutState();
    this.busy = false;
  }

  beginBlackoutState(resumed = false) {
    const g = this.g;
    const S = this.S;
    this.W.power = false;
    g.apply({ instant: true });
    g.setFlashlight(true);
    g.ui.el.btnFlash.classList.remove('hidden');
    S.flags.hasFlash = true;
    g.after(resumed ? 1 : 2.5, () => g.say(['停電……？', '携帯のライトで、足元を照らす。'], { gap: 0.5 }));
    g.after(resumed ? 5 : 11, () => g.ui.objective(HINT.breaker));
    this.eventT = 99;
  }

  updateBlackout(dt) {
    const g = this.g;
    const S = this.S;
    // 暗闇での小さな音
    this.beatT -= dt;
    if (this.beatT < 0) {
      this.beatT = rand(7, 13);
      const r = Math.random();
      const P = g.player.pos;
      const a = Math.random() * TAU;
      const x = P.x + Math.cos(a) * 3;
      const z = P.z + Math.sin(a) * 3;
      if (r < 0.35) g.audio.play('creak', { x, y: 0.3, z });
      else if (r < 0.6) g.audio.play('drip', { x, y: 1, z });
      else if (r < 0.8) g.audio.play('stepsAbove', { x, y: 1, z, n: 3, gap: 0.8, gain: 0.8 });
      else g.audio.play('breath', { x, y: 1.2, z, n: 1 });
    }
  }

  useBreaker() {
    const g = this.g;
    const S = this.S;
    const b = g.world.props.breaker;
    g.audio.play('click', {});
    if (S.phase !== 'blackout') {
      g.say('分電盤。ブレーカーは、すべて上がっている。', 2800);
      return;
    }
    if (S.flags.breakerDone) return;
    S.flags.breakerDone = true;
    g.ui.objective('');
    // 扉を開けてレバーを上げる
    const t0 = performance.now();
    const anim = () => {
      const k = clamp((performance.now() - t0) / 700, 0, 1);
      b.doorPivot.rotation.y = -k * 1.8;
      if (k < 1) requestAnimationFrame(anim);
    };
    anim();
    g.audio.play('breaker', { x: 0.85, y: 1.8, z: 0.55 });
    g.after(0.9, () => {
      b.main.position.y = -0.08 + 0.05;
      g.audio.play('breaker', { x: 0.85, y: 1.8, z: 0.55, gain: 1.3 });
    });
    g.after(1.8, () => this.startFinale());
  }

  // ====================================================================== FINALE
  async startFinale() {
    const g = this.g;
    const S = this.S;
    const id = ++this.runId;
    S.phase = 'finale';
    S.phaseT = 0;
    this.setTension(0.74);
    const w = this.W;
    // 世界の最終状態
    w.power = true;
    w.hallLight = true;
    w.ldkLight = true;
    w.bedLight = false;
    w.bathLight = false;
    w.toiletLight = false;
    w.lamp = false;
    w.mugs = 7;
    w.steam = true;
    w.photo = 3;
    w.calendar = 2;
    w.mail = 1;
    w.incense = true;
    w.figure = true;
    w.tv = 'static';
    w.shoes = 3;
    w.chairA = 0;
    w.chairB = 0;
    w.curtain = 0.6;
    w.fridgeNote = 3;
    w.hallDz = 1.05;
    w.watcherS = false;
    w.bedDoor = 2;
    w.footprints = 2;
    w.fridgeMugs = false;
    g.setFlashlight(false);
    g.apply();
    for (const k of ['hall', 'ldk']) g.world.fx[k].burst(1.2, 0.8);
    g.audio.play('switch', { x: 0, y: 1.2, z: 1 });
    g.ui.notify(NOTIF.count49);
    g.audio.play('buzz', { gain: 0.8 });
    // 静かに、ハミングとオルゴール
    g.after(6, () => g.audio.play('hum', { x: -1.62, y: 1.2, z: 4.6 + g.world.hallDz, gain: 1.0 }));
    g.after(18, () => g.audio.play('musicbox', { x: 3.0, y: 0.6, z: 3.2 + g.world.hallDz, gain: 0.8 }));
    g.after(4, () => g.say(['……誰か、いる。'], { ms: 3200 }));
    g.after(16, () => g.ui.objective('食卓のほうへ'));
    this.eventT = 99;
    g.save();
  }

  updateFinale(dt) {
    const g = this.g;
    const S = this.S;
    const P = g.player.pos;
    this.beatT -= dt;
    if (this.beatT < 0) {
      this.beatT = rand(9, 15);
      g.audio.play(pick(['breath', 'creak', 'drip']), { x: -1.6, y: 1.0, z: 4.5 + g.world.hallDz, gain: 0.7 });
    }
    // 人影に近づいたら、時計が遅くなる等の気配
    if (!S.flags.figureNear && P.z > 3.8 + g.world.hallDz && Math.hypot(P.x + 1.62, P.z - (4.58 + g.world.hallDz)) < 2.0) {
      S.flags.figureNear = true;
      g.audio.silence(3, 0.05);
      this.setTension(0.82);
      g.ui.objective('');
    }
  }

  async useFigure() {
    const g = this.g;
    const S = this.S;
    if (S.phase !== 'finale') {
      g.say('……誰もいない。', 2000);
      return;
    }
    S.flags.figureTalk = true;
    g.player.lookAtPoint(-1.62, 1.1, 4.58 + g.world.hallDz, 0.9);
    g.say(['長い髪の後ろ姿。', '卓上には、七つのマグカップ。', 'その向かいの椅子は、空いている。'], { gap: 0.6 });
    await g.sleep(5.6);
    const v = await g.ui.choice('声をかけますか。', [
      { label: '「……ただいま」と言う', value: 'accept' },
      { label: '何も言わず、離れる', value: 'deny' },
    ]);
    if (v === 'accept') this.endGame('accept');
    else {
      S.flags.figureTalk = false;
      g.say('……見なかったことにしよう。', 3000);
      g.ui.objective('玄関へ');
    }
  }

  onPhotoMemorial() {
    const g = this.g;
    const S = this.S;
    if (!S.flags.memorialSeen) {
      S.flags.memorialSeen = true;
      g.after(1.0, () => g.say(['写っているのは、自分だ。', 'ずっと、ここにいたのは——']));
    }
  }

  // ====================================================================== 判断への反応
  onDecision(key, v) {
    const S = this.S;
    this.setTension(clamp(this.tensionTarget + 0.06, 0, 0.8));
    S.log.lastDecisionAt = S.playSec;
  }

  // ====================================================================== 気づき（変化を見つめた時の独白）
  checkNotice() {
    const g = this.g;
    const S = this.S;
    if (S.phase !== 'act2' && S.phase !== 'act3') return;
    if (g.overlayOpen) return;
    const w = this.W;
    const gz = g.gazeNow; // {tag,id,dist}
    if (!gz) return;
    const key = gz.id;
    const hold = g.gazeHold;
    if (hold < 0.9) return;
    const say = (k, lines) => {
      if (this.noticed[k]) return;
      this.noticed[k] = true;
      g.say(lines, { gap: 0.5 });
    };
    if (gz.tag === 'mug' && w.mugs > 1) say('mug', 'マグカップが……増えている？');
    else if (gz.id === 'photo' && w.photo !== 0) say('photo', '写真の様子が、違う。');
    else if (gz.id === 'bedDoor' && w.bedDoor !== 0) say('bedDoor', '寝室のドアが、開いている。');
    else if (gz.id === 'bedDoor' && w.bedDoor === 0 && S.decisions.bedDoor === 'trust' && S.act >= 3) say('bedDoorBack', ['寝室のドアは、閉まっている。', '……あの隙間は、見間違いだったのか？']);
    else if (gz.tag === 'shoes' && w.shoes > 0) say('shoes', '玄関に、靴が……。');
    else if (gz.id === 'clock' && w.clockMode !== 'normal') say('clock', '時計の針が、おかしい。');
    else if (gz.id === 'drawing' && w.drawing !== 0) say('drawing', '娘の絵が、変わっている……？');
    else if (gz.id === 'calendar' && w.calendar >= 1) say('calendar', 'カレンダーに、見覚えのない印がある。');
    else if (gz.id === 'toy' && w.toy !== 0) say('toy', 'ぬいぐるみが、移動している。');
  }

  // ====================================================================== 怪奇現象（ライブイベント）
  runEvents(dt, { min, max, act3 = false }) {
    const g = this.g;
    if (this.busy || g.overlayOpen || g.player.frozen) return;
    this.eventT -= dt;
    if (this.cool > 0) this.cool -= dt;
    if (this.eventT > 0 || this.cool > 0) return;
    // 室内にいるときだけ
    if (!this.inApt) return;
    this.eventT = rand(min, max);
    // 一定確率で「何も起きない」（空振りの予兆）
    if (Math.random() < 0.22) {
      this.tease();
      return;
    }
    const S = this.S;
    let ev = null;
    // 見つめたものに関係する怪異を優先
    if (this.targetQueue.length && Math.random() < (act3 ? 0.75 : 0.45)) {
      const tag = this.targetQueue.shift();
      ev = TARGETS[tag]?.event;
      if (ev) S.log.targetedRun = (S.log.targetedRun || []).concat(tag);
    }
    if (!ev) ev = this.pickGeneric(act3);
    if (!ev) return;
    const big = LIVE[ev]?.big;
    const ok = LIVE[ev]?.run.call(this, g);
    if (ok === false) {
      this.eventT = 3;
      return;
    }
    S.flags.eventsDone = (S.flags.eventsDone || 0) + 1;
    S.log.events.push({ ev, t: Math.round(S.playSec) });
    this.cool = big ? rand(22, 34) : rand(8, 14);
    this.tensionTarget = clamp(this.phaseTension() + (big ? 0.12 : 0.04), 0, 0.95);
    setTimeout(() => (this.tensionTarget = this.phaseTension()), big ? 14000 : 7000);
  }

  tease() {
    const g = this.g;
    const r = Math.random();
    const P = g.player.pos;
    if (r < 0.4) g.audio.silence(rand(3, 5), 0.06);
    else if (r < 0.7) g.audio.play('creak', { x: P.x + rand(-3, 3), y: 0.3, z: P.z + rand(-3, 3), gain: 0.6 });
    else g.audio.play('gust', { x: P.x, y: 1, z: P.z - 2, gain: 0.35 });
    this.cool = rand(10, 16);
  }

  pickGeneric(act3) {
    const g = this.g;
    const S = this.S;
    const zn = this.zone;
    const done = (S.log.events || []).map((e) => e.ev);
    const cand = [];
    for (const [id, e] of Object.entries(LIVE)) {
      if (e.act3Only && !act3) continue;
      if (e.zones && !e.zones.includes(zn)) continue;
      if (e.cond && !e.cond.call(this, g)) continue;
      let wgt = e.w ?? 1;
      if (done.includes(id)) wgt *= 0.25;
      if (done.slice(-2).includes(id)) wgt = 0;
      if (wgt > 0) cand.push([id, wgt]);
    }
    if (!cand.length) return null;
    const total = cand.reduce((a, c) => a + c[1], 0);
    let r = Math.random() * total;
    for (const [id, wgt] of cand) {
      r -= wgt;
      if (r <= 0) return id;
    }
    return cand[0][0];
  }

  // ---------------------------------------------------------------- エンディング
  async endGame(kind) {
    const g = this.g;
    const S = this.S;
    if (S.phase === 'ending') return;
    S.phase = 'ending';
    this.busy = true;
    this.runId++;
    g.player.frozen = true;
    g.input.setEnabled(false);
    g.ui.objective('');
    g.ui.clearSay();
    if (kind === 'accept') {
      g.audio.silence(6, 0.0);
      g.ui.flash(2200);
      await g.ui.fade(1, 2600);
      g.fadeColor = 'white';
    } else {
      g.audio.play('steelDoor', { x: 0, y: 1, z: -0.1 });
      await g.ui.fade(1, 1800);
    }
    g.audio.play('buzz', { gain: 0.5 });
    g.finishGame(kind);
  }
}

function w_gust(g) {
  g.audio.play('gust', { x: 0, y: 1.2, z: -1, gain: 1.0 });
  g.world.fx.hall.burst(0.9, 0.6);
}

// ====================================================================== 見つめたものに対応する怪異
export const TARGETS = {
  photo: {
    event: 'photoEyes',
    mutate(w) {
      w.incense = true;
    },
  },
  clock: {
    event: 'clockStop',
    mutate(w) {
      w.clockMode = 'stop404';
    },
  },
  tv: {
    event: 'tvRoom',
    mutate(w) {
      w.tv = 'static';
    },
  },
  fridge: {
    event: 'fridgeOpen',
    mutate(w) {
      w.fridgeMugs = true;
      w.fridgeOpen = true;
    },
  },
  window: {
    event: 'windowFigure',
    mutate(w) {
      w.curtain = 1;
      w.watcherS = true;
    },
  },
  bed: {
    event: 'bedBreath',
    mutate(w) {
      w.bedBump = true;
    },
  },
  toy: {
    event: 'bedBreath',
    mutate(w) {
      w.toy = 2;
    },
  },
  alarm: {
    event: 'clockStop',
    mutate(w) {
      w.clockMode = 'stop404';
    },
  },
  bath: {
    event: 'bathMirror',
    mutate(w) {
      w.bathWater = true;
      w.bathLight = true;
    },
  },
  mirror: {
    event: 'bathMirror',
    mutate(w) {
      w.bathLight = true;
    },
  },
  mug: {
    event: 'mugSteam',
    mutate(w) {
      w.steam = true;
      w.mugs = 7;
    },
  },
  coffee: {
    event: 'mugSteam',
    mutate(w) {
      w.steam = true;
      w.mugs = Math.max(w.mugs, 5);
    },
  },
  shoes: {
    event: 'doorKnock',
    mutate(w) {
      w.shoes = 3;
      w.keysMissing = true;
    },
  },
  keys: {
    event: 'doorKnock',
    mutate(w) {
      w.keysMissing = true;
    },
  },
  closet: {
    event: 'closetKnock',
    mutate(w) {
      w.closet = 2;
    },
  },
  drawing: {
    event: 'drawingWhisper',
    mutate(w) {
      w.drawing = 3;
    },
  },
  calendar: {
    event: 'clockStop',
    mutate(w) {
      w.calendar = 2;
    },
  },
  sofa: {
    event: 'chairsTurn',
    mutate(w) {
      w.chairA = 2;
    },
  },
  table: {
    event: 'chairsTurn',
    mutate(w) {
      w.chairA = 2;
      w.chairB = 2;
    },
  },
  chair: {
    event: 'chairsTurn',
    mutate(w) {
      w.chairA = 2;
    },
  },
  phone: {
    event: 'phoneMsg',
    mutate() {},
  },
  mail: {
    event: 'phoneMsg',
    mutate(w) {
      w.mail = 1;
    },
  },
};

// ====================================================================== ライブイベント辞書
// run は Director を this として呼ばれる。false を返すと不成立。
export const LIVE = {
  knockWall: {
    w: 1.2,
    zones: ['ldk', 'hall', 'bed'],
    run(g) {
      const z = 4.9 + g.world.hallDz;
      g.audio.play('knock', { x: 1.0, y: 1.2, z, n: 3, gap: 0.34, gain: 1.1 });
    },
  },
  stepsAbove: {
    w: 1.1,
    run(g) {
      const P = g.player.pos;
      g.audio.play('stepsAbove', { x: P.x + 0.2, y: 3.4, z: P.z + 0.5, n: 7, gap: 0.62, gain: 1.4 });
    },
  },
  tvStatic: {
    w: 1.0,
    zones: ['ldk', 'hall'],
    cond(g) {
      return g.S.world.tv === 'off' && g.S.world.power;
    },
    run(g) {
      g.setTV('static');
      g.S.world.tv = 'static';
      g.audio.play('click', {});
      g.after(13, () => {
        if (g.S.phase !== 'finale') {
          g.setTV('off');
          g.S.world.tv = 'off';
        }
      });
      g.after(1.5, () => g.say('テレビが……勝手に。', { ms: 2400 }));
    },
    big: false,
  },
  drip: {
    w: 1.0,
    zones: ['ldk', 'hall', 'bath'],
    run(g) {
      for (let i = 0; i < 6; i++) g.after(i * rand(1.4, 2.2), () => g.audio.play('drip', { x: -2.4, y: 1.0, z: 3.9 + g.world.hallDz }));
    },
  },
  flush: {
    w: 0.9,
    zones: ['ldk', 'hall', 'bed'],
    run(g) {
      g.audio.play('flush', { x: 1.6, y: 1.0, z: 2.1 });
    },
  },
  curtainWind: {
    w: 1.0,
    zones: ['ldk'],
    cond(g) {
      return g.S.world.curtain < 0.3;
    },
    run(g) {
      g.S.world.curtain = 1;
      g.audio.play('gust', { x: -1.4, y: 1.3, z: 8 + g.world.hallDz, gain: 0.7 });
      g.after(9, () => {
        if (g.S.phase !== 'finale') g.S.world.curtain = g.S.phase === 'act3' ? 0.6 : 0.3;
      });
    },
  },
  lightBurst: {
    w: 1.3,
    run(g) {
      const k = { hall: 'hall', ldk: 'ldk', bed: 'bed', bath: 'bath', toilet: 'toilet' }[g.zone] || 'hall';
      g.world.fx[k].burst(1.6, 0.95);
      g.audio.play('click', {});
    },
  },
  silence: {
    w: 1.0,
    run(g) {
      g.audio.silence(rand(5, 8), 0.02);
    },
    big: true,
  },
  phoneMsg: {
    w: 0.8,
    cond(g) {
      return !g.S.flags.misaki3 && g.S.phase === 'act2';
    },
    run(g) {
      g.S.flags.misaki3 = true;
      g.ui.notify(NOTIF.misaki3);
      g.audio.play('buzz', { gain: 0.8 });
    },
  },
  clockStop: {
    w: 0.8,
    cond(g) {
      return g.S.world.clockMode === 'normal';
    },
    run(g) {
      g.S.world.clockMode = 'stop404';
      g.audio.silence(3, 0.05);
      g.after(1.0, () => g.audio.tick(-3.55, 1.95, 4.85 + g.world.hallDz, true));
      g.after(3.5, () => g.say('時計が、止まっている。……4時4分。', { ms: 3600 }));
    },
    big: true,
  },
  doorSwing: {
    w: 1.0,
    zones: ['ldk', 'hall'],
    cond(g) {
      return !g.inView(new THREE.Vector3(0.9, 1, 4.9 + g.world.hallDz), 0.0);
    },
    run(g) {
      const d = g.world.doors.bed;
      if (d.target > 0.5) {
        d.close(0.5);
        g.S.world.bedDoor = 0;
      } else {
        d.open(1, 0.4);
        g.S.world.bedDoor = 2;
      }
    },
    big: true,
  },
  fridgeOpen: {
    w: 0.8,
    zones: ['ldk', 'hall'],
    cond(g) {
      return g.world.doors.fridge.target < 0.1 && !g.inView(new THREE.Vector3(-3.2, 1, 4.3 + g.world.hallDz), 0.0);
    },
    run(g) {
      g.world.doors.fridge.open(1, 0.6);
      g.S.world.fridgeOpen = true;
      g.world.props.fridge.light.color.setScalar(2.4);
      g.audio.play('fridgeOpen', { x: -3.2, y: 1, z: 4.3 + g.world.hallDz, gain: 1.3 });
      g.audio.hums.fridge?.setLevel(0);
      g.after(14, () => {
        g.world.doors.fridge.close(0.8);
        g.S.world.fridgeOpen = false;
        g.world.props.fridge.light.color.setScalar(0);
        g.audio.hums.fridge?.setLevel(1);
      });
    },
    big: true,
  },
  windowFigure: {
    w: 0.9,
    zones: ['ldk', 'hall'],
    run(g) {
      g.S.world.watcherS = true;
      g.S.world.curtain = Math.max(g.S.world.curtain, 0.6);
      g.audio.play('gust', { x: -1.4, y: 1.3, z: 8 + g.world.hallDz, gain: 0.6 });
      g.after(16, () => {
        g.S.world.watcherS = false;
      });
    },
    big: true,
  },
  mirrorGhost: {
    w: 0.8,
    zones: ['hall'],
    run(g) {
      g.S.world.bathLight = true;
      g.audio.play('click', {});
      g.after(14, () => {
        g.S.world.bathLight = false;
      });
    },
  },
  musicBox: {
    w: 0.7,
    zones: ['hall', 'ldk'],
    run(g) {
      g.audio.play('musicbox', { x: 3.0, y: 0.6, z: 3.2 + g.world.hallDz, gain: 0.9 });
    },
    big: true,
  },
  humVoice: {
    w: 0.7,
    act3Only: true,
    zones: ['ldk', 'hall'],
    run(g) {
      g.audio.play('hum', { x: 2.0, y: 1.3, z: 6.4 + g.world.hallDz, gain: 0.9 });
    },
    big: true,
  },
  doorKnock: {
    w: 0,
    run(g) {
      g.audio.play('knock', { x: 0, y: 1.3, z: -0.2, n: 3, gap: 0.5, gain: 1.4 });
      g.S.world.keysMissing = true;
      g.after(2.0, () => g.say('玄関の外から、ノックの音。……誰も、いない。', { ms: 3600 }));
    },
    big: true,
  },
  hallShadow: {
    w: 1.0,
    zones: ['ldk'],
    cond(g) {
      return g.S.phase !== 'act1' && !g.world.props.shadowHall?.visible;
    },
    run(g) {
      return g.flickerShadow();
    },
    big: true,
  },
  bedBreath: {
    w: 0,
    run(g) {
      g.S.world.bedBump = true;
      g.audio.play('breath', { x: 3.0, y: 0.8, z: 3.9 + g.world.hallDz, n: 3, gain: 1.2 });
      g.after(12, () => {
        if (g.S.phase === 'act3') g.S.world.bedBump = false;
      });
    },
    big: true,
  },
  tvRoom: {
    w: 0,
    run(g) {
      g.setTV('room');
      g.S.world.tv = 'room';
      g.audio.play('click', {});
      g.after(10, () => {
        if (g.S.phase !== 'finale') {
          g.setTV('off');
          g.S.world.tv = 'off';
        }
      });
    },
    big: true,
  },
  bathMirror: {
    w: 0,
    run(g) {
      g.S.world.bathLight = true;
      g.S.world.bathWater = true;
      g.audio.play('water', { x: -2.3, y: 0.6, z: 2.3, dur: 8 });
      g.mirrorGhost(6);
    },
    big: true,
  },
  mugSteam: {
    w: 0,
    run(g) {
      g.S.world.steam = true;
      g.S.world.mugs = Math.max(g.S.world.mugs, 5);
      g.after(1.5, () => g.say('どのカップも、まだ温かい。', { ms: 3200 }));
    },
  },
  closetKnock: {
    w: 0,
    run(g) {
      g.S.world.closet = 2;
      g.audio.play('knock', { x: 2.4, y: 1.0, z: 6.4 + g.world.hallDz, n: 4, gap: 0.45, gain: 1.2 });
      g.after(3.5, () => g.audio.play('hum', { x: 2.4, y: 1.0, z: 6.5 + g.world.hallDz, gain: 0.9 }));
    },
    big: true,
  },
  drawingWhisper: {
    w: 0,
    run(g) {
      g.S.world.drawing = 3;
      g.audio.play('hum', { x: -0.8, y: 1.3, z: 3.0, gain: 0.8, notes: [523.3, 440, 392, 349.2] });
    },
    big: true,
  },
  chairsTurn: {
    w: 0,
    run(g) {
      g.S.world.chairA = 2;
      g.S.world.chairB = 2;
      g.audio.play('creak', { x: -1.6, y: 0.4, z: 5.2 + g.world.hallDz, gain: 1.1 });
    },
  },
  photoEyes: {
    w: 0,
    run(g) {
      g.S.world.incense = true;
      g.S.world.photo = 4;
      g.audio.play('hum', { x: -3.4, y: 1.2, z: 6.7 + g.world.hallDz, gain: 0.9 });
      g.after(5, () => {
        if (g.S.phase === 'act3') g.S.world.photo = g.S.decisions.photo === 'trust' ? 0 : 2;
      });
    },
    big: true,
  },
  intercomRing: {
    w: 0.8,
    act3Only: true,
    zones: ['ldk', 'hall'],
    run(g) {
      g.S.world.intercomOn = true;
      g.audio.play('chime', { x: 0.88, y: 1.4, z: 1.0 });
    },
    big: true,
  },
};
