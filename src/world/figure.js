// 人影（座る女性の後ろ姿 / 立つ影 / 窓の人影）
import * as THREE from 'three';

function mat(w, color, room) {
  return w.M.custom({ color, roughness: 0.95 }, room, 0.05);
}

/** 食卓に座る人物（後ろ姿）。原点は座面中心の床 */
export function buildSeatedFigure(w, room = 'ldk') {
  const g = new THREE.Group();
  const cloth = mat(w, 0x23262c, room);
  const skin = mat(w, 0xb89a88, room);
  const hair = mat(w, 0x0c0a09, room);
  const sh = (geo, m) => {
    const s = new THREE.Mesh(geo, m);
    s.castShadow = true;
    s.receiveShadow = true;
    return s;
  };
  // 座面 y=0.47
  const hips = sh(new THREE.BoxGeometry(0.34, 0.18, 0.26), cloth);
  hips.position.set(0, 0.56, 0);
  const torso = sh(new THREE.CapsuleGeometry(0.17, 0.3, 6, 12), cloth);
  torso.scale.set(1.3, 1, 0.78);
  torso.position.set(0, 0.88, 0.02);
  torso.rotation.x = -0.06;
  const neck = sh(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 10), skin);
  neck.position.set(0, 1.14, 0.0);
  const head = sh(new THREE.SphereGeometry(0.105, 16, 14), hair);
  head.scale.set(1, 1.08, 1.0);
  head.position.set(0, 1.27, 0.0);
  // 長い髪（背中に流れる）
  const long = sh(new THREE.CapsuleGeometry(0.1, 0.42, 6, 12), hair);
  long.scale.set(1.0, 1, 0.55);
  long.position.set(0, 1.05, 0.085);
  // 腕（卓上へ）
  const armL = sh(new THREE.CapsuleGeometry(0.045, 0.34, 4, 8), cloth);
  armL.position.set(-0.22, 0.88, -0.17);
  armL.rotation.set(1.25, 0, 0.2);
  const armR = armL.clone();
  armR.position.x = 0.22;
  armR.rotation.z = -0.2;
  const legs = sh(new THREE.BoxGeometry(0.3, 0.14, 0.4), cloth);
  legs.position.set(0, 0.5, -0.17);
  g.add(hips, torso, neck, head, long, armL, armR, legs);
  g.userData.parts = { head };
  return g;
}

/** 立っている黒い人影（廊下の端・窓）*/
export function buildStandingShadow(w, room = 'hall', color = 0x050505) {
  const g = new THREE.Group();
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, fog: true });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.9, 6, 12), m);
  body.scale.set(1, 1, 0.6);
  body.position.y = 0.95;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.115, 14, 12), m);
  head.position.y = 1.62;
  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.11, 0.5, 4, 8), m);
  legs.position.y = 0.3;
  legs.scale.set(1.2, 1, 0.8);
  g.add(body, head, legs);
  g.userData.mat = m;
  return g;
}
