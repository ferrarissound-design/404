// スマホ操作の自動テスト（iPhone横画面・タッチエミュレーション）
// 仮想スティックで移動 / 右側ドラッグで視点 / タップで調査 / ボタン表示 / 縦画面の案内 を確認する。
import fs from 'node:fs';

const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const OUT = process.env.OUT_DIR || 'test-output';
fs.mkdirSync(OUT, { recursive: true });
async function loadPlaywright() {
  for (const name of ['playwright-core', 'playwright', '/opt/node22/lib/node_modules/playwright/index.mjs']) {
    try {
      return await import(name);
    } catch (e) {}
  }
  throw new Error('playwright が見つかりません');
}
const { chromium } = await loadPlaywright();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
// iPhone 16 (横) 相当：852x393 CSS px, DPR 3 → 画質は low に固定して軽量に
const ctx = await browser.newContext({
  viewport: { width: 852, height: 393 },
  deviceScaleFactor: 1,
  hasTouch: true,
  isMobile: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
});
await ctx.addInitScript(() => {
  try {
    localStorage.setItem('room404.settings.v1', JSON.stringify({ quality: 'low' }));
  } catch (e) {}
});
const p = await ctx.newPage();
p.setDefaultTimeout(240000);
const errors = [];
p.on('pageerror', (e) => errors.push(e.message));
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
let failed = 0;
const ok = (c, m) => {
  console.log((c ? '  ✓ ' : '  ✗ ') + m);
  if (!c) failed++;
};
const ev = (js) => p.evaluate(js);
const wait = (ms) => p.waitForTimeout(ms);
const cdp = await ctx.newCDPSession(p);
const touch = async (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map((q, i) => ({ x: q.x, y: q.y, id: q.id ?? i })) });

await p.goto(BASE);
await p.waitForSelector('#loading.hidden', { state: 'attached' });
await wait(1500);
console.log('\n■ スマホ操作');
// タイトルのボタンをタップ
await p.tap('#btnStart');
await wait(3500);
ok(await ev('window.__game.input.isTouch'), 'タッチ端末として認識される');
ok(await ev("!document.getElementById('touchUI').classList.contains('hidden')"), '仮想スティックの案内が表示される');
ok(await ev("!document.getElementById('ctrlHint').classList.contains('hidden')"), '操作ヒントが一時表示される');
await ev("window.__dbg.interactId('frontDoor')");
await ev('window.__dbg.speed(4)');
await p.waitForFunction('window.__game.world.doors.front.t > 0.9', null, { timeout: 90000 });
await ev('window.__dbg.speed(1)');
// 外 (corridor) で左スティックを上へ → 前進 (向きはドア方向 yaw=π → +z へ)
const z0 = await ev('window.__game.player.pos.z');
await touch('touchStart', [{ x: 130, y: 300, id: 1 }]);
await wait(100);
await touch('touchMove', [{ x: 130, y: 250, id: 1 }]);
await wait(1800);
await touch('touchEnd', []);
const z1 = await ev('window.__game.player.pos.z');
ok(z1 > z0 + 0.15, `左スティックのドラッグで前進する (z ${z0.toFixed(2)} → ${z1.toFixed(2)})`);
// 右側ドラッグで視点
const yaw0 = await ev('window.__game.player.yaw');
await touch('touchStart', [{ x: 600, y: 200, id: 2 }]);
for (let i = 1; i <= 8; i++) {
  await touch('touchMove', [{ x: 600 + i * 20, y: 200, id: 2 }]);
  await wait(30);
}
await touch('touchEnd', []);
const yaw1 = await ev('window.__game.player.yaw');
ok(Math.abs(yaw1 - yaw0) > 0.2, `右側のドラッグで視点が回る (Δyaw ${(yaw1 - yaw0).toFixed(2)})`);
// 長押し・ドラッグはタップ扱いにならない
const ints0 = await ev('window.__game.log.totalInspect');
await touch('touchStart', [{ x: 600, y: 200, id: 3 }]);
await wait(30);
await touch('touchMove', [{ x: 650, y: 210, id: 3 }]);
await touch('touchEnd', []);
ok((await ev('window.__game.log.totalInspect')) === ints0, 'ドラッグは調査（タップ）として扱われない');
// ドアの前でタップ → 調査
await ev('window.__dbg.teleport(0, 0.9, Math.PI)');
await ev("window.__game.player.pitch = 0");
await wait(500);
// 玄関ドアは背後なので、靴箱の鍵(トレイ)を見る
await ev('window.__dbg.teleport(-0.2, 0.9, Math.PI / 2 * 1.0, -0.4)');
await wait(800);
const target = await ev(`(()=>{const g=window.__game; const r=g.pickAt(innerWidth/2, innerHeight/2, 8); return r? r.it.id : null})()`);
console.log('   中央のターゲット:', target);
const btnVisible = await ev("!document.getElementById('interactBtn').classList.contains('hidden')");
console.log('   調べるボタン:', btnVisible);
await p.screenshot({ path: `${OUT}/t1_touch.png` });
if (target) {
  const pos = await ev(`(()=>{const g=window.__game; const r=g.pickAt(innerWidth/2, innerHeight/2, 8); const v=r.hit.point.clone().project(g.camera); return {x:(v.x+1)/2*innerWidth, y:(1-v.y)/2*innerHeight}})()`);
  const before = await ev('window.__game.log.totalInspect');
  await touch('touchStart', [{ x: pos.x, y: pos.y, id: 4 }]);
  await wait(60);
  await touch('touchEnd', []);
  await wait(500);
  ok((await ev('window.__game.log.totalInspect')) > before, '物をタップすると調べられる');
}
// ポーズ・スマホボタン
await p.tap('#btnPhone');
await wait(500);
ok(await ev('window.__game.ui.phoneOpen'), 'スマホボタンで通知画面が開く');
await p.tap('#phoneClose');
await wait(300);
await p.tap('#btnPause');
await wait(500);
ok(await ev('window.__game.paused'), 'メニューボタンで一時停止する');
await p.screenshot({ path: `${OUT}/t2_pause.png` });
await p.tap('#pResume');
await wait(300);
// 縦画面
await p.setViewportSize({ width: 393, height: 852 });
await wait(800);
ok(await ev("!document.getElementById('rotate').classList.contains('hidden')"), '縦画面では「横向きにしてください」を表示する');
await p.screenshot({ path: `${OUT}/t3_portrait.png` });
await p.setViewportSize({ width: 852, height: 393 });
await wait(600);
ok(await ev("document.getElementById('rotate').classList.contains('hidden')"), '横画面に戻ると案内が消える');
ok(errors.length === 0, `重大なエラーなし (${errors.length})`);
errors.slice(0, 5).forEach((e) => console.log('    ' + e.slice(0, 200)));
await browser.close();
console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
