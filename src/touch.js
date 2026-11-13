// 触屏输入层：左下摇杆走位、右侧滑动转视角、右下开火/换弹/脉冲。
// 全部用 Pointer Events，天然支持多指同时操作（边走边打边转视角）。
// 桌面端根本不会 mount 这里——game 只在 pointer: coarse 的设备上挂载。
import { CONFIG } from './config.js';

const LOOK_MULTIPLIER = 1.6; // 手指滑动比鼠标拖拽"沉"，乘一个系数抵消
const SPRINT_THRESHOLD = 0.92; // 摇杆推到底视为冲刺
const DEAD_ZONE = 0.14; // 手指轻微抖动的死区

export class TouchControls {
  constructor(game) {
    this.game = game;
    this.layer = document.getElementById('touch-layer');
    this.zone = document.getElementById('stick-zone');
    this.knob = document.getElementById('stick-knob');
    this.fireButton = document.getElementById('touch-fire');
    this.reloadButton = document.getElementById('touch-reload');
    this.skillButton = document.getElementById('touch-skill');
    this.radioButton = document.getElementById('touch-radio');
    this.pauseButton = document.getElementById('touch-pause');
    this.interactButton = document.getElementById('touch-interact');

    this.stickPointer = null;
    this.lookPointer = null;
    this.lookLast = { x: 0, y: 0 };
    this.center = { x: 0, y: 0 };
    this.radius = 46;
  }

  mount() {
    document.body.classList.add('is-touch');
    this.layer.classList.remove('hidden');
    this.bindStick();
    this.bindLook();
    this.bindButtons();
    // 布局完成后才能量到摇杆底座的真实位置
    requestAnimationFrame(() => this.measure());
    window.addEventListener('resize', () => this.measure());
    window.addEventListener('orientationchange', () => setTimeout(() => this.measure(), 120));
  }

  measure() {
    if (!this.zone) return;
    const rect = this.zone.getBoundingClientRect();
    if (!rect.width) return; // 层还没显示出来，等下次
    this.center = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    // 摇杆底座半径的 0.8：手指推到底时滑块刚好压住底座外沿
    this.radius = rect.width * 0.3;
  }

  // ---------------------------------------------------------------- 摇杆
  bindStick() {
    const start = (event) => {
      if (this.stickPointer !== null) return;
      event.preventDefault();
      // 触控层在菜单里是隐藏的，布局尺寸只有显示后才有，所以每次按下都重量一次
      this.measure();
      this.stickPointer = event.pointerId;
      this.zone.classList.add('is-active');
      try {
        this.zone.setPointerCapture(event.pointerId);
      } catch (error) {
        /* 某些浏览器不支持捕获，忽略 */
      }
      this.moveStick(event);
    };
    const move = (event) => {
      if (event.pointerId !== this.stickPointer) return;
      event.preventDefault();
      this.moveStick(event);
    };
    const end = (event) => {
      if (this.stickPointer === null) return;
      if (event.pointerId !== undefined && event.pointerId !== this.stickPointer) return;
      this.stickPointer = null;
      this.releaseStick();
    };

    this.zone.addEventListener('pointerdown', start);
    this.zone.addEventListener('pointermove', move);
    this.zone.addEventListener('pointerup', end);
    this.zone.addEventListener('pointercancel', end);
    this.zone.addEventListener('lostpointercapture', end);
  }

  moveStick(event) {
    const dx = event.clientX - this.center.x;
    const dy = event.clientY - this.center.y;
    const length = Math.hypot(dx, dy);
    const clamped = Math.min(length, this.radius);
    const nx = length > 0 ? (dx / length) * (clamped / this.radius) : 0;
    const ny = length > 0 ? (dy / length) * (clamped / this.radius) : 0;

    this.knob.style.transform = `translate3d(${(nx * this.radius).toFixed(1)}px, ${(ny * this.radius).toFixed(1)}px, 0)`;

    if (Math.hypot(nx, ny) < DEAD_ZONE) {
      this.releaseStick();
      return;
    }
    const input = this.game.input;
    input.moveX = nx;
    input.moveY = -ny; // 屏幕向下 = 后退
    input.sprintTouch = Math.hypot(nx, ny) > SPRINT_THRESHOLD;
  }

  releaseStick() {
    const input = this.game.input;
    input.moveX = 0;
    input.moveY = 0;
    input.sprintTouch = false;
    this.zone?.classList.remove('is-active');
    if (this.knob) this.knob.style.transform = 'translate3d(0, 0, 0)';
  }

  // ---------------------------------------------------------------- 视角
  bindLook() {
    const canvas = this.game.canvas;
    const start = (event) => {
      if (event.pointerType === 'mouse') return; // 桌面仍走原来的鼠标逻辑
      if (this.lookPointer !== null) return;
      this.lookPointer = event.pointerId;
      this.lookLast = { x: event.clientX, y: event.clientY };
      try {
        canvas.setPointerCapture(event.pointerId);
      } catch (error) {
        /* 忽略 */
      }
    };
    const move = (event) => {
      if (event.pointerId !== this.lookPointer) return;
      const dx = event.clientX - this.lookLast.x;
      const dy = event.clientY - this.lookLast.y;
      this.lookLast = { x: event.clientX, y: event.clientY };
      if (this.game.state !== 'playing' || this.game.ui?.radioOpen) return;
      this.game.player.applyLook(
        dx * LOOK_MULTIPLIER,
        dy * LOOK_MULTIPLIER,
        CONFIG.player.mouseSensitivity,
      );
    };
    const end = (event) => {
      if (event.pointerId !== this.lookPointer) return;
      this.lookPointer = null;
    };

    canvas.addEventListener('pointerdown', start);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', end);
    canvas.addEventListener('pointercancel', end);
    canvas.addEventListener('lostpointercapture', end);
  }

  // ---------------------------------------------------------------- 按钮
  bindButtons() {
    this.bindHold(
      this.fireButton,
      () => {
        this.game.input.mouseDown = true;
      },
      () => {
        this.game.input.mouseDown = false;
      },
    );

    // 扶起队友：和开火一样是「按住生效」，而且必须能一边扶一边不误触开火
    this.bindHold(
      this.interactButton,
      () => {
        this.game.input.interactHold = true;
      },
      () => {
        this.game.input.interactHold = false;
      },
    );

    this.reloadButton?.addEventListener('click', (event) => {
      event.preventDefault();
      if (this.game.player.startReload()) this.game.audio.reloadStart();
    });

    this.skillButton?.addEventListener('click', (event) => {
      event.preventDefault();
      this.game.player.useSkill(this.game);
    });

    this.radioButton?.addEventListener('click', (event) => {
      event.preventDefault();
      this.game.ui?.openRadio();
    });

    this.pauseButton?.addEventListener('click', (event) => {
      event.preventDefault();
      this.game.pause();
    });
  }

  // 按住持续生效、抬手立即松开：开火键必须这样，click 会有延迟
  bindHold(button, onDown, onUp) {
    if (!button) return;
    const down = (event) => {
      event.preventDefault();
      button.classList.add('is-active');
      try {
        button.setPointerCapture(event.pointerId);
      } catch (error) {
        /* 忽略 */
      }
      onDown();
    };
    const up = () => {
      if (!button.classList.contains('is-active')) return;
      button.classList.remove('is-active');
      onUp();
    };
    button.addEventListener('pointerdown', down);
    button.addEventListener('pointerup', up);
    button.addEventListener('pointercancel', up);
    button.addEventListener('lostpointercapture', up);
    button.addEventListener('contextmenu', (event) => event.preventDefault());
  }

  // 暂停、切后台、结算时兜底松开，避免"人离开屏幕还在开火"
  releaseAll() {
    this.releaseStick();
    this.stickPointer = null;
    this.lookPointer = null;
    this.game.input.mouseDown = false;
    this.game.input.interactHold = false;
    this.fireButton?.classList.remove('is-active');
    this.interactButton?.classList.remove('is-active');
  }
}
