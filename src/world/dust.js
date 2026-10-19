// 空気中の埃（光に照らされて漂う）
import * as THREE from 'three';

export function buildDust(w, scale = 1) {
  const mk = (n, box, color, size) => {
    const count = Math.max(8, Math.round(n * scale));
    const pos = new Float32Array(count * 3);
    const vel = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = box.x0 + Math.random() * (box.x1 - box.x0);
      pos[i * 3 + 1] = box.y0 + Math.random() * (box.y1 - box.y0);
      pos[i * 3 + 2] = box.z0 + Math.random() * (box.z1 - box.z0);
      vel[i * 3] = (Math.random() - 0.5) * 0.02;
      vel[i * 3 + 1] = (Math.random() - 0.4) * 0.012;
      vel[i * 3 + 2] = (Math.random() - 0.5) * 0.02;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      map: w.tex.dust,
      color,
      size,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.0,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: true,
    });
    const pts = new THREE.Points(g, m);
    pts.frustumCulled = false;
    pts.userData = { vel, box, base: 0.5 };
    w.root.add(pts);
    return pts;
  };
  w.dustCor = mk(120, { x0: -10, x1: 10, y0: 0.2, y1: 2.4, z0: -1.7, z1: -0.1 }, 0xcfe0ff, 0.035);
  w.dustHall = mk(70, { x0: -0.9, x1: 0.9, y0: 0.2, y1: 2.35, z0: 0.1, z1: 4.5 }, 0xffe8c8, 0.03);
  w.dustLDK = mk(90, { x0: -3.5, x1: 0.8, y0: 0.2, y1: 2.35, z0: 3.7, z1: 8.0 }, 0xf0f4ff, 0.03);
  w.dustLDK.userData.deep = true;
  w.dustSets = [w.dustCor, w.dustHall, w.dustLDK];
}

export function updateDust(w, dt, zone, levels) {
  if (!w.dustSets) return;
  const dz = w.hallDz;
  for (const d of w.dustSets) {
    const u = d.userData;
    const lvl = d === w.dustCor ? levels.cor : d === w.dustHall ? levels.hall : levels.ldk;
    const on = d === w.dustCor ? zone === 'cor' : d === w.dustHall ? zone === 'genkan' || zone === 'hall' : zone === 'ldk' || zone === 'bed';
    const target = on ? u.base * Math.min(1, lvl) : 0;
    d.material.opacity += (target - d.material.opacity) * Math.min(1, dt * 2);
    d.visible = d.material.opacity > 0.01;
    if (!d.visible) continue;
    const p = d.geometry.attributes.position;
    const v = u.vel;
    const b = u.box;
    const off = u.deep ? dz : d === w.dustHall ? 0 : 0;
    for (let i = 0; i < p.count; i++) {
      let x = p.getX(i) + v[i * 3] * dt * 6 + Math.sin(w.time * 0.3 + i) * 0.0004;
      let y = p.getY(i) + v[i * 3 + 1] * dt * 6;
      let z = p.getZ(i) + v[i * 3 + 2] * dt * 6;
      const z0 = b.z0 + off;
      const z1 = b.z1 + off;
      if (x < b.x0) x = b.x1;
      if (x > b.x1) x = b.x0;
      if (y < b.y0) y = b.y1;
      if (y > b.y1) y = b.y0;
      if (z < z0) z = z1;
      if (z > z1) z = z0;
      p.setXYZ(i, x, y, z);
    }
    p.needsUpdate = true;
  }
}
