import './style.css';
import { Game } from './game.js';

const game = new Game();
game.boot().catch((e) => {
  console.error(e);
  const el = document.querySelector('.l-text');
  if (el) el.textContent = '起動に失敗しました。ブラウザを更新してみてください。';
  const sub = document.querySelector('.l-sub');
  if (sub) sub.textContent = String(e && e.message ? e.message : e);
});
