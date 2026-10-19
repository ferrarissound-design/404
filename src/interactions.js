// 調べる操作：IDごとの独白・状態変化・選択（行動ログと連動）
import * as Art from './art.js';
import { NOTIF } from './story.js';
import { AJAR } from './state.js';

const flat = (g) => g.S.world;

/** 変化の判断（信じる / 疑う）*/
async function decide(g, key, text, optTrust, optDoubt) {
  if (g.S.decisions[key]) return g.S.decisions[key];
  const v = await g.ui.choice(text, [
    { label: optTrust, value: 'trust' },
    { label: optDoubt, value: 'doubt' },
  ]);
  g.S.decisions[key] = v;
  g.S.trust += v === 'trust' ? 1 : -1;
  g.log.choices.push({ key, v, t: Math.round(g.S.playSec) });
  g.audio.play('heartbeat', { gain: 0.5 });
  if (v === 'trust') g.say(['……やっぱり、違う。', 'たしかに、覚えている。'], { gap: 0.4 });
  else g.say(['……気のせいだ。', '疲れているだけだ。'], { gap: 0.4 });
  g.director.onDecision(key, v);
  return v;
}

const photoDraw = (variant) => (x, w, h) => Art.drawFamilyPhoto(x, w, h, variant);

export const H = {
  // ---------------------------------------------------------------- 玄関
  keys(g) {
    g.audio.play('keys', { x: -0.72, y: 1, z: 0.55 });
    if (flat(g).keysMissing) return g.say('鍵が、ない。……さっき、ここに置いたはずなのに。');
    g.say(g.S.act <= 1 ? '鍵。いつもの場所に置く。' : '鍵はここにある。……ちゃんと、帰ってきた証拠だ。');
  },
  shoes(g) {
    const s = flat(g).shoes;
    if (s === 0 && g.S.act >= 2 && g.S.decisions.shoes === 'trust') return g.say(['自分の靴だけだ。', '……さっきの女物の靴は、どこへ行った？']);
    if (s === 0) return g.say('自分の靴だけだ。脱ぎっぱなしにしてしまった。');
    if (s === 1 && g.S.act >= 2) {
      g.say('見覚えのない、女物の靴。……ヒールがすり減っている。');
      return g.after(2.6, () => decide(g, 'shoes', 'こんな靴は、なかった。', '確かに、なかった', '前からあったのかもしれない'));
    }
    if (s >= 2) return g.say(['小さな靴が増えている。', '玄関いっぱいの、家族の靴。', s >= 3 ? 'どの靴も、家の中を向いて揃えてある。' : '']);
  },
  umbrella(g) {
    g.say('傘立て。……傘が二本、濡れている。', 3000);
  },
  intercom(g) {
    g.director.useIntercom();
  },
  breaker(g) {
    g.director.useBreaker();
  },
  genkanMirror(g) {
    const n = g.S.act;
    if (n <= 1) g.say('疲れた顔だ。……ずいぶん痩せたな。');
    else if (n === 2) g.say('鏡に映る自分が、少し遅れて動いた気がした。');
    else g.say('鏡の中の玄関は、きれいに整っている。……誰かが毎日、掃除していたみたいに。');
  },
  jacket(g) {
    g.say(g.S.act <= 1 ? '上着。ポケットには何も入っていない。' : '上着から、線香のにおいがする。');
  },
  switchHall(g) {
    toggleLight(g, 'hallLight', 'switchHall');
  },
  switchLDK(g) {
    toggleLight(g, 'ldkLight', 'switchLDK');
  },
  switchBed(g) {
    toggleLight(g, 'bedLight', 'switchBed');
  },
  switchBath(g) {
    toggleLight(g, 'bathLight', 'switchBath');
  },
  switchToilet(g) {
    toggleLight(g, 'toiletLight', 'switchToilet');
  },

  // ---------------------------------------------------------------- 寝室のドア（変化への判断）
  bedDoor(g) {
    const st = flat(g);
    if (g.S.act >= 2 && st.bedDoor === 1 && !g.S.decisions.bedDoor) {
      g.say(['寝室のドアが、少し開いている。', '閉めたはずなのに。']);
      g.after(3.4, () => decide(g, 'bedDoor', 'ドアが開いている。', '確かに閉めた', '閉め忘れたのかもしれない'));
      return;
    }
    g.useDoor('bed');
  },

  // ---------------------------------------------------------------- 廊下
  drawing(g) {
    const v = flat(g).drawing;
    const lines = [
      '娘の絵だ。家の前に、三人並んでいる。\nパパ、ママ、わたし。',
      'パパの上に、黒いクレヨンが塗り重ねられている。',
      'パパの場所だけ、消しゴムで消したように白い。',
      '知らない、背の高い黒い人。「だれ？」と書いてある。',
    ];
    g.examine({ title: '子どもの絵', draw: (x, w, h) => Art.drawChildDrawing(x, w, h, v), text: lines[v], w: 640, h: 512 });
    g.log.inspect('drawing', 'drawing');
  },
  homePhone(g) {
    g.say(g.S.act >= 3 ? '受話器が、外れている。……ずっと誰かが、待っている音がする。' : '固定電話。もう何年も、鳴ったことがない。');
  },

  // ---------------------------------------------------------------- 水回り
  bathtub(g) {
    const st = flat(g);
    if (g.S.act <= 1) return g.say('浴槽の蓋は閉まっている。今夜はシャワーでいい。');
    g.say(st.bathWater ? '蓋の下で、水が揺れている。……誰も使っていないのに、温かい。' : '蓋の隙間から、水の音が聞こえる。');
  },
  bathMirror(g) {
    g.audio.play('drip', { x: -1.62, y: 1.2, z: 1.6 });
    if (g.S.act <= 1) return g.say('洗面所の鏡。髪が伸びたな。');
    g.say(g.S.act === 2 ? '鏡の隅が、曇っている。……手の跡のような。' : '鏡の中の自分が、少しだけ笑っていない。');
  },
  washer(g) {
    g.say('洗濯機の中は空っぽだ。……洗濯物は、全部取り込んである。');
  },
  toiletBowl(g) {
    g.audio.play('flush', { x: 1.7, y: 0.6, z: 2.15 });
    g.say('水を流した。', 2400);
  },

  // ---------------------------------------------------------------- LDK
  fridge(g) {
    const st = flat(g);
    const d = g.world.doors.fridge;
    d.toggle();
    st.fridgeOpen = d.target > 0.05;
    if (st.fridgeOpen) {
      g.world.props.fridge.light.color.setScalar(2.4);
      g.after(0.6, () => g.say(g.S.act <= 1 ? '冷蔵庫の中は、ほとんど空だ。牛乳と、コーヒー豆。' : st.fridgeMugs ? 'マグカップが、冷蔵庫の中に並んでいる。……冷たいコーヒーが入っている。' : '牛乳と、コーヒー豆と、誰かが作り置きした何か。'));
    } else g.world.props.fridge.light.color.setScalar(0);
  },
  fridgeNote(g) {
    const v = flat(g).fridgeNote;
    const t = ['ゴミ出し 水曜。自分の字だ。', '「コーヒー豆 買う」……こんなメモ、書いたっけ。', '「コーヒーは毎朝お願い」。自分の字ではない。', '「おかえり」。いつから、貼ってあったのだろう。'];
    g.say(t[v]);
  },
  coffeeMaker(g) {
    if (g.S.act <= 1) g.say(['ポットの中は、ほとんど空だ。', '一杯分だけ淹れた。マグカップも、一つ。']);
    else if (flat(g).mugs >= 3) g.say('ポットが、いっぱいになっている。……淹れた覚えは、ない。');
    else g.say('ポットの中は、まだ温かい。');
  },
  kettle(g) {
    g.say('電気ケトル。触れると、少し温かい。');
  },
  sink(g) {
    g.audio.play('water', { x: -2.55, y: 1.1, z: 3.8 + g.world.hallDz, dur: 3 });
    g.say('蛇口をひねった。冷たい水が、しばらく出た。', 3000);
  },
  trash(g) {
    g.say(g.S.act <= 1 ? 'ゴミ箱。コンビニの袋が入っている。' : 'ゴミ箱の中は、同じ種類のコーヒーの空き袋でいっぱいだ。');
  },
  table(g) {
    g.say(g.S.act <= 1 ? 'ダイニングテーブル。二人掛けだけど、いつも一人で使っている。' : 'テーブルの上に、リングの跡がいくつも残っている。');
  },
  chair(g, it) {
    const st = flat(g);
    const pulled = it.id === 'chairA' ? st.chairA : st.chairB;
    g.say(pulled ? '椅子が引かれている。……さっきまで、誰かが座っていたみたいに。' : '椅子。動かした覚えはない。');
  },
  bag(g) {
    g.say(g.S.act <= 1 ? '通勤鞄。中身は、仕事の資料と財布。' : '鞄の中の資料は、日付がすべて、同じ日になっている。');
  },
  mail(g) {
    const v = flat(g).mail;
    g.examine({
      title: v === 1 ? '管理会社からの手紙' : 'ご利用料金のお知らせ',
      draw: (x, w, h) => Art.drawMail(x, w, h, v),
      text: v === 1 ? '……存在しない？\nここは、自分の部屋だ。毎日、帰ってきている。' : '使用実績がない。\n毎日、使っているのに。',
      w: 640,
      h: 450,
    });
    g.log.inspect('mail', 'mail');
  },
  async mug(g, it) {
    const st = flat(g);
    const i = it.idx ?? 0;
    g.log.inspect('mug', 'mug' + i);
    const sub = st.steam ? 'まだ、湯気が立っている。……淹れたばかりのように。' : null;
    if (g.S.act <= 1) {
      g.say(['飲みかけのコーヒー。', 'まだ少し温かい。一杯だけ淹れた。']);
      return;
    }
    if (st.mugs === 1) {
      g.say('マグカップは、ひとつだけ。……じゃあ、さっきの数は何だったんだろう。');
      return;
    }
    if (st.mugs >= 7) g.say(sub || ['同じマグカップが、七つ。', 'どれも、冷めきっていない。']);
    else g.say(sub || `マグカップが${st.mugs}つ。どれも、飲みかけだ。`);
    if (!g.S.decisions.mugs) g.after(3.0, () => decide(g, 'mugs', 'マグカップが増えている。', 'こんなに出していない', '自分で出したのかもしれない'));
  },
  clock(g) {
    const st = flat(g);
    const m = Math.floor(g.S.clock);
    const hh = Math.floor((m / 60) % 24);
    const mm = m % 60;
    g.audio.tick(-3.55, 1.95, 4.85 + g.world.hallDz, true);
    if (st.clockMode === 'stop404') return g.say('4時4分。……秒針だけが、同じ場所で震えている。');
    if (st.clockMode === 'reverse') return g.say('針が、逆に回っている。');
    g.say(`${hh}時${String(mm).padStart(2, '0')}分。……日付は、まだ今日のままだ。`);
  },
  calendar(g) {
    const v = flat(g).calendar;
    const t = [
      '今日に赤い丸がついている。……何の日だったか、思い出せない。',
      '数日分に、赤いバツ。今日の欄には「初七日」と書かれている。',
      '十一月三十日に丸。「四十九日」。……バツは、すべて今日までついている。',
    ];
    g.examine({ title: 'カレンダー', draw: (x, w, h) => Art.drawCalendar(x, w, h, v), text: t[v], w: 520, h: 720 });
    g.log.inspect('calendar', 'calendar');
  },
  async photo(g) {
    const v = flat(g).photo;
    if (v === 0 && g.S.act >= 2 && g.S.decisions.photo === 'trust') {
      g.audio.play('click', {});
      g.say(['写真は、三人で笑っている。', '……元に戻っている。さっきは、確かに——。']);
    }
    const t = [
      '公園で撮った三人の写真。……いい天気だった。',
      '写真の中の、自分だけが白く飛んでいる。顔が、見えない。',
      '三人で撮ったはずなのに。自分のいた場所だけ、空いている。',
      '黒いリボンのついた額縁。写っているのは……自分だ。',
      'みんなの目が、こちらを見ている。',
    ];
    g.log.inspect('photo', 'photo');
    const res = await g.examine({
      title: '家族写真',
      draw: photoDraw(v),
      text: t[v],
      w: v === 3 ? 480 : 640,
      h: 480,
      choices: null,
    });
    if (v === 1 && !g.S.decisions.photo) g.after(0.4, () => decide(g, 'photo', '写真の自分が、消えかかっている。', '確かに、こうじゃなかった', '光の加減だ'));
    if (v === 3) g.director.onPhotoMemorial();
  },
  incense(g) {
    g.say('線香の煙が、まっすぐ立ちのぼっている。……誰が、火をつけたのだろう。');
  },
  async tv(g) {
    const st = flat(g);
    if (st.tv === 'off') {
      g.setTV('static');
      g.say('テレビがついた。……映る局は、ない。');
    } else {
      g.setTV('off');
      g.say('テレビを消した。', 2000);
    }
    g.log.inspect('tv', 'tv');
  },
  remote(g) {
    g.say('リモコン。電池が切れている……はずなのに、ボタンが温かい。', 3400);
  },
  sofa(g) {
    g.say(g.S.act <= 1 ? 'ソファ。座ったらもう立てなくなりそうだ。' : 'ソファのくぼみが、まだ温かい。');
  },
  plant(g) {
    g.say('観葉植物。……水をやった覚えは、ないのに、元気だ。');
  },
  ac(g) {
    g.say('エアコンは止まっている。それなのに、冷たい風が当たる。');
  },
  window(g) {
    const st = flat(g);
    g.audio.play('click', {});
    if (g.S.act <= 1) return g.say('ベランダの窓。鍵はかかっている。向かいのマンションの明かりが見える。');
    if (st.watcherS) return g.say('向かいの窓に、誰かが立っている。……こちらを、見ている。');
    g.say('窓は閉まっている。それなのに、カーテンが揺れている。');
  },
  bedWindow(g) {
    g.say('寝室の窓。外は、深い霧。何も見えない。');
  },
  curtain(g) {
    g.say('厚手のカーテン。……手を離しても、まだ揺れている。');
  },

  // ---------------------------------------------------------------- 寝室
  bed(g) {
    g.say(g.S.act <= 1 ? 'ベッド。今夜は、すぐ眠れそうにない。' : 'シーツに、人のかたちのくぼみが残っている。');
  },
  bedBump(g) {
    g.say('布団が、ゆっくり上下している。……近づかないほうがいい。');
  },
  alarm(g) {
    g.say(`目覚まし時計は ${g._alarmLabel || '--:--'} を指している。`);
    g.log.inspect('clock', 'alarm');
  },
  toy(g) {
    const t = flat(g).toy;
    g.say(t === 0 ? 'くまのぬいぐるみ。娘のお気に入りだ。' : 'ぬいぐるみが、床の上でこちらを向いている。……動かした覚えは、ない。');
  },
  laptop(g) {
    g.say('ノートPC。電源が入らない。……画面に、自分の顔が映った。');
  },
  figure(g) {
    g.director.useFigure();
  },
  // 汎用
  default(g, it) {
    g.say('……特に変わったところはない。', 2400);
  },
};

function toggleLight(g, key, swKey) {
  const st = flat(g);
  if (!st.power) return g.say('スイッチを押しても、反応しない。……停電だ。');
  st[key] = !st[key];
  g.audio.play('switch', { x: g.world.props[swKey].group.position.x, y: 1.2, z: g.world.props[swKey].group.position.z + (swKey === 'switchLDK' || swKey === 'switchBed' ? g.world.hallDz : 0) });
  g.apply();
  g.log.lights[key] = (g.log.lights[key] || 0) + 1;
}
