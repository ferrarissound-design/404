// UI：DOMベースのHUD・メニュー・字幕・選択肢・通知・調査パネル・エンディング
import { sleep } from './util.js';

const $ = (id) => document.getElementById(id);

export class UI {
  constructor() {
    this.el = {
      hud: $('hud'),
      reticle: $('reticle'),
      interact: $('interactBtn'),
      subtitle: $('subtitle'),
      objective: $('objective'),
      btnPhone: $('btnPhone'),
      btnFlash: $('btnFlash'),
      btnPause: $('btnPause'),
      banner: $('banner'),
      phone: $('phone'),
      phoneList: $('phoneList'),
      phoneTime: $('phoneTime'),
      examine: $('examine'),
      exCanvas: $('exCanvas'),
      choice: $('choice'),
      fade: $('fade'),
      flash: $('flash'),
      title: $('title'),
      loading: $('loading'),
      pause: $('pause'),
      settings: $('settings'),
      ending: $('ending'),
      rotate: $('rotate'),
      viewfx: $('viewfx'),
    };
    this._subT = 0;
    this._bannerT = 0;
    this._objT = 0;
    this.messages = [];
    this.unread = 0;
    this.onPhoneOpen = null;
    this.vibrate = true;
    this._choiceResolve = null;
    this._subId = 0;
  }

  // ---- ロード・画面切替
  setLoading(p, sub = '') {
    this.el.loading.querySelector('.l-bar i').style.width = `${Math.round(p * 100)}%`;
    this.el.loading.querySelector('.l-sub').textContent = sub;
  }
  hideLoading() {
    const l = this.el.loading;
    l.style.transition = 'opacity 0.8s';
    l.style.opacity = '0';
    setTimeout(() => l.classList.add('hidden'), 850);
  }
  show(el, v = true) {
    el.classList.toggle('hidden', !v);
  }
  showTitle(v, hasSave = false) {
    this.show(this.el.title, v);
    $('btnContinue').classList.toggle('hidden', !hasSave);
  }
  showHUD(v) {
    this.show(this.el.hud, v);
  }
  showRotate(v) {
    this.show(this.el.rotate, v);
  }

  // ---- 振動
  buzz(pattern) {
    if (!this.vibrate) return;
    try {
      navigator.vibrate?.(pattern);
    } catch (e) {}
  }

  // ---- 字幕（独白）
  say(text, ms) {
    const el = this.el.subtitle;
    const id = ++this._subId;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._subT);
    const dur = ms ?? Math.max(2600, text.length * 150);
    this._subT = setTimeout(() => {
      if (id === this._subId) el.classList.remove('show');
    }, dur);
    return dur;
  }
  /** 複数行を順番に */
  async sayLines(lines, gap = 400) {
    const id = this._subId + 1;
    for (const l of lines) {
      const d = this.say(l);
      await sleep(d + gap);
      if (this._subId !== id + lines.indexOf(l)) {
        // 割り込まれた場合も続行
      }
    }
  }
  clearSay() {
    this.el.subtitle.classList.remove('show');
  }

  objective(text, ms = 0) {
    const el = this.el.objective;
    clearTimeout(this._objT);
    if (!text) {
      el.classList.remove('show');
      return;
    }
    el.textContent = text;
    el.classList.add('show');
    if (ms) this._objT = setTimeout(() => el.classList.remove('show'), ms);
  }

  // ---- インタラクトの案内
  setTarget(info) {
    const b = this.el.interact;
    const r = this.el.reticle;
    if (info) {
      r.classList.add('on');
      b.classList.remove('hidden');
      b.querySelector('.verb').textContent = info.verb || '調べる';
      b.querySelector('.obj').textContent = info.name || '';
    } else {
      r.classList.remove('on');
      b.classList.add('hidden');
    }
  }

  // ---- 通知・スマホ
  notify(msg, { silent = false } = {}) {
    // msg: {app, title, body, time, warn}
    this.messages.unshift({ ...msg, unread: true });
    this.unread++;
    this.updateBadge();
    if (silent) return;
    const b = this.el.banner;
    b.querySelector('.b-app').textContent = msg.app || '';
    b.querySelector('.b-title').textContent = msg.title || '';
    b.querySelector('.b-body').textContent = msg.body || '';
    b.classList.add('show');
    clearTimeout(this._bannerT);
    this._bannerT = setTimeout(() => b.classList.remove('show'), msg.ms || 6500);
    this.buzz([60, 80, 60]);
  }
  hideBanner() {
    this.el.banner.classList.remove('show');
  }
  updateBadge() {
    this.el.btnPhone.querySelector('.badge').classList.toggle('hidden', this.unread <= 0);
  }
  openPhone(timeStr) {
    this.hideBanner();
    this.unread = 0;
    this.updateBadge();
    this.el.phoneTime.textContent = timeStr || '';
    const list = this.el.phoneList;
    list.innerHTML = '';
    if (!this.messages.length) {
      const d = document.createElement('div');
      d.className = 'msg';
      d.innerHTML = '<div class="m-body">通知はありません。</div>';
      list.appendChild(d);
    }
    for (const m of this.messages) {
      const d = document.createElement('div');
      d.className = 'msg' + (m.warn ? ' warn' : '') + (m.unread ? ' unread' : '');
      d.innerHTML = `<div class="m-app"><span></span><span></span></div><div class="m-title"></div><div class="m-body"></div>`;
      d.querySelector('.m-app span:first-child').textContent = m.app || '';
      d.querySelector('.m-app span:last-child').textContent = m.time || '';
      d.querySelector('.m-title').textContent = m.title || '';
      d.querySelector('.m-body').textContent = m.body || '';
      list.appendChild(d);
      m.unread = false;
    }
    this.show(this.el.phone, true);
  }
  closePhone() {
    this.show(this.el.phone, false);
  }
  get phoneOpen() {
    return !this.el.phone.classList.contains('hidden');
  }

  // ---- 選択肢（独白の下に表示・プロミス）
  choice(text, options) {
    return new Promise((resolve) => {
      const c = this.el.choice;
      c.querySelector('.c-text').textContent = text;
      const box = c.querySelector('.c-btns');
      box.innerHTML = '';
      options.forEach((o, i) => {
        const b = document.createElement('button');
        b.setAttribute('data-ui', '');
        b.textContent = o.label;
        b.addEventListener('click', () => {
          this.show(c, false);
          this._choiceResolve = null;
          this.onChoiceClose?.();
          resolve(o.value);
        });
        box.appendChild(b);
      });
      this._choiceKeys = options.map((o) => o.value);
      this._choiceResolve = resolve;
      this.show(c, true);
      this.onChoiceOpen?.();
    });
  }
  choiceKey(n) {
    // キーボード 1/2
    const c = this.el.choice;
    if (c.classList.contains('hidden')) return false;
    const btns = c.querySelectorAll('button');
    if (btns[n]) {
      btns[n].click();
      return true;
    }
    return false;
  }
  get choiceOpen() {
    return !this.el.choice.classList.contains('hidden');
  }

  // ---- 調べる（拡大表示）
  examine({ title = '', draw, text = '', choices = null, w = 640, h = 480 }) {
    return new Promise((resolve) => {
      const ex = this.el.examine;
      const cv = this.el.exCanvas;
      cv.width = w;
      cv.height = h;
      cv.classList.toggle('hidden', !draw);
      const g = cv.getContext('2d');
      g.clearRect(0, 0, w, h);
      if (draw) draw(g, w, h);
      ex.querySelector('.ex-title').textContent = title;
      ex.querySelector('.ex-text').textContent = text;
      const box = ex.querySelector('.ex-choices');
      box.innerHTML = '';
      const close = ex.querySelector('.ex-close');
      const done = (v) => {
        this.show(ex, false);
        this.onExamineClose?.();
        resolve(v);
      };
      close.onclick = () => done(null);
      close.classList.toggle('hidden', !!choices);
      if (choices) {
        choices.forEach((c) => {
          const b = document.createElement('button');
          b.setAttribute('data-ui', '');
          b.textContent = c.label;
          b.addEventListener('click', () => done(c.value));
          box.appendChild(b);
        });
      }
      this.show(ex, true);
      this.onExamineOpen?.();
    });
  }
  get examineOpen() {
    return !this.el.examine.classList.contains('hidden');
  }

  // ---- フェード
  fade(to, ms = 800) {
    const f = this.el.fade;
    f.style.transition = `opacity ${ms}ms ease`;
    f.style.opacity = String(to);
    return sleep(ms);
  }
  flash(ms = 120) {
    if (this.reduceFlicker) ms = Math.max(ms, 900);
    const f = this.el.flash;
    if (this.reduceFlicker) f.style.filter = 'opacity(0.45)';
    else f.style.filter = '';
    f.style.transition = 'none';
    f.style.opacity = '0.9';
    requestAnimationFrame(() => {
      f.style.transition = `opacity ${ms}ms ease-out`;
      f.style.opacity = '0';
    });
  }

  // ---- インターホン・覗き穴
  showView(kind, label) {
    const v = this.el.viewfx;
    v.className = kind;
    v.querySelector('.vf-label').textContent = label || '';
    v.classList.remove('hidden');
  }
  hideView() {
    this.el.viewfx.classList.add('hidden');
  }

  // ---- エンディング
  async playEnding(lines, statsHtml, onDone) {
    const e = this.el.ending;
    const box = e.querySelector('.e-lines');
    box.innerHTML = '';
    e.querySelector('.e-stats').classList.add('hidden');
    e.querySelector('.e-btns').classList.add('hidden');
    this.show(e, true);
    for (const l of lines) {
      const p = document.createElement('p');
      p.textContent = l.t;
      if (l.big) p.classList.add('big');
      if (l.gap) p.classList.add('gap');
      box.appendChild(p);
      await sleep(60);
      p.classList.add('show');
      await sleep(l.ms ?? 2600);
    }
    const s = e.querySelector('.e-stats');
    s.innerHTML = statsHtml;
    s.classList.remove('hidden');
    await sleep(500);
    e.querySelector('.e-btns').classList.remove('hidden');
    e.scrollTop = 0;
    onDone?.();
  }
  hideEnding() {
    this.show(this.el.ending, false);
  }
}
