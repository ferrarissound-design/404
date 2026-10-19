// 通しプレイの自動テスト（ヘッドレス Chromium + ソフトウェアGL）
//
//   npm run build && npx vite preview --port 4173 &
//   BASE_URL=http://localhost:4173/ npm test
//
// ゲーム内部のデバッグAPI（window.__game / window.__dbg）で時間を進め、
// 各フェーズへの到達・怪奇現象の発生・分岐・保存/再開・エンディング到達・実行時エラーなしを確認する。
// 実機でしか分からないこと（実フレームレート、タッチ操作の感触、実際の音の聞こえ方）は対象外。
import fs from 'node:fs';
import { createRequire } from 'node:module';

const BASE = process.env.BASE_URL || 'http://localhost:4173/';
const OUT = process.env.OUT_DIR || 'test-output';
const W = +(process.env.W || 640);
const H = +(process.env.H || 360);
const TIER = process.env.TIER || 'low';
fs.mkdirSync(OUT, { recursive: true });

async function loadPlaywright() {
  for (const name of ['playwright-core', 'playwright', '/opt/node22/lib/node_modules/playwright/index.mjs']) {
    try {
      return await import(name);
    } catch (e) {}
  }
  throw new Error('playwright が見つかりません（npm i -D playwright-core か playwright を導入してください）');
}

const { chromium } = await loadPlaywright();
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: { width: W, height: H } });
await ctx.addInitScript((t) => {
  try {
    if (!localStorage.getItem('room404.settings.v1')) localStorage.setItem('room404.settings.v1', JSON.stringify({ quality: t }));
  } catch (e) {}
}, TIER);
const p = await ctx.newPage();
p.setDefaultTimeout(240000);

const errors = [];
p.on('console', (m) => {
  if (m.type() === 'error') errors.push('console: ' + m.text());
});
p.on('pageerror', (e) => errors.push('pageerror: ' + e.message));

let failed = 0;
const ok = (cond, msg) => {
  console.log((cond ? '  ✓ ' : '  ✗ ') + msg);
  if (!cond) failed++;
};
const ev = (js) => p.evaluate(js);
const wait = (ms) => p.waitForTimeout(ms);
const shot = async (n) => {
  await wait(250);
  await p.screenshot({ path: `${OUT}/${n}.png` });
};
const S = (path) => ev(`window.__game.S.${path}`);
const tp = (x, z, yaw = 0, pitch = 0) => ev(`window.__dbg.teleport(${x},${z},${yaw},${pitch})`);
const act = (id) => ev(`window.__dbg.interactId('${id}')`);
const speed = (k) => ev(`window.__dbg.speed(${k})`);
const waitFor = async (cond, ms = 150000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await ev(cond)) return true;
    await wait(250);
  }
  return false;
};
const section = (t) => console.log('\n■ ' + t);

section('起動・タイトル');
await p.goto(BASE);
await p.waitForSelector('#loading.hidden', { state: 'attached' });
await wait(1500);
ok(await ev("!document.getElementById('title').classList.contains('hidden')"), 'タイトル画面が表示される');
await shot('00_title');

section('プロローグ');
await p.click('#btnStart');
await wait(2500);
ok((await S('phase')) === 'prologue', 'プロローグが始まる');
await act('frontDoor');
await speed(4);
ok(await S('flags.unlocked'), '玄関のドアを解錠できる');
ok(await waitFor("window.__game.ui.messages.some(m => m.app === 'スマートロック')", 90000), 'スマートロックの通知が届く');
await waitFor('window.__game.world.doors.front.t > 0.9', 60000);
await speed(1);
await tp(0, 0.8, 0);
ok(await waitFor("window.__game.S.phase === 'act1'", 60000), '敷居を越えると第1幕');

section('第1幕：探索と行動ログ');
await tp(0.2, 2.8, Math.PI);
await act('switchHall');
await tp(0, 3.0, Math.PI);
await act('ldkDoor');
await wait(1200);
await tp(0, 3.9, Math.PI + 0.3);
await act('switchLDK');
await wait(800);
await tp(-0.2, 4.3, Math.PI * 0.75, -0.1);
await shot('10_ldk');
for (const id of ['mug0', 'coffeeMaker', 'photo', 'clock', 'calendar', 'fridge']) {
  await act(id);
  await wait(300);
  if (await ev('window.__game.ui.examineOpen')) await p.click('.ex-close');
}
ok((await ev('window.__game.log.totalInspect')) >= 5, '調査ログが記録される');
await ev('window.__game.S.phaseT = 100; window.__game.log.rooms.ldk = 30;');
await speed(6);
ok(await waitFor('window.__game.S.flags.bell === true', 90000), 'インターホンが鳴る');
await speed(1);
await tp(0.3, 1.0, -Math.PI / 2);
await act('intercom');
await wait(800);
ok(await ev('!!window.__game.view'), 'インターホンの映像を見られる');
await shot('11_intercom');
await p.click('#viewClose');
await wait(300);

section('共用廊下 1回目');
await act('frontDoor');
await speed(4);
await wait(2500);
await speed(1);
await tp(3.2, -0.9, -Math.PI / 2);
ok(await waitFor("window.__game.S.phase === 'trip1'", 60000), '玄関の外に出ると廊下イベントが始まる');
await speed(6);
ok(await waitFor('window.__game.S.flags.m1 === true', 150000), '玄関が閉まり、部屋の変化(M1)が適用される');
await speed(1);
ok((await S('world.mugs')) === 3 && (await S('world.photo')) === 1, 'マグカップが3つ・写真が変化している');
await tp(0.2, -0.9, Math.PI);
await act('frontDoor');
await wait(400);
ok(!(await S('flags.tripDone1')) ? (await S('phase')) === 'trip1' : true, '廊下イベント完了前はドアが開かない（または完了済み）');
await tp(7.4, -0.95, -Math.PI / 2);
await speed(6);
await waitFor('window.__game.S.flags.tripDone1 === true', 150000);
await shot('20_elevator');
await speed(1);
ok(await S('flags.tripDone1'), 'エレベーターの怪異が終わる');
await tp(0, -0.9, Math.PI);
await act('frontDoor');
await speed(3);
await wait(2500);
await speed(1);
await tp(0, 0.8, Math.PI);
ok(await waitFor("window.__game.S.phase === 'act2'", 60000), '戻ると第2幕（帰宅回数の通知）');
ok(await waitFor("window.__game.ui.messages.some(m => (m.body||'').includes('帰宅回数：7'))", 60000), '通知「本日の帰宅回数：7」が届く');

section('第2幕：判断と分岐');
await tp(-0.2, 4.4, Math.PI * 0.8, -0.2);
await shot('30_act2_ldk');
await act('mug1');
await wait(300);
await speed(6);
await waitFor('window.__game.ui.choiceOpen', 60000);
await speed(1);
ok(await ev('window.__game.ui.choiceOpen'), '変化を調べると「信じる/疑う」の選択が出る');
await p.click('#choice .c-btns button:nth-child(1)');
await wait(500);
ok((await S('decisions.mugs')) === 'trust', '判断が記録される（信じる）');
await act('shoes');
await wait(300);
await speed(6);
await waitFor('window.__game.ui.choiceOpen', 60000);
await speed(1);
await p.click('#choice .c-btns button:nth-child(2)');
await wait(400);
ok((await S('decisions.shoes')) === 'doubt', '判断が記録される（疑う）');
// 保存→再開
await ev('window.__game.save()');
ok(await ev("!!localStorage.getItem('room404.save.v1')"), '自動保存が書き込まれる');
await ev('window.__game.S.phaseT = 80');
await speed(8);
ok(await waitFor('window.__game.S.flags.summoned === true', 150000), '玄関に呼び出される');
await speed(1);
await ev('window.__game.S.flags.doorSwung = true; window.__game.world.doors.front.open(1, 1.0)');
await wait(1500);
await tp(0, -0.9, Math.PI);
ok(await waitFor("window.__game.S.phase === 'trip2'", 60000), '玄関の外に出ると共用廊下 2回目');
await tp(3.4, -0.9, -Math.PI / 2);
await speed(6);
ok(await waitFor('window.__game.S.flags.m2 === true', 150000), '部屋の変化(M2)が適用される');
await speed(1);
ok((await S('world.hallDz')) > 0, '廊下が長くなっている');
ok((await S('world.mugs')) === 1, '信じた項目(マグカップ)は元に戻っている（記憶を疑わせる）');
ok((await S('world.shoes')) === 3, '疑った項目(靴)は悪化している');
await tp(7.4, -0.95, -Math.PI / 2);
await wait(300);
await act('elevPanel');
await speed(6);
await waitFor('window.__game.S.flags.tripDone2 === true', 150000);
await speed(1);
await shot('40_trip2');
await tp(0, -0.9, Math.PI);
await act('frontDoor');
await speed(3);
await wait(2500);
await speed(1);
await tp(0, 0.8, Math.PI);
ok(await waitFor("window.__game.S.phase === 'act3'", 60000), '第3幕へ');
await shot('50_act3_genkan');
await tp(0, 3.9, Math.PI);
await shot('51_act3_hall');

section('第3幕：停電とブレーカー');
await speed(8);
ok(await waitFor("window.__game.S.phase === 'blackout'", 240000), '停電が起きる');
await speed(1);
ok(await waitFor('window.__game.S.world.power === false', 90000), '電源が落ちている');
await wait(1000);
await shot('60_blackout');
await tp(0.3, 0.7, 0);
await act('breaker');
await speed(4);
ok(await waitFor("window.__game.S.phase === 'finale'", 60000), 'ブレーカーを上げると最終場面');
await speed(1);
await wait(800);
await tp(-0.4, 5.0, 2.0, -0.1);
await wait(800);
await shot('70_finale');
ok(await ev('window.__game.world.props.figure.visible'), '食卓に人影がいる');

section('保存・再開');
await ev('window.__game.save()');
await p.reload();
await p.waitForSelector('#loading.hidden', { state: 'attached' });
await wait(1200);
ok(await ev("!document.getElementById('btnContinue').classList.contains('hidden')"), 'タイトルに「つづきから」が出る');
await p.click('#btnContinue');
await wait(2500);
ok((await S('phase')) === 'finale', '再開すると最終場面から始まる');
ok((await S('world.mugs')) === 7, '世界の状態が復元されている');

section('音響（全SEの生成）');
const audioErrs = await ev(`(() => {
  const a = window.__game.audio;
  const errs = [];
  if (!a.ready) return ['audio not ready'];
  const names = Object.getOwnPropertyNames(Object.getPrototypeOf(a)).filter((n) => n.startsWith('sfx_')).map((n) => n.slice(4));
  for (const n of names) {
    try { a.play(n, { x: 1, y: 1, z: 3 }); a.play(n, {}); } catch (e) { errs.push(n + ': ' + e.message); }
  }
  try { a.footstep('wood'); a.footstep('concrete'); a.footstep('tile'); a.footstep('rug'); a.tick(0, 1, 0, true); a.tvOn(0, 1, 0); a.tvOff(); a.silence(0.2, 0.1); } catch (e) { errs.push('misc: ' + e.message); }
  return { n: names.length, errs };
})()`);
ok(Array.isArray(audioErrs) ? false : audioErrs.errs.length === 0 && audioErrs.n >= 25, `全SE(${audioErrs.n ?? 0}種)の生成でエラーが出ない`);
if (audioErrs.errs && audioErrs.errs.length) console.log('    ' + audioErrs.errs.join('\n    '));

section('結末');
await act('figure');
await wait(600);
await speed(6);
await waitFor('window.__game.ui.choiceOpen', 60000);
await speed(1);
ok(await ev('window.__game.ui.choiceOpen'), '「声をかけますか」の選択が出る');
await p.click('#choice .c-btns button:nth-child(1)');
ok(await waitFor("window.__game.S.phase === 'ending'", 30000), 'エンディングに到達');
await wait(6000);
await shot('80_ending');
ok(await ev("!document.getElementById('ending').classList.contains('hidden')"), 'エンディング画面が表示される');
ok(await ev("!localStorage.getItem('room404.save.v1')"), 'クリア後はセーブが消える');

section('描画負荷（ヘッドレス参考値）');
const info = await ev('window.__dbg.info()');
console.log('  ', JSON.stringify(info));

section('結果');
const realErrors = errors.filter((e) => !/willReadFrequently|GPU stall|ReadPixels/.test(e));
ok(realErrors.length === 0, `重大なエラーなし (${realErrors.length})`);
realErrors.slice(0, 10).forEach((e) => console.log('    ' + e.slice(0, 300)));
fs.writeFileSync(`${OUT}/errors.json`, JSON.stringify(errors, null, 1));
await browser.close();
console.log(failed ? `\n${failed} 件失敗` : '\nすべて成功');
process.exit(failed ? 1 : 0);
