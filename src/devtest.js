import * as THREE from 'three';
import { createRenderer, Post, TIERS, fovFor } from './gfx.js';
import { World } from './world/index.js';

const canvas = document.getElementById('gl');
const renderer = createRenderer(canvas);
const tierName = new URLSearchParams(location.search).get('tier') || 'mid';
const tier = TIERS[tierName];
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x0a0d12, 0.03);
const camera = new THREE.PerspectiveCamera(70, 2, 0.05, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);
const world = new World(renderer, scene, tier);
const post = new Post(renderer, tier);
window.__world = world;
window.__post = post;
const W = 1280, H = 640;
renderer.setPixelRatio(1);
renderer.setSize(W, H, false);
canvas.style.width = W + 'px';
canvas.style.height = H + 'px';
post.resize(W, H);
camera.aspect = W / H;
camera.fov = fovFor(W / H);
camera.updateProjectionMatrix();

let t0 = performance.now();
window.__ready = false;
world.build((p) => (window.__progress = p)).then(() => {
  window.__ready = true;
  window.__buildMs = performance.now() - t0;
});
let time = 0;
window.setCam = (x, y, z, yaw, pitch = 0) => {
  camera.position.set(x, y, z);
  camera.rotation.set(pitch, yaw, 0);
};
window.frame = (n = 1, dt = 0.016) => {
  const p = camera.position;
  for (let i = 0; i < n; i++) {
    time += dt;
    world.update(dt, time, { x: p.x, z: p.z });
    if (world.laundry) {}
  }
  post.uni.uExposure.value = window.__exposure ?? 1.4;
  post.uni.uBloom.value = tier.bloom ? 0.35 : 0;
  renderer.shadowMap.needsUpdate = true;
  post.render(scene, camera, time);
};
window.info = () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, programs: renderer.info.programs?.length });
