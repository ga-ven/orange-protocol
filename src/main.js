import { Game } from './game.js';
import { UI } from './ui.js';

function showFatalError(message) {
  const app = document.getElementById('app');
  const box = document.createElement('div');
  box.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:999',
    'display:grid',
    'place-items:center',
    'padding:24px',
    'background:#fff1da',
    'color:#4a3024',
    'font-family:"Microsoft YaHei",sans-serif',
    'text-align:center',
  ].join(';');
  box.innerHTML = `
    <div style="max-width:520px;padding:32px;border:1px solid rgba(255,255,255,.8);border-radius:24px;background:#fffaf0;box-shadow:0 24px 70px rgba(121,65,31,.18)">
      <div style="font-size:11px;font-weight:800;letter-spacing:.16em;color:#d94b12">ORANGE PROTOCOL / BOOT ERROR</div>
      <h1 style="font-size:34px;margin:10px 0">无法接入战场</h1>
      <p style="font-size:13px;line-height:1.8;color:#7e5b49">${message}</p>
      <p style="font-size:11px;line-height:1.7;color:#9b7761">请使用桌面版 Chrome 或 Edge，并确认浏览器已开启 WebGL。</p>
    </div>
  `;
  app.appendChild(box);
}

try {
  const canvas = document.getElementById('game-canvas');
  if (!canvas) throw new Error('找不到游戏画布。');
  const game = new Game(canvas);
  const ui = new UI(game);
  game.setUI(ui);
} catch (error) {
  console.error(error);
  showFatalError(error?.message || '初始化过程中发生未知错误。');
}
