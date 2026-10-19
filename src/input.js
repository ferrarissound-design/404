// 入力：タッチ（左=仮想スティック / 右=視点 / タップ=調査）・キーボード・マウス
import { clamp } from './util.js';

export class Input {
  constructor(root, canvas) {
    this.root = root;
    this.canvas = canvas;
    this.enabled = false;
    this.isTouch = (() => {
      try {
        return window.matchMedia('(pointer: coarse)').matches && !window.matchMedia('(pointer: fine)').matches;
      } catch (e) {
        return false;
      }
    })();
    this.move = { x: 0, y: 0 };
    this.look = { dx: 0, dy: 0 };
    this.run = false;
    this.sens = 1;
    this.invertY = false;
    this.keys = new Set();
    this.locked = false;
    this.onTap = null; // (x,y,kind) kind: 'screen' | 'center'
    this.onKey = null; // (code)
    this.onUnlock = null; // ポインタロック解除（Esc）
    this.joy = { id: null, ox: 0, oy: 0, x: 0, y: 0 };
    this.lk = { id: null, x: 0, y: 0, sx: 0, sy: 0, t: 0, moved: 0 };
    this.mouse = { down: false, x: 0, y: 0, sx: 0, sy: 0, t: 0, moved: 0 };
    this.joyBase = document.getElementById('joyBase');
    this.joyKnob = document.getElementById('joyKnob');
    this.touchUI = document.getElementById('touchUI');
    this._bind();
  }

  setEnabled(v) {
    this.enabled = v;
    if (!v) this.reset();
  }

  reset() {
    this.move.x = this.move.y = 0;
    this.look.dx = this.look.dy = 0;
    this.joy.id = null;
    this.lk.id = null;
    this.mouse.down = false;
    this.keys.clear();
    this.joyBase?.classList.remove('active');
    this._joyRest();
  }

  _joyRest() {
    if (!this.joyBase) return;
    const H = window.innerHeight;
    const u = Math.min(window.innerWidth, window.innerHeight) * 0.021;
    this.joyBase.style.left = `${Math.max(u * 8, window.innerWidth * 0.12)}px`;
    this.joyBase.style.top = `${H - Math.max(u * 8, H * 0.28)}px`;
    this.joyKnob.style.transform = 'translate(0,0)';
    if (this.isTouch && this.enabled) this.joyBase.classList.add('rest');
    else this.joyBase.classList.remove('rest');
  }

  showTouchHints(v) {
    this.touchUI.classList.toggle('hidden', !v);
    if (v) this._joyRest();
  }

  _ui(e) {
    return e.target && e.target.closest && e.target.closest('[data-ui]');
  }

  _bind() {
    const root = this.root;
    // Safari のピンチ・ダブルタップ拡大を抑止
    for (const ev of ['gesturestart', 'gesturechange', 'gestureend']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
    document.addEventListener('touchmove', (e) => { if (!e.target.closest || !e.target.closest('#phoneList, .s-inner, .ex-card, #ending')) e.preventDefault(); }, { passive: false });
    document.addEventListener('dblclick', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => e.preventDefault());
    let lastTouchEnd = 0;
    document.addEventListener('touchend', (e) => {
      const n = Date.now();
      if (n - lastTouchEnd < 300) e.preventDefault();
      lastTouchEnd = n;
    }, { passive: false });

    root.addEventListener('pointerdown', (e) => this._down(e));
    root.addEventListener('pointermove', (e) => this._move(e));
    root.addEventListener('pointerup', (e) => this._up(e));
    root.addEventListener('pointercancel', (e) => this._up(e, true));
    window.addEventListener('blur', () => this.reset());

    document.addEventListener('pointerlockchange', () => {
      const was = this.locked;
      this.locked = document.pointerLockElement === this.canvas;
      if (was && !this.locked && this.enabled) this.onUnlock?.();
    });
    document.addEventListener('mousemove', (e) => {
      if (!this.locked || !this.enabled) return;
      const k = 0.0022 * this.sens;
      this.look.dx += e.movementX * k;
      this.look.dy += e.movementY * k * (this.invertY ? -1 : 1);
    });

    window.addEventListener('keydown', (e) => {
      if (e.repeat) {
        if (this.enabled && ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
        return;
      }
      if (e.code === 'Escape' || e.code === 'KeyP') {
        this.onKey?.(e.code);
        return;
      }
      if (!this.enabled) {
        this.onKey?.(e.code);
        return;
      }
      this.keys.add(e.code);
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.run = true;
      this.onKey?.(e.code);
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') this.run = false;
    });
  }

  _down(e) {
    if (e.pointerType === 'touch' && !this.isTouch) {
      this.isTouch = true;
      this.onTouchDetected?.();
    }
    if (this._ui(e)) return;
    if (e.pointerType === 'touch') {
      this.isTouch = true;
      if (!this.enabled) return;
      const W = window.innerWidth;
      if (e.clientX < W * 0.42 && this.joy.id === null) {
        this.joy.id = e.pointerId;
        this.joy.ox = e.clientX;
        this.joy.oy = e.clientY;
        this.joy.x = this.joy.y = 0;
        this.joyBase.style.left = e.clientX + 'px';
        this.joyBase.style.top = e.clientY + 'px';
        this.joyBase.classList.remove('rest');
        this.joyBase.classList.add('active');
        this.joyKnob.style.transform = 'translate(0,0)';
      } else if (this.lk.id === null) {
        this.lk.id = e.pointerId;
        this.lk.x = this.lk.sx = e.clientX;
        this.lk.y = this.lk.sy = e.clientY;
        this.lk.t = performance.now();
        this.lk.moved = 0;
      }
      try { this.root.setPointerCapture(e.pointerId); } catch (_) {}
    } else {
      if (!this.enabled) return;
      if (e.button !== 0) return;
      if (this.locked) {
        this.onTap?.(window.innerWidth / 2, window.innerHeight / 2, 'center');
        return;
      }
      this.mouse.down = true;
      this.mouse.x = this.mouse.sx = e.clientX;
      this.mouse.y = this.mouse.sy = e.clientY;
      this.mouse.t = performance.now();
      this.mouse.moved = 0;
    }
  }

  _move(e) {
    if (e.pointerType === 'touch') {
      if (e.pointerId === this.joy.id) {
        const u = Math.min(window.innerWidth, window.innerHeight) * 0.021;
        const R = u * 4.2;
        let dx = e.clientX - this.joy.ox;
        let dy = e.clientY - this.joy.oy;
        const d = Math.hypot(dx, dy);
        if (d > R) {
          dx = (dx / d) * R;
          dy = (dy / d) * R;
        }
        this.joy.x = dx / R;
        this.joy.y = dy / R;
        this.joyKnob.style.transform = `translate(${dx}px, ${dy}px)`;
      } else if (e.pointerId === this.lk.id) {
        const H = window.innerHeight;
        const dx = e.clientX - this.lk.x;
        const dy = e.clientY - this.lk.y;
        this.lk.x = e.clientX;
        this.lk.y = e.clientY;
        this.lk.moved += Math.abs(dx) + Math.abs(dy);
        const k = (2.7 / H) * this.sens;
        this.look.dx += dx * k;
        this.look.dy += dy * k * (this.invertY ? -1 : 1);
      }
    } else if (this.mouse.down && !this.locked) {
      const dx = e.clientX - this.mouse.x;
      const dy = e.clientY - this.mouse.y;
      this.mouse.x = e.clientX;
      this.mouse.y = e.clientY;
      this.mouse.moved += Math.abs(dx) + Math.abs(dy);
      const k = 0.0032 * this.sens;
      this.look.dx += dx * k;
      this.look.dy += dy * k * (this.invertY ? -1 : 1);
    }
  }

  _up(e, cancel = false) {
    if (e.pointerType === 'touch') {
      if (e.pointerId === this.joy.id) {
        this.joy.id = null;
        this.joy.x = this.joy.y = 0;
        this.joyBase.classList.remove('active');
        this._joyRest();
      } else if (e.pointerId === this.lk.id) {
        const dt = performance.now() - this.lk.t;
        const tapped = !cancel && this.lk.moved < 14 && dt < 380;
        this.lk.id = null;
        if (tapped && this.enabled) this.onTap?.(e.clientX, e.clientY, 'screen');
      }
    } else if (this.mouse.down) {
      this.mouse.down = false;
      const dt = performance.now() - this.mouse.t;
      if (!cancel && this.mouse.moved < 6 && dt < 500 && this.enabled) {
        // 初回クリックでポインタロックを試みる（デスクトップ）
        this.lockPointer();
        this.onTap?.(e.clientX, e.clientY, 'screen');
      }
    }
  }

  lockPointer() {
    if (this.isTouch || this.locked) return;
    try {
      const p = this.canvas.requestPointerLock?.();
      if (p && p.catch) p.catch(() => {});
    } catch (e) {}
  }

  unlockPointer() {
    if (document.pointerLockElement) document.exitPointerLock?.();
  }

  /** 毎フレーム：移動ベクトルと視点量を取り出す */
  poll() {
    let mx = 0;
    let my = 0;
    if (this.enabled) {
      const k = this.keys;
      if (k.has('KeyW') || k.has('ArrowUp')) my -= 1;
      if (k.has('KeyS') || k.has('ArrowDown')) my += 1;
      if (k.has('KeyA')) mx -= 1;
      if (k.has('KeyD')) mx += 1;
      if (k.has('ArrowLeft')) this.look.dx -= 0.03 * this.sens;
      if (k.has('ArrowRight')) this.look.dx += 0.03 * this.sens;
      if (this.joy.id !== null) {
        const dz = 0.14;
        const jx = Math.abs(this.joy.x) < dz ? 0 : this.joy.x;
        const jy = Math.abs(this.joy.y) < dz ? 0 : this.joy.y;
        mx += jx;
        my += jy;
      }
    }
    const l = Math.hypot(mx, my);
    if (l > 1) {
      mx /= l;
      my /= l;
    }
    const out = { mx, my, lx: this.look.dx, ly: this.look.dy, run: this.run };
    this.look.dx = 0;
    this.look.dy = 0;
    return out;
  }
}
