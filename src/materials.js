// マテリアル定義とテクスチャ生成（段階的に生成して進捗を返す）
import * as THREE from 'three';
import * as T from './tex.js';
import { MatLib } from './gfx.js';
import { nextFrame } from './util.js';

export async function buildTextures(onProgress = () => {}) {
  const t = {};
  const steps = [
    ['woodFloor', () => T.woodFloor()],
    ['wallpaper', () => T.wallpaper()],
    ['plaster', () => T.plaster()],
    ['corridorFloor', () => T.corridorFloor()],
    ['genkanTile', () => T.genkanTile()],
    ['whiteTile', () => T.whiteTile()],
    ['woodDark', () => T.woodDark()],
    ['woodLight', () => T.woodLight()],
    ['fabric', () => T.fabric()],
    ['steel', () => T.paintedSteel()],
    ['brushed', () => T.brushedMetal()],
    ['curtain', () => T.curtainFold(0.62, 0.58, 0.5)],
    ['curtainDark', () => T.curtainFold(0.28, 0.3, 0.34)],
  ];
  let i = 0;
  for (const [k, fn] of steps) {
    t[k] = fn();
    i++;
    onProgress(i / steps.length);
    await nextFrame();
  }
  t.lace = { map: T.lace() };
  return t;
}

export function defineMaterials(lib) {
  const D = (n, d) => lib.define(n, d);
  // 壁・床・天井
  D('wallHall', { bounce: 0.07, map: 'wallpaper', tile: 1, params: { color: 0xe3dac6, roughness: 0.95 }, bumpScale: 0.6, env: 0 });
  D('wallGenkan', { bounce: 0.07, map: 'wallpaper', tile: 1, params: { color: 0xd8cfba, roughness: 0.95 }, bumpScale: 0.6, env: 0 });
  D('wallLDK', { bounce: 0.07, map: 'wallpaper', tile: 1, params: { color: 0xd9d6c8, roughness: 0.95 }, bumpScale: 0.6, env: 0 });
  D('wallBed', { bounce: 0.07, map: 'wallpaper', tile: 1, params: { color: 0xdccfb4, roughness: 0.95 }, bumpScale: 0.6, env: 0 });
  D('ceilIn', { bounce: 0.08, map: 'wallpaper', tile: 1, params: { color: 0xeeeae0, roughness: 0.95 }, bumpScale: 0.4, env: 0 });
  D('floorWood', { bounce: 0.03, map: 'woodFloor', tile: 1.8, params: { color: 0xffffff, roughness: 0.5 }, bumpScale: 1.0, env: 0.55 });
  D('floorGenkan', { bounce: 0.025, map: 'genkanTile', tile: 0.6, params: { color: 0xffffff, roughness: 0.6 }, bumpScale: 1.0, env: 0.5 });
  D('tile', { bounce: 0.05, map: 'whiteTile', tile: 0.5, params: { color: 0xe8ecec, roughness: 0.3 }, bumpScale: 1.0, env: 0.7 });
  D('tileFloor', { bounce: 0.03, map: 'genkanTile', tile: 0.6, params: { color: 0xb7bcc0, roughness: 0.4 }, bumpScale: 1.0, env: 0.5 });
  D('wallCor', { bounce: 0.07, map: 'plaster', tile: 2, params: { color: 0xb3ab97, roughness: 0.95 }, bumpScale: 1.4, env: 0 });
  D('wallCorDark', { bounce: 0.07, map: 'plaster', tile: 2, params: { color: 0x8f897c, roughness: 0.95 }, bumpScale: 1.4, env: 0 });
  D('ceilCor', { bounce: 0.07, map: 'plaster', tile: 2, params: { color: 0xa9a496, roughness: 0.95 }, bumpScale: 1.4, env: 0 });
  D('concrete', { map: 'plaster', tile: 1.5, params: { color: 0x8e8b84, roughness: 0.95 }, bumpScale: 1.6, env: 0 });
  D('floorCor', { bounce: 0.03, map: 'corridorFloor', tile: 1, params: { color: 0xbdbdbd, roughness: 0.45 }, bumpScale: 0.8, env: 0.8 });
  // 木・塗装
  D('trim', { params: { color: 0xe6e0d2, roughness: 0.55 }, env: 0.1 });
  D('doorPaint', { params: { color: 0xcfc8b8, roughness: 0.5 }, env: 0.15 });
  D('woodDark', { map: 'woodDark', tile: 0.8, params: { color: 0xffffff, roughness: 0.5 }, bumpScale: 0.6, env: 0.35 });
  D('woodLight', { map: 'woodLight', tile: 0.8, params: { color: 0xffffff, roughness: 0.55 }, bumpScale: 0.6, env: 0.25 });
  D('woodBlack', { map: 'woodDark', tile: 0.8, params: { color: 0x2a221e, roughness: 0.4 }, bumpScale: 0.4, env: 0.35 });
  // 金属
  D('steelDoor', { map: 'steel', tile: 1, params: { color: 0x6f7468, roughness: 0.45, metalness: 0.35 }, bumpScale: 0.5, env: 0.9 });
  D('steelDoorBrown', { map: 'steel', tile: 1, params: { color: 0x5a4a3a, roughness: 0.45, metalness: 0.3 }, bumpScale: 0.5, env: 0.9 });
  D('steelGreen', { map: 'steel', tile: 1, params: { color: 0x3d5f4c, roughness: 0.5, metalness: 0.3 }, bumpScale: 0.5, env: 0.8 });
  D('metal', { map: 'brushed', tile: 0.5, params: { color: 0xc8cacc, roughness: 0.35, metalness: 0.85 }, env: 1.2 });
  D('metalDark', { params: { color: 0x3a3c3f, roughness: 0.45, metalness: 0.8 }, env: 1.0 });
  D('chrome', { params: { color: 0xe6e8ea, roughness: 0.12, metalness: 1 }, env: 1.4 });
  D('brass', { params: { color: 0xb59a5a, roughness: 0.3, metalness: 0.9 }, env: 1.2 });
  D('fridge', { map: 'brushed', tile: 0.6, params: { color: 0xe6e8ea, roughness: 0.3, metalness: 0.5 }, env: 1.0 });
  // 樹脂・陶器・ガラス
  D('plastic', { params: { color: 0xe8e8e2, roughness: 0.4 }, env: 0.4 });
  D('plasticDark', { params: { color: 0x1e1f21, roughness: 0.35 }, env: 0.6 });
  D('plasticGray', { params: { color: 0x8c8e90, roughness: 0.5 }, env: 0.4 });
  D('ceramic', { params: { color: 0xf1f1ec, roughness: 0.12 }, env: 1.0 });
  D('rubber', { params: { color: 0x151515, roughness: 0.85 }, env: 0.1 });
  D('glass', { params: { color: 0xbfd2d8, roughness: 0.04, metalness: 0, transparent: true, opacity: 0.18, depthWrite: false }, env: 1.6 });
  D('glassFrost', { params: { color: 0xdfe8e8, roughness: 0.6, transparent: true, opacity: 0.55, depthWrite: false }, env: 0.6 });
  D('screen', { params: { color: 0x050607, roughness: 0.08, metalness: 0.2 }, env: 1.4 });
  D('mirror', { params: { color: 0x9aa0a4, roughness: 0.03, metalness: 1 }, env: 1.6 });
  // 布・紙
  D('fabricSofa', { map: 'fabric', tile: 0.3, params: { color: 0x575049, roughness: 0.95 }, bumpScale: 0.8, env: 0 });
  D('fabricBed', { map: 'fabric', tile: 0.3, params: { color: 0xd8d6cf, roughness: 0.95 }, bumpScale: 0.6, env: 0 });
  D('fabricBlanket', { map: 'fabric', tile: 0.3, params: { color: 0x6c7a8c, roughness: 0.95 }, bumpScale: 0.6, env: 0 });
  D('fabricRug', { map: 'fabric', tile: 0.25, params: { color: 0x8a7b6c, roughness: 1 }, bumpScale: 1.2, env: 0 });
  D('curtain', { map: 'curtain', tile: 1.2, params: { color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide }, env: 0 });
  D('curtainDark', { map: 'curtainDark', tile: 1.2, params: { color: 0xffffff, roughness: 0.95, side: THREE.DoubleSide }, env: 0 });
  D('paper', { params: { color: 0xe9e4d6, roughness: 0.9 }, env: 0 });
  D('cardboard', { params: { color: 0x9a7a52, roughness: 0.95 }, env: 0 });
  D('leaf', { params: { color: 0x3c5a32, roughness: 0.7, side: THREE.DoubleSide }, env: 0.1 });
  D('soil', { params: { color: 0x2a2018, roughness: 1 }, env: 0 });
  D('coffee', { params: { color: 0x1a0f09, roughness: 0.15 }, env: 0.9 });
  D('skin', { params: { color: 0xd9b59c, roughness: 0.6 }, env: 0.1 });
  D('black', { params: { color: 0x0a0a0b, roughness: 0.9 }, env: 0 });
  D('white', { params: { color: 0xf0eee8, roughness: 0.7 }, env: 0.1 });
}

/** 発光系（ライト非依存）*/
export function basic(color, opts = {}) {
  return new THREE.MeshBasicMaterial({ color, ...opts });
}
