// 看板・表札・インジケータ等のキャンバス生成メッシュ
import * as THREE from 'three';
import { labelTexture, FONT_JP } from '../tex.js';

/** World に付与するヘルパ群 */
export function installSignHelpers(w) {
  const lib = w.M;

  w.litPlane = (tex, width, height, room = 'cor', env = 0.2, extra = {}) => {
    const m = lib.custom({ map: tex, roughness: 0.55, ...extra }, room, env);
    return new THREE.Mesh(new THREE.PlaneGeometry(width, height), m);
  };

  w.numberPlate = (text) => {
    const tex = labelTexture(256, 128, (x, wv, h) => {
      x.fillStyle = '#16191d';
      x.fillRect(0, 0, wv, h);
      x.strokeStyle = '#b9bcc0';
      x.lineWidth = 6;
      x.strokeRect(5, 5, wv - 10, h - 10);
      x.fillStyle = '#e9ecef';
      x.font = `700 ${text.length > 3 ? 62 : 74}px ${FONT_JP}`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(text, wv / 2, h / 2 + 4);
    });
    const mesh = w.litPlane(tex, 0.2, 0.1, 'cor', 0.5);
    mesh.userData.tex = tex;
    return mesh;
  };

  w.nameplate = (name) => {
    const tex = labelTexture(256, 128, (x, wv, h) => {
      x.fillStyle = '#c4c2b8';
      x.fillRect(0, 0, wv, h);
      x.strokeStyle = '#8c8a80';
      x.lineWidth = 4;
      x.strokeRect(3, 3, wv - 6, h - 6);
      if (name) {
        x.fillStyle = '#222';
        x.font = `600 56px ${FONT_JP}`;
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillText(name, wv / 2, h / 2 + 3);
      }
    });
    const mesh = w.litPlane(tex, 0.14, 0.07, 'cor', 0.2);
    mesh.userData.tex = tex;
    mesh.userData.setName = (n, opts = {}) => {
      const c = tex.userData.canvas;
      const x = tex.userData.ctx;
      x.fillStyle = '#c4c2b8';
      x.fillRect(0, 0, c.width, c.height);
      x.strokeStyle = '#8c8a80';
      x.lineWidth = 4;
      x.strokeRect(3, 3, c.width - 6, c.height - 6);
      if (n) {
        x.fillStyle = opts.color || '#222';
        x.font = `600 ${opts.size || 56}px ${FONT_JP}`;
        x.textAlign = 'center';
        x.textBaseline = 'middle';
        x.fillText(n, c.width / 2, c.height / 2 + 3);
      }
      tex.needsUpdate = true;
    };
    return mesh;
  };

  w.signPlate = (text, wm, hm, bg, fg) => {
    const aspect = wm / hm;
    const cw = 256;
    const ch = Math.round(cw / aspect);
    const tex = labelTexture(cw, ch, (x, wv, h) => {
      x.fillStyle = bg;
      x.fillRect(0, 0, wv, h);
      x.fillStyle = fg;
      x.font = `700 ${Math.floor(h * 0.5)}px ${FONT_JP}`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(text, wv / 2, h / 2 + 2);
    });
    const mesh = w.litPlane(tex, wm, hm, 'cor', 0.1);
    return mesh;
  };

  w.exitSign = () => {
    const tex = labelTexture(512, 192, (x, wv, h) => {
      x.fillStyle = '#0b8a3e';
      x.fillRect(0, 0, wv, h);
      x.strokeStyle = '#eaffef';
      x.lineWidth = 6;
      x.strokeRect(8, 8, wv - 16, h - 16);
      // 走る人ピクト
      x.fillStyle = '#ffffff';
      x.strokeStyle = '#ffffff';
      x.lineCap = 'round';
      x.lineJoin = 'round';
      const cx = 110;
      const cy = 96;
      x.beginPath();
      x.arc(cx + 8, cy - 46, 11, 0, Math.PI * 2);
      x.fill();
      x.lineWidth = 11;
      x.beginPath();
      x.moveTo(cx + 6, cy - 30);
      x.lineTo(cx - 6, cy + 4);
      x.lineTo(cx - 28, cy + 30);
      x.moveTo(cx - 6, cy + 4);
      x.lineTo(cx + 18, cy + 22);
      x.lineTo(cx + 14, cy + 50);
      x.moveTo(cx + 4, cy - 22);
      x.lineTo(cx - 24, cy - 14);
      x.moveTo(cx + 4, cy - 22);
      x.lineTo(cx + 32, cy - 6);
      x.stroke();
      x.font = `800 74px ${FONT_JP}`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText('非常口', 340, 100);
    });
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.3, 1.3, 1.3) });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.23), mat);
    return mesh;
  };

  w.indicator = (text) => {
    const tex = labelTexture(128, 96, (x, wv, h) => {
      x.fillStyle = '#080808';
      x.fillRect(0, 0, wv, h);
    });
    const draw = (t) => {
      const x = tex.userData.ctx;
      x.fillStyle = '#080808';
      x.fillRect(0, 0, 128, 96);
      x.fillStyle = '#ff6a2a';
      x.font = `700 64px ${FONT_JP}`;
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      x.fillText(t, 64, 50);
      tex.needsUpdate = true;
    };
    draw(text);
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(1.6, 1.6, 1.6) });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.15), mat);
    mesh.userData.setText = draw;
    return mesh;
  };

  w.elevatorPanel = () => {
    const tex = labelTexture(128, 384, (x, wv, h) => {
      x.fillStyle = '#9ea3a6';
      x.fillRect(0, 0, wv, h);
      const labels = ['6', '5', '3', '2', '1', '開', '閉'];
      x.textAlign = 'center';
      x.textBaseline = 'middle';
      labels.forEach((l, i) => {
        const cy = 34 + i * 48;
        x.fillStyle = '#d8dcde';
        x.beginPath();
        x.arc(64, cy, 18, 0, Math.PI * 2);
        x.fill();
        x.strokeStyle = '#555';
        x.lineWidth = 3;
        x.stroke();
        x.fillStyle = '#222';
        x.font = `700 22px ${FONT_JP}`;
        x.fillText(l, 64, cy + 1);
      });
    });
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.9, 0.9, 0.9) });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(0.16, 0.48), mat);
    mesh.rotation.y = Math.PI / 2;
    mesh.userData.hit = true;
    return mesh;
  };

  w.directorySign = () => {
    const tex = labelTexture(384, 512, (x, wv, h) => {
      x.fillStyle = '#e7e5dc';
      x.fillRect(0, 0, wv, h);
      x.fillStyle = '#26323a';
      x.fillRect(0, 0, wv, 70);
      x.fillStyle = '#fff';
      x.font = `700 40px ${FONT_JP}`;
      x.textAlign = 'left';
      x.textBaseline = 'middle';
      x.fillText('館内案内', 24, 38);
      x.fillStyle = '#222';
      const rows = [
        ['6F', '601 – 606'],
        ['5F', '501 – 506'],
        ['4F', ''],
        ['3F', '301 – 306'],
        ['2F', '201 – 206'],
        ['1F', '管理室・集合ポスト'],
      ];
      rows.forEach(([f, t], i) => {
        const y = 118 + i * 62;
        if (f === '4F') {
          x.fillStyle = '#b8b6ac';
          x.font = `700 38px ${FONT_JP}`;
          x.fillText('——', 24, y);
          return;
        }
        x.fillStyle = '#26323a';
        x.font = `700 38px ${FONT_JP}`;
        x.fillText(f, 24, y);
        x.font = `500 30px ${FONT_JP}`;
        x.fillText(t, 100, y);
      });
      x.strokeStyle = '#c9c7bd';
      x.lineWidth = 2;
      for (let i = 0; i < 6; i++) {
        x.beginPath();
        x.moveTo(20, 150 + i * 62 - 31);
        x.lineTo(wv - 20, 150 + i * 62 - 31);
        x.stroke();
      }
      x.fillStyle = '#5a5a52';
      x.font = `500 24px ${FONT_JP}`;
      x.fillText('エレベーターは各階停止です', 24, 480);
    });
    const mesh = w.litPlane(tex, 0.55, 0.73, 'cor', 0.1);
    return mesh;
  };

  /** すりガラス窓（廊下側から見える面格子窓の室内灯）*/
  w.windowGlass = (cx, cy, z, wid, hei, lit) => {
    const tex = labelTexture(64, 128, (x, wv, h) => {
      const g = x.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#fff');
      g.addColorStop(1, '#ddd');
      x.fillStyle = g;
      x.fillRect(0, 0, wv, h);
    });
    const mat = new THREE.MeshBasicMaterial({ map: tex, color: new THREE.Color(0.02, 0.02, 0.025) });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(wid, hei), mat);
    mesh.position.set(cx, cy, z);
    mesh.rotation.y = Math.PI;
    mesh.userData.setLit = (v) => {
      mesh.userData.lit = v;
      mat.color.setRGB(0.03 + v * 0.95, 0.03 + v * 0.8, 0.03 + v * 0.55);
    };
    mesh.userData.setLit(lit);
    w.unitWindows ||= [];
    w.unitWindows.push(mesh);
    return mesh;
  };
}
