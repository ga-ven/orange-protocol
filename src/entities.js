import * as THREE from '../vendor/three.module.js';
import { COLORS, CONFIG, ENEMY_TYPES, INTENT_LABELS, SPAWN_SIDES } from './config.js';
import {
  angleTo,
  clamp,
  createGlowSprite,
  createTextSprite,
  damp,
  dist2D,
  hasLineOfSight,
  moveActor,
  rand,
} from './utils.js';

function standard(color, options = {}) {
  return new THREE.MeshStandardMaterial({
    color,
    roughness: options.roughness ?? 0.72,
    metalness: options.metalness ?? 0.05,
    flatShading: options.flatShading ?? true,
    emissive: options.emissive ?? 0x000000,
    emissiveIntensity: options.emissiveIntensity ?? 0,
    transparent: options.transparent ?? false,
    opacity: options.opacity ?? 1,
    depthTest: options.depthTest ?? true,
    depthWrite: options.depthWrite ?? true,
  });
}

function box(width, height, depth, material) {
  return new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
}

function createShadow(color = 0x7b4a31, opacity = 0.16, radius = 0.7) {
  const shadow = new THREE.Mesh(
    new THREE.CircleGeometry(radius, 20),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity,
      depthWrite: false,
    }),
  );
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = 0.026;
  shadow.renderOrder = 1;
  return shadow;
}

function makeHealthBar() {
  const canvas = document.createElement('canvas');
  canvas.width = 160;
  canvas.height = 28;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: texture,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    }),
  );
  sprite.scale.set(1.55, 0.27, 1);
  sprite.renderOrder = 30;
  sprite.visible = false;
  return { sprite, canvas, texture };
}

function drawHealthBar(state, ratio) {
  const ctx = state.canvas.getContext('2d');
  const width = state.canvas.width;
  const height = state.canvas.height;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = 'rgba(74,49,38,0.74)';
  ctx.beginPath();
  ctx.roundRect(0, 5, width, height - 10, 8);
  ctx.fill();
  const innerWidth = Math.max(0, (width - 8) * ratio);
  const gradient = ctx.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, ratio > 0.35 ? '#ff8a3d' : '#e54e3f');
  gradient.addColorStop(1, ratio > 0.35 ? '#ffd28a' : '#ff8067');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.roundRect(4, 9, innerWidth, height - 18, 5);
  ctx.fill();
  state.texture.needsUpdate = true;
}

function createPlayerViewmodel() {
  const root = new THREE.Group();
  root.position.set(0.55, -0.44, -1.2);
  root.scale.setScalar(0.76);
  const cream = standard(COLORS.cream, { roughness: 0.58, depthTest: false, depthWrite: false });
  const orange = standard(COLORS.orange, { roughness: 0.44, depthTest: false, depthWrite: false });
  const orangeDeep = standard(COLORS.orangeDeep, { roughness: 0.55, depthTest: false, depthWrite: false });
  const teal = standard(COLORS.teal, { roughness: 0.46, depthTest: false, depthWrite: false });

  // 机匣：深橙下机匣 + 亮橙上机匣，双色分界让枪身中段有形
  const receiver = box(0.15, 0.135, 0.4, orangeDeep);
  receiver.position.set(0, -0.005, -0.08);
  root.add(receiver);

  const upper = box(0.142, 0.085, 0.44, orange);
  upper.position.set(0, 0.1, -0.11);
  root.add(upper);

  const topRail = box(0.058, 0.026, 0.34, cream);
  topRail.position.set(0, 0.155, -0.12);
  root.add(topRail);

  // 护木：青绿，和奶油色地面拉开，枪的前半截才不会糊掉
  const handguard = box(0.125, 0.115, 0.26, teal);
  handguard.position.set(0, 0.012, -0.4);
  root.add(handguard);

  // 枪管：细长，明显向前延伸出护木
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.031, 0.4, 10), teal);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.set(0, 0.012, -0.7);
  root.add(barrel);

  // 枪口制退器：让枪管末端有形，不再是一根管子消失在屏幕外
  const muzzleBrake = box(0.068, 0.062, 0.085, orangeDeep);
  muzzleBrake.position.set(0, 0.012, -0.9);
  root.add(muzzleBrake);

  const muzzleLiner = new THREE.Mesh(new THREE.CylinderGeometry(0.019, 0.019, 0.024, 8), teal);
  muzzleLiner.rotation.x = Math.PI / 2;
  muzzleLiner.position.set(0, 0.012, -0.944);
  root.add(muzzleLiner);

  // 机械瞄具：后照门两片 + 前准星柱，形成一条可见的瞄准线
  const rearNotchLeft = box(0.014, 0.05, 0.03, cream);
  rearNotchLeft.position.set(-0.038, 0.192, -0.03);
  root.add(rearNotchLeft);

  const rearNotchRight = box(0.014, 0.05, 0.03, cream);
  rearNotchRight.position.set(0.038, 0.192, -0.03);
  root.add(rearNotchRight);

  const frontBase = box(0.05, 0.024, 0.05, orangeDeep);
  frontBase.position.set(0, 0.1, -0.55);
  root.add(frontBase);

  const frontPost = box(0.017, 0.055, 0.022, cream);
  frontPost.position.set(0, 0.13, -0.55);
  root.add(frontPost);

  // 弹匣 / 握把 / 枪托：让侧面轮廓有起伏，不再是整块平板
  const magazine = box(0.072, 0.2, 0.11, orangeDeep);
  magazine.position.set(0, -0.155, -0.02);
  magazine.rotation.x = 0.18;
  root.add(magazine);

  const grip = box(0.07, 0.18, 0.1, orangeDeep);
  grip.position.set(0, -0.14, 0.15);
  grip.rotation.x = -0.34;
  root.add(grip);

  const stock = box(0.088, 0.095, 0.17, orange);
  stock.position.set(0, 0, 0.22);
  root.add(stock);

  const cheekPad = box(0.075, 0.03, 0.13, cream);
  cheekPad.position.set(0, 0.056, 0.22);
  root.add(cheekPad);

  // 双手：左手托护木，右手扣握把
  const leftHand = new THREE.Mesh(new THREE.SphereGeometry(0.068, 8, 6), cream);
  leftHand.scale.set(0.95, 0.78, 1.3);
  leftHand.position.set(-0.014, -0.086, -0.4);
  root.add(leftHand);

  const rightHand = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), cream);
  rightHand.scale.set(1.0, 0.86, 1.1);
  rightHand.position.set(0.016, -0.172, 0.15);
  root.add(rightHand);

  root.traverse((child) => {
    if (child.isMesh) {
      child.renderOrder = 900;
      child.frustumCulled = false;
    }
  });

  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0.012, -0.98);
  root.add(muzzle);

  const flash = createGlowSprite(0xffb05c, 0.52, 0.95);
  flash.position.copy(muzzle.position);
  flash.visible = false;
  flash.renderOrder = 950;
  root.add(flash);

  return { root, muzzle, flash };
}

export class Player {
  constructor(scene, camera, world) {
    this.scene = scene;
    this.camera = camera;
    this.world = world;
    this.position = new THREE.Vector3(0, 0, 13.2);
    this.velocityY = 0;
    this.grounded = true;
    this.yaw = 0;
    this.pitch = -0.035;
    this.radius = CONFIG.player.radius;
    this.maxHealth = CONFIG.player.maxHealth;
    this.health = this.maxHealth;
    this.alive = true;
    this.ammo = CONFIG.weapon.magSize;
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
    this.gunKick = 0;
    this.reloadTilt = 0;
    this.flashTimer = 0;
    this.bobTime = 0;
    this.moving = false;
    this.sprinting = false;
    this.damageSince = 99;
    this.respawnTimer = 0;
    this.skillCooldown = 0;
    this.invulnerableTimer = 0;
    this.deadCameraTilt = 0;

    this.camera.fov = 74;
    this.camera.near = 0.025;
    this.camera.far = 180;
    this.camera.rotation.order = 'YXZ';
    this.camera.position.set(this.position.x, CONFIG.player.eyeHeight, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    const viewmodel = createPlayerViewmodel();
    this.viewmodel = viewmodel.root;
    this.muzzle = viewmodel.muzzle;
    this.muzzleFlash = viewmodel.flash;
    this.camera.add(this.viewmodel);
    scene.add(camera);

    this.tempForward = new THREE.Vector3();
    this.tempRight = new THREE.Vector3();
    this.tempOrigin = new THREE.Vector3();
    this.tempDirection = new THREE.Vector3();
  }

  reset() {
    this.position.set(0, 0, 13.2);
    this.velocityY = 0;
    this.grounded = true;
    this.yaw = 0;
    this.pitch = -0.035;
    this.health = this.maxHealth;
    this.alive = true;
    this.ammo = CONFIG.weapon.magSize;
    this.reloading = false;
    this.reloadTimer = 0;
    this.fireCooldown = 0;
    this.skillCooldown = 0;
    this.damageSince = 99;
    this.respawnTimer = 0;
    this.invulnerableTimer = 0;
    this.deadCameraTilt = 0;
    this.viewmodel.visible = true;
    this.camera.position.set(0, CONFIG.player.eyeHeight, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }

  applyLook(dx, dy, sensitivity) {
    if (!this.alive) return;
    this.yaw -= dx * sensitivity;
    this.pitch -= dy * sensitivity;
    this.pitch = clamp(this.pitch, -1.38, 1.25);
  }

  getForward(target = new THREE.Vector3()) {
    return target.set(
      -Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      -Math.cos(this.yaw) * Math.cos(this.pitch),
    ).normalize();
  }

  getRight(target = new THREE.Vector3()) {
    return target.set(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
  }

  getMuzzleWorld(target = new THREE.Vector3()) {
    return this.muzzle.getWorldPosition(target);
  }

  update(dt, game, input) {
    this.fireCooldown = Math.max(0, this.fireCooldown - dt);
    this.skillCooldown = Math.max(0, this.skillCooldown - dt);
    this.invulnerableTimer = Math.max(0, this.invulnerableTimer - dt);
    this.damageSince += dt;
    this.gunKick = damp(this.gunKick, 0, 14, dt);
    this.reloadTilt = damp(this.reloadTilt, this.reloading ? 1 : 0, 8, dt);
    if (this.flashTimer > 0) {
      this.flashTimer -= dt;
      this.muzzleFlash.visible = this.flashTimer > 0;
      this.muzzleFlash.material.opacity = clamp(this.flashTimer / 0.055, 0, 1);
    }

    if (!this.alive) {
      this.respawnTimer -= dt;
      this.deadCameraTilt = damp(this.deadCameraTilt, 0.72, 5, dt);
      this.camera.position.y = damp(this.camera.position.y, 0.62, 5, dt);
      this.camera.rotation.z = damp(this.camera.rotation.z, this.deadCameraTilt, 4, dt);
      this.viewmodel.visible = false;
      return;
    }
    this.camera.rotation.z = damp(this.camera.rotation.z, 0, 8, dt);

    if (this.reloading) {
      this.reloadTimer -= dt;
      if (this.reloadTimer <= 0) {
        this.reloading = false;
        this.ammo = CONFIG.weapon.magSize;
        game.audio.reloadEnd();
        game.ui.setAmmo(this.ammo, CONFIG.weapon.magSize, false);
      }
    }

    if (this.health < this.maxHealth && this.damageSince > 6) {
      this.health = Math.min(this.maxHealth, this.health + dt * 3.2);
    }

    let forwardInput = 0;
    let rightInput = 0;
    if (input.keys.has('KeyW')) forwardInput += 1;
    if (input.keys.has('KeyS')) forwardInput -= 1;
    if (input.keys.has('KeyD')) rightInput += 1;
    if (input.keys.has('KeyA')) rightInput -= 1;
    // 触屏摇杆是模拟量（-1…1），和键盘叠加。桌面端这两个字段恒为 0，行为与之前完全一致。
    forwardInput = clamp(forwardInput + (input.moveY || 0), -1, 1);
    rightInput = clamp(rightInput + (input.moveX || 0), -1, 1);

    const sprinting =
      input.keys.has('ShiftLeft') || input.keys.has('ShiftRight') || Boolean(input.sprintTouch);
    this.sprinting = sprinting && forwardInput > 0;
    // 摇杆推一半就走一半速度：键盘斜向 = 1.414 会被夹到 1，所以对键盘没有副作用
    const magnitude = Math.min(1, Math.hypot(forwardInput, rightInput));
    const speed = (this.sprinting ? CONFIG.player.sprintSpeed : CONFIG.player.speed) * magnitude;
    const forward = this.getForward(this.tempForward);
    forward.y = 0;
    forward.normalize();
    const right = this.getRight(this.tempRight);

    let dx = forward.x * forwardInput + right.x * rightInput;
    let dz = forward.z * forwardInput + right.z * rightInput;
    const hasMovement = Math.abs(forwardInput) + Math.abs(rightInput) > 0;
    this.moving = hasMovement;
    if (hasMovement) {
      const length = Math.hypot(dx, dz) || 1;
      dx /= length;
      dz /= length;
      moveActor(
        this,
        dx,
        dz,
        speed,
        dt,
        this.world.obstacles,
        CONFIG.arenaHalf,
      );
      this.bobTime += dt * (this.sprinting ? 12 : 8.6);
      if (Math.sin(this.bobTime) < -0.96) game.playFootstep();
    }

    if (input.keys.has('Space') && this.grounded) {
      this.velocityY = CONFIG.player.jumpSpeed;
      this.grounded = false;
      input.keys.delete('Space');
    }
    this.velocityY -= 16 * dt;
    this.position.y += this.velocityY * dt;
    if (this.position.y <= 0) {
      this.position.y = 0;
      this.velocityY = 0;
      this.grounded = true;
    }

    const bob = hasMovement && this.grounded ? Math.sin(this.bobTime) * 0.018 : 0;
    const sideBob = hasMovement && this.grounded ? Math.cos(this.bobTime * 0.5) * 0.012 : 0;
    this.camera.position.set(
      this.position.x + sideBob,
      this.position.y + CONFIG.player.eyeHeight + bob,
      this.position.z,
    );
    this.camera.rotation.set(this.pitch, this.yaw, 0);

    this.viewmodel.position.set(
      0.55 + Math.sin(this.bobTime * 0.5) * 0.005,
      -0.44 + Math.abs(Math.sin(this.bobTime)) * 0.006,
      -1.2 + this.gunKick * 0.075,
    );
    this.viewmodel.rotation.set(
      this.gunKick * 0.1 - this.reloadTilt * 0.48 - 0.025,
      0.045 + this.reloadTilt * 0.36,
      this.reloadTilt * 0.2 + Math.sin(this.bobTime * 0.5) * 0.006,
    );

    if (input.mouseDown && game.state === 'playing') {
      const shot = this.tryShoot();
      if (shot) game.handlePlayerShot(shot.origin, shot.direction);
    }
  }

  tryShoot() {
    if (!this.alive || this.reloading || this.fireCooldown > 0) return null;
    if (this.ammo <= 0) {
      this.startReload();
      return null;
    }
    this.ammo -= 1;
    this.fireCooldown = CONFIG.weapon.fireRate;
    this.gunKick = Math.min(1.25, this.gunKick + 0.9);
    this.flashTimer = 0.055;
    this.muzzleFlash.visible = true;
    this.muzzleFlash.material.opacity = 1;
    this.muzzleFlash.material.rotation = Math.random() * Math.PI;

    const origin = this.camera.getWorldPosition(this.tempOrigin).clone();
    const direction = this.getForward(this.tempDirection).clone();
    const spread = CONFIG.weapon.spread;
    direction.x += rand(-spread, spread);
    direction.y += rand(-spread, spread);
    direction.z += rand(-spread, spread);
    direction.normalize();
    return { origin, direction };
  }

  startReload() {
    if (this.reloading || this.ammo === CONFIG.weapon.magSize || !this.alive) return;
    this.reloading = true;
    this.reloadTimer = CONFIG.weapon.reloadTime;
    this.reloadTilt = 0;
  }

  takeDamage(amount, game) {
    if (!this.alive || game.state !== 'playing' || this.invulnerableTimer > 0) return;
    this.health = Math.max(0, this.health - amount);
    this.damageSince = 0;
    game.ui.damageFlash(amount);
    game.audio.playerHurt();
    game.shake = Math.min(0.24, game.shake + 0.08);
    if (this.health <= 0) {
      this.alive = false;
      this.respawnTimer = CONFIG.player.respawnDelay;
      this.reloading = false;
      this.viewmodel.visible = false;
      game.onPlayerDown();
    }
  }

  revive() {
    this.alive = true;
    this.health = Math.round(this.maxHealth * 0.72);
    this.respawnTimer = 0;
    this.deadCameraTilt = 0;
    this.viewmodel.visible = true;
    this.camera.position.set(this.position.x, CONFIG.player.eyeHeight, this.position.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
    this.damageSince = 0;
  }

  useSkill(game) {
    if (!this.alive || this.skillCooldown > 0) return false;
    this.skillCooldown = CONFIG.skill.cooldown;
    game.activatePulse();
    return true;
  }
}

function buildAllyModel(color) {
  const group = new THREE.Group();
  const cream = standard(COLORS.cream, { roughness: 0.7 });
  const accent = standard(color, { roughness: 0.52 });
  const accentBright = standard(color === COLORS.orange ? COLORS.orangeBright : COLORS.tealBright, {
    roughness: 0.45,
    emissive: color,
    emissiveIntensity: 0.16,
  });
  const joint = standard(0x8f5c43, { roughness: 0.8 });
  const shade = standard(0x5d4033, { roughness: 0.72 });

  const shadow = createShadow(0x684230, 0.18, 0.64);
  group.add(shadow);

  const body = box(0.56, 0.62, 0.38, cream);
  body.position.y = 0.88;
  group.add(body);
  body.userData.actorPart = 'body';

  const chest = box(0.42, 0.34, 0.08, accent);
  chest.position.set(0, 0.97, 0.215);
  group.add(chest);

  const core = new THREE.Mesh(new THREE.OctahedronGeometry(0.095, 0), accentBright);
  core.position.set(0, 1.02, 0.27);
  group.add(core);

  const belt = box(0.58, 0.12, 0.4, joint);
  belt.position.y = 0.57;
  group.add(belt);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.31, 12, 9), cream);
  head.scale.set(1, 0.94, 0.9);
  head.position.y = 1.37;
  group.add(head);

  const visor = box(0.4, 0.105, 0.1, shade);
  visor.position.set(0, 1.39, 0.272);
  group.add(visor);

  const eye = box(0.22, 0.035, 0.018, accentBright);
  eye.position.set(0, 1.39, 0.33);
  group.add(eye);

  const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.025, 0.28, 5), joint);
  antenna.position.set(0.18, 1.66, 0);
  antenna.rotation.z = -0.2;
  group.add(antenna);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.055, 8, 6), accentBright);
  bulb.position.set(0.21, 1.81, 0);
  group.add(bulb);

  const arms = [];
  for (const side of [-1, 1]) {
    const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), accent);
    shoulder.position.set(side * 0.36, 1.14, 0);
    group.add(shoulder);

    const arm = new THREE.Group();
    arm.position.set(side * 0.38, 1.1, 0);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.075, 0.42, 7), cream);
    upper.position.y = -0.2;
    arm.add(upper);
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.105, 8, 6), accent);
    hand.position.y = -0.45;
    arm.add(hand);
    group.add(arm);
    arms.push(arm);
  }

  const legs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.16, 0.54, 0);
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.095, 0.075, 0.34, 7), joint);
    upper.position.y = -0.16;
    leg.add(upper);
    const boot = box(0.18, 0.17, 0.3, shade);
    boot.position.set(0, -0.39, 0.06);
    leg.add(boot);
    group.add(leg);
    legs.push(leg);
  }

  const backpack = box(0.36, 0.38, 0.2, accent);
  backpack.position.set(0, 0.95, -0.28);
  group.add(backpack);

  const gun = new THREE.Group();
  gun.position.set(0.34, 0.87, 0.34);
  const gunBody = box(0.13, 0.14, 0.38, accent);
  gun.add(gunBody);
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.033, 0.042, 0.32, 7), shade);
  barrel.rotation.x = Math.PI / 2;
  barrel.position.z = 0.32;
  gun.add(barrel);
  const gunLight = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 5), accentBright);
  gunLight.position.set(0, 0.08, 0.1);
  gun.add(gunLight);
  group.add(gun);
  const muzzle = new THREE.Object3D();
  muzzle.position.set(0, 0, 0.52);
  gun.add(muzzle);

  const ring = new THREE.Mesh(
    new THREE.TorusGeometry(0.55, 0.025, 5, 26),
    new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  );
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.035;
  group.add(ring);

  const label = createTextSprite('队友', '', {
    width: 384,
    height: 120,
    scale: 0.34,
    titleSize: 38,
    titleColor: color === COLORS.orange ? '#e95417' : '#1c887c',
    background: 'rgba(255,246,231,0.9)',
    depthTest: false,
  });
  label.position.y = 1.94;
  label.renderOrder = 40;
  group.add(label);

  group.traverse((child) => {
    if (child.isMesh) child.userData.actor = null;
  });

  return { group, shadow, arms, legs, gun, muzzle, body, head, chest, eye, ring, label, accent, accentBright };
}

export class Ally {
  constructor(scene, world, options) {
    this.scene = scene;
    this.world = world;
    this.index = options.index;
    this.name = options.name;
    this.role = options.role;
    this.color = options.color;
    this.position = new THREE.Vector3(options.x, 0, options.z);
    this.radius = 0.5;
    this.isAI = true;
    this.maxHealth = CONFIG.ally.maxHealth;
    this.health = this.maxHealth;
    this.alive = true;
    this.downed = false;
    this.downedTimer = 0;
    this.reviveProgress = 0;
    this.order = 'defend';
    this.orderUntil = Infinity;
    this.previousOrder = 'defend';
    this.orderSide = null;
    this.focusFilter = null;
    this.anchor = new THREE.Vector3(options.x, 0, options.z);
    this.goal = this.anchor.clone();
    this.targetEnemy = null;
    this.decisionTimer = rand(0, 0.2);
    this.shootTimer = rand(0.2, 0.7);
    this.walkTime = rand(0, Math.PI * 2);
    this.moving = false;
    this.flash = 0;
    this.chatterCooldown = rand(4, 9);
    this.lastSaidText = '';
    this.lastSaidAt = -999;
    this.assignedAngle = options.index === 0 ? Math.PI * 0.8 : -Math.PI * 0.2;
    this.memory = {
      commandCounts: {},
      leaks: { north: 0, east: 0, south: 0, west: 0 },
      lastLeak: null,
      lastLeakSide: null,
      downedCount: 0,
      combatHighlights: [],
    };
    this.lastStandWave = 0;
    this.model = buildAllyModel(options.color);
    this.group = this.model.group;
    this.group.position.copy(this.position);
    this.labelText = `${this.name} · ${this.role}`;
    this.setLabel(this.labelText);

    this.group.traverse((child) => {
      if (child.isMesh && !child.userData.noActor) child.userData.actor = this;
    });
    this.model.body.userData.actorPart = 'body';
    this.model.head.userData.actorPart = 'head';
    scene.add(this.group);

    this.temp = new THREE.Vector3();
  }

  setLabel(text) {
    this.labelText = text;
    if (!this.model || !this.model.label) return;
    const color = this.color === COLORS.orange ? '#e95417' : '#1c887c';
    const next = createTextSprite(text, '', {
      width: 460,
      height: 120,
      scale: 0.42,
      titleSize: 36,
      titleColor: color,
      background: 'rgba(255,246,231,0.91)',
      depthTest: false,
    });
    next.position.y = 1.94;
    next.renderOrder = 40;
    this.group.remove(this.model.label);
    if (this.model.label.material.map) this.model.label.material.map.dispose();
    this.model.label.material.dispose();
    this.model.label = next;
    this.group.add(next);
  }

  reset(options = {}) {
    this.position.set(options.x ?? (this.index === 0 ? -2.5 : 2.5), 0, options.z ?? 10.5);
    this.health = this.maxHealth;
    this.alive = true;
    this.downed = false;
    this.downedTimer = 0;
    this.reviveProgress = 0;
    this.order = 'defend';
    this.orderUntil = Infinity;
    this.previousOrder = 'defend';
    this.orderSide = null;
    this.focusFilter = null;
    this.anchor.copy(this.position);
    this.goal.copy(this.position);
    this.targetEnemy = null;
    this.group.position.copy(this.position);
    this.group.rotation.set(0, 0, 0);
    this.group.visible = true;
    this.model.ring.visible = true;
    this.model.eye.material.emissiveIntensity = 0.16;
  }

  setOrder(intent, options = {}, game = null, silent = false) {
    if (this.downed) return false;
    const previous = this.order;
    if (intent === 'retreat') {
      this.previousOrder = previous === 'retreat' ? 'defend' : previous;
    } else {
      this.previousOrder = intent;
    }
    this.order = intent;
    this.orderUntil = game ? game.elapsed + (options.duration ?? 28) : Infinity;
    this.orderSide = options.side ?? null;
    this.focusFilter = options.enemyType ?? null;
    this.anchor.copy(this.position);
    this.memory.commandCounts[intent] = (this.memory.commandCounts[intent] || 0) + 1;
    this.decisionTimer = 0;
    this.targetEnemy = null;
    if (!silent && game) {
      this.say(getOrderLine(this, intent), game);
    }
    return true;
  }

  say(text, game) {
    if (!text) return;
    // 同一句台词短时间内不重复播报，避免刷屏
    if (text === this.lastSaidText && game.elapsed - this.lastSaidAt < 8) return;
    this.lastSaidText = text;
    this.lastSaidAt = game.elapsed;
    this.chatterCooldown = Math.max(this.chatterCooldown, 2.5);
    game.ui.allySpeak(this.name, text, this.color === COLORS.orange ? 'orange' : 'teal');
  }

  chooseGoal(game) {
    let side = this.index === 0 ? 1 : -1;
    if (this.orderSide === 'left') side = 1;
    if (this.orderSide === 'right') side = -1;
    const player = game.player;
    const core = game.core;
    const sideAngles = {
      north: -Math.PI / 2,
      east: 0,
      south: Math.PI / 2,
      west: Math.PI,
      front: -Math.PI / 2,
      back: Math.PI / 2,
    };

    if (this.order === 'hold') {
      this.goal.copy(this.anchor);
      return;
    }
    if (this.order === 'retreat') {
      const angle = this.assignedAngle;
      this.goal.set(core.position.x + Math.cos(angle) * 2.9, 0, core.position.z + Math.sin(angle) * 2.9);
      return;
    }
    if (this.order === 'follow') {
      const forward = player.getForward(this.temp.clone());
      forward.y = 0;
      forward.normalize();
      const right = player.getRight(new THREE.Vector3());
      this.goal.copy(player.position)
        .addScaledVector(forward, -1.8)
        .addScaledVector(right, side * 1.55);
      return;
    }
    if (this.order === 'defend') {
      let angle = this.assignedAngle;
      if (this.orderSide && sideAngles[this.orderSide] !== undefined) {
        angle = sideAngles[this.orderSide] + (this.index === 0 ? 0.24 : -0.24);
      } else {
        const weakSide = this.memory.lastLeakSide;
        if (weakSide && game.elapsed - this.memory.lastLeak < 45) {
          if (sideAngles[weakSide] !== undefined) {
            angle = sideAngles[weakSide] + (side > 0 ? 0.32 : -0.32);
          }
        }
      }
      this.goal.set(
        core.position.x + Math.cos(angle) * 4.1,
        0,
        core.position.z + Math.sin(angle) * 4.1,
      );
      return;
    }
    if (this.order === 'flank') {
      const enemies = game.enemies.filter((enemy) => !enemy.dead);
      if (enemies.length === 0) {
        this.goal.copy(player.position);
        return;
      }
      const center = new THREE.Vector3();
      for (const enemy of enemies) center.add(enemy.position);
      center.multiplyScalar(1 / enemies.length);
      const towardCore = new THREE.Vector3(core.position.x - center.x, 0, core.position.z - center.z).normalize();
      const perpendicular = new THREE.Vector3(-towardCore.z, 0, towardCore.x).multiplyScalar(side);
      this.goal.copy(center).addScaledVector(perpendicular, 7.4);
      if (this.orderSide === 'front') {
        this.goal.copy(center).addScaledVector(towardCore, -5.4);
      }
      this.goal.x = clamp(this.goal.x, -21, 21);
      this.goal.z = clamp(this.goal.z, -21, 21);
      return;
    }
    if (this.order === 'focus') {
      const target = game.getFocusEnemy(this);
      if (target) {
        const awayFromTarget = new THREE.Vector3(
          this.position.x - target.position.x,
          0,
          this.position.z - target.position.z,
        );
        if (awayFromTarget.lengthSq() < 0.1) awayFromTarget.set(side, 0, 0);
        awayFromTarget.normalize();
        this.goal.copy(target.position).addScaledVector(awayFromTarget, 6.4);
      } else {
        this.goal.copy(player.position);
      }
      return;
    }

    this.goal.copy(this.anchor);
  }

  chooseCombatTarget(game) {
    const enemies = game.enemies.filter((enemy) => !enemy.dead && enemy.alive);
    if (enemies.length === 0) return null;
    let best = null;
    let bestScore = Infinity;
    const focus = this.order === 'focus' ? game.getFocusEnemy(this) : null;
    if (focus) return focus;

    for (const enemy of enemies) {
      let distance = dist2D(this.position, enemy.position);
      if (this.order === 'defend') {
        const coreDistance = dist2D(game.core.position, enemy.position);
        distance = distance * 0.6 + coreDistance * 1.25;
      }
      if (this.order === 'follow') {
        const playerDistance = dist2D(game.player.position, enemy.position);
        distance = distance * 0.65 + playerDistance * 0.9;
      }
      if (dist2D(this.position, enemy.position) > CONFIG.ally.shootRange + 3) continue;
      if (!hasLineOfSight(this.position, enemy.position, this.world.obstacles)) continue;
      if (distance < bestScore) {
        bestScore = distance;
        best = enemy;
      }
    }
    return best;
  }

  // 名牌按距离等比缩放，屏幕上始终保持差不多大小
  updateLabelScale(game) {
    const label = this.model && this.model.label;
    if (!label || !game || !game.player) return;
    const distance = Math.max(2.4, dist2D(this.position, game.player.position));
    const height = clamp(distance * 0.06, 0.18, 0.95);
    label.scale.set(height * (384 / 120), height, 1);
  }

  update(dt, game) {
    this.updateLabelScale(game);
    if (this.downed) {
      this.downedTimer += dt;
      this.group.rotation.z = damp(this.group.rotation.z, Math.PI * 0.46, 7, dt);
      this.group.position.y = damp(this.group.position.y, 0.2, 5, dt);
      this.model.ring.visible = false;
      if (this.downedTimer > CONFIG.ally.autoReviveDelay) {
        this.revive(game, true);
      }
      return;
    }
    if (this.orderUntil < game.elapsed && this.order !== 'defend') {
      this.order = 'defend';
      this.orderUntil = Infinity;
      this.say('指令时限到了，我先回核心。', game);
    }

    this.chatterCooldown -= dt;
    this.flash = Math.max(0, this.flash - dt * 5);
    this.model.chest.material.emissiveIntensity = 0.04 + this.flash * 2.4;
    this.model.chest.material.emissive.setHex(this.flash > 0.1 ? 0xffffff : 0x000000);

    const healthRatio = this.health / this.maxHealth;
    const nearCore = dist2D(this.position, game.core.position) < 6.5;
    if (nearCore && this.order === 'retreat') {
      this.health = Math.min(this.maxHealth, this.health + dt * 10);
      this.model.ring.material.opacity = 0.9;
    } else if (nearCore && this.damageSince > 4 && this.health < this.maxHealth) {
      this.health = Math.min(this.maxHealth, this.health + dt * 2.5);
    }
    this.damageSince = (this.damageSince || 0) + dt;

    if (healthRatio < 0.25 && this.order !== 'retreat' && this.chatterCooldown <= 0) {
      this.say('我快撑不住了，让我回核心充能！', game);
    }

    this.decisionTimer -= dt;
    if (this.decisionTimer <= 0) {
      this.decisionTimer = 0.28 + Math.random() * 0.14;
      this.chooseGoal(game);
      this.targetEnemy = this.chooseCombatTarget(game);
      if (this.targetEnemy && this.chatterCooldown <= 0 && Math.random() < 0.22) {
        this.say(
          pickCombatLine(this, this.targetEnemy, game),
          game,
        );
      }
    }

    let moved = false;
    const goalDistance = dist2D(this.position, this.goal);
    const shouldMove = goalDistance > (this.targetEnemy ? 4.4 : 1.35) || this.order === 'retreat';
    if (shouldMove && goalDistance > 0.15) {
      const dirX = this.goal.x - this.position.x;
      const dirZ = this.goal.z - this.position.z;
      const speed = this.order === 'retreat' ? CONFIG.ally.speed * 1.28 : CONFIG.ally.speed;
      moved = moveActor(this, dirX, dirZ, speed, dt, this.world.obstacles, CONFIG.arenaHalf);
      if (moved) {
        this.walkTime += dt * 8;
        this.group.rotation.y = dampAngleTo(this.group.rotation.y, Math.atan2(dirX, dirZ), 9, dt);
      }
    }

    if (this.targetEnemy && !this.targetEnemy.dead) {
      const dx = this.targetEnemy.position.x - this.position.x;
      const dz = this.targetEnemy.position.z - this.position.z;
      const distance = Math.hypot(dx, dz);
      const canSee = hasLineOfSight(this.position, this.targetEnemy.position, this.world.obstacles);
      if (!moved || distance < 7) {
        this.group.rotation.y = dampAngleTo(this.group.rotation.y, Math.atan2(dx, dz), 11, dt);
      }
      this.shootTimer -= dt;
      if (this.shootTimer <= 0 && distance < CONFIG.ally.shootRange && canSee && this.order !== 'retreat') {
        this.shootTimer = CONFIG.ally.fireRate + rand(-0.08, 0.1);
        game.allyShoot(this, this.targetEnemy);
      }
    }

    const walk = moved ? Math.sin(this.walkTime) : 0;
    this.model.legs[0].rotation.x = damp(this.model.legs[0].rotation.x, walk * 0.65, 11, dt);
    this.model.legs[1].rotation.x = damp(this.model.legs[1].rotation.x, -walk * 0.65, 11, dt);
    this.model.arms[0].rotation.x = damp(this.model.arms[0].rotation.x, -walk * 0.4, 9, dt);
    this.model.arms[1].rotation.x = damp(this.model.arms[1].rotation.x, -0.75 + walk * 0.1, 9, dt);
    this.group.position.set(this.position.x, Math.abs(walk) * 0.035, this.position.z);
    this.group.rotation.z = damp(this.group.rotation.z, 0, 8, dt);
    this.group.position.y = damp(this.group.position.y, 0, 9, dt);
    this.model.ring.material.opacity = 0.55 + Math.sin(game.elapsed * 3 + this.index) * 0.1;
  }

  takeDamage(amount, game) {
    if (!this.alive || this.downed) return;
    this.health = Math.max(0, this.health - amount);
    this.damageSince = 0;
    this.flash = 1;
    if (this.health <= 0) {
      this.downed = true;
      this.downedTimer = 0;
      this.reviveProgress = 0;
      this.memory.downedCount += 1;
      this.say(this.index === 0 ? '橙橙失去行动能力！' : '闪闪失去行动能力！', game);
      game.ui.showRevivePrompt(false);
    }
  }

  revive(game, automatic = false) {
    this.downed = false;
    this.downedTimer = 0;
    this.reviveProgress = 0;
    this.health = Math.round(this.maxHealth * (automatic ? 0.5 : 0.7));
    this.group.rotation.z = 0;
    this.group.position.y = 0;
    this.model.ring.visible = true;
    this.say(automatic ? '重新上线，继续守！' : '谢了指挥官，我还能打。', game);
    game.audio.revive();
  }

  recordLeak(side, game) {
    if (!side) return;
    this.memory.leaks[side] = (this.memory.leaks[side] || 0) + 1;
    this.memory.lastLeak = game.elapsed;
    this.memory.lastLeakSide = side;
  }

  waveSuggestion(waveIndex, game) {
    const entries = Object.entries(this.memory.leaks).sort((a, b) => b[1] - a[1]);
    const strongest = entries[0];
    const counts = this.memory.commandCounts;
    const mostUsed = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    if (strongest && strongest[1] > 0) {
      const labels = { north: '北侧', east: '东侧', south: '南侧', west: '西侧' };
      return `${labels[strongest[0]]}上一波压力最大，这次我会把防守重心往那边挪。`;
    }
    if (waveIndex > 0 && mostUsed) {
      return `你上一波最常用「${INTENT_LABELS[mostUsed[0]] || '守核心'}」，这次我会更快进入位置。`;
    }
    return this.index === 0
      ? '我负责贴近核心拦截，你专心输出。'
      : '我会在外圈找角度，别让他们舒服地站桩。';
  }
}

function getOrderLine(ally, intent) {
  const lines = {
    follow: ally.index === 0 ? ['收到，贴着你走。', '跟上了，别跑太快。'] : ['我去你侧翼。', '收到，跟着你的节奏。'],
    defend: ['核心交给我，你去看住另一边。', '回防核心，站好位置。'],
    flank: ['我从侧面绕，给你开角度。', '包抄路线确认，出发。'],
    focus: ['收到，优先打你指的那个。', '集火，我来补伤害。'],
    retreat: ['先撤，回核心充能。', '收到，不硬撑。'],
    hold: ['原地待命，保持视野。', '停在这里，听你下一步。'],
  };
  return lines[intent] ? lines[intent][ally.index % 2] : '收到。';
}

function pickCombatLine(ally, enemy, game) {
  if (ally.chatterCooldown > 0) return '';
  if (enemy.type === 'elite') {
    return ally.index === 0 ? '大块头交给我牵制，你打它的核心！' : '精英的侧面装甲薄，我绕过去。';
  }
  if (dist2D(game.core.position, enemy.position) < 7) {
    return ally.index === 0 ? '有敌人贴近核心，我先拦！' : '核心方向有动静，我回防。';
  }
  return '';
}

function dampAngleTo(current, target, lambda, dt) {
  let delta = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}

function buildEnemyModel(type, accentColor) {
  const config = ENEMY_TYPES[type];
  const group = new THREE.Group();
  const bodyMat = standard(config.color, { roughness: 0.64 });
  const accentMat = standard(accentColor, { roughness: 0.48 });
  const creamMat = standard(0xf6e4cb, { roughness: 0.83 });
  const darkMat = standard(0x5c3c32, { roughness: 0.8 });
  const glowMat = new THREE.MeshStandardMaterial({
    color: 0xffe2a0,
    emissive: 0xff4c2f,
    emissiveIntensity: 2.2,
    roughness: 0.2,
  });

  const shadow = createShadow(0x623b2d, 0.16, type === 'elite' ? 1.0 : 0.56);
  group.add(shadow);

  const legs = [];
  const arms = [];
  let head;

  if (type === 'runner') {
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.48, 10, 8), bodyMat);
    body.scale.set(1, 0.9, 0.85);
    body.position.y = 0.68;
    group.add(body);
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(0.51, 1), accentMat);
    shell.scale.set(1, 0.58, 0.96);
    shell.position.y = 0.78;
    group.add(shell);
    head = new THREE.Mesh(new THREE.SphereGeometry(0.26, 9, 7), creamMat);
    head.position.set(0, 0.98, 0.34);
    group.add(head);
    const eye = box(0.23, 0.055, 0.035, glowMat);
    eye.position.set(0, 1.0, 0.58);
    group.add(eye);
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.2, 0.46, 0);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.42, 6), darkMat);
      strut.position.y = -0.21;
      leg.add(strut);
      const foot = new THREE.Mesh(new THREE.SphereGeometry(0.13, 7, 5), accentMat);
      foot.scale.set(0.8, 0.45, 1.4);
      foot.position.set(0, -0.44, 0.05);
      leg.add(foot);
      group.add(leg);
      legs.push(leg);
    }
    const antenna = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.32, 5), darkMat);
    antenna.position.set(-0.22, 1.1, 0.14);
    antenna.rotation.z = 0.3;
    group.add(antenna);
    const antennaTip = new THREE.Mesh(new THREE.SphereGeometry(0.055, 6, 5), glowMat);
    antennaTip.position.set(-0.28, 1.26, 0.14);
    group.add(antennaTip);
    group.userData.eye = eye;
  }

  if (type === 'gunner') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.52, 0.72, 8), bodyMat);
    body.position.y = 0.83;
    group.add(body);
    const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.42, 0.48, 8), creamMat);
    chest.position.y = 1.1;
    group.add(chest);
    head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), accentMat);
    head.position.y = 1.48;
    group.add(head);
    const visor = box(0.36, 0.07, 0.06, glowMat);
    visor.position.set(0, 1.5, 0.27);
    group.add(visor);
    for (const side of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(side * 0.5, 1.13, 0);
      const shoulder = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), bodyMat);
      arm.add(shoulder);
      const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.07, 0.55, 8), darkMat);
      cannon.rotation.z = side * 0.55;
      cannon.position.set(side * 0.2, -0.2, 0.1);
      arm.add(cannon);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.025, 5, 12), accentMat);
      ring.position.set(side * 0.35, -0.49, 0.1);
      ring.rotation.x = Math.PI / 2;
      arm.add(ring);
      group.add(arm);
      arms.push(arm);
    }
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.24, 0.52, 0);
      const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.48, 6), darkMat);
      strut.position.y = -0.24;
      leg.add(strut);
      const foot = box(0.24, 0.16, 0.4, creamMat);
      foot.position.set(0, -0.5, 0.06);
      leg.add(foot);
      group.add(leg);
      legs.push(leg);
    }
    group.userData.eye = visor;
  }

  if (type === 'elite') {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(0.72, 0.88, 1.0, 8), bodyMat);
    body.position.y = 1.0;
    group.add(body);
    const armor = new THREE.Mesh(new THREE.IcosahedronGeometry(0.88, 1), accentMat);
    armor.scale.set(1.08, 0.7, 0.9);
    armor.position.y = 1.08;
    group.add(armor);
    head = new THREE.Mesh(new THREE.SphereGeometry(0.42, 10, 8), creamMat);
    head.position.y = 1.78;
    group.add(head);
    const visor = box(0.55, 0.13, 0.08, glowMat);
    visor.position.set(0, 1.8, 0.38);
    group.add(visor);
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Mesh(new THREE.IcosahedronGeometry(0.41, 1), bodyMat);
      shoulder.position.set(side * 0.83, 1.35, 0);
      group.add(shoulder);
      const arm = new THREE.Group();
      arm.position.set(side * 0.9, 1.24, 0);
      const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.14, 0.67, 7), darkMat);
      upper.position.y = -0.3;
      arm.add(upper);
      const cannon = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.1, 0.5, 8), accentMat);
      cannon.rotation.x = Math.PI / 2;
      cannon.position.set(0, -0.58, 0.4);
      arm.add(cannon);
      const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 7, 5), glowMat);
      tip.position.set(0, -0.58, 0.67);
      arm.add(tip);
      group.add(arm);
      arms.push(arm);
    }
    for (const side of [-1, 1]) {
      const leg = new THREE.Group();
      leg.position.set(side * 0.36, 0.7, 0);
      const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.16, 0.68, 7), darkMat);
      thigh.position.y = -0.32;
      leg.add(thigh);
      const foot = box(0.35, 0.25, 0.6, creamMat);
      foot.position.set(0, -0.7, 0.08);
      leg.add(foot);
      group.add(leg);
      legs.push(leg);
    }
    group.userData.eye = visor;
    const label = createTextSprite('精英单位', '优先击破', {
      width: 420,
      height: 140,
      scale: 0.7,
      titleSize: 38,
      subtitleSize: 26,
      titleColor: '#9d3228',
      subtitleColor: '#e85c22',
      background: 'rgba(255,241,218,0.92)',
      depthTest: false,
    });
    label.position.y = 2.62;
    label.renderOrder = 40;
    group.add(label);
  }

  group.traverse((child) => {
    if (child.isMesh) {
      child.userData.isEnemyPart = true;
      child.userData.actorPart = child === head ? 'head' : 'body';
    }
  });

  return { group, shadow, legs, arms, head, eye: group.userData.eye };
}

export class Enemy {
  constructor(scene, type, spawn, spawnSide) {
    this.scene = scene;
    this.type = type;
    this.config = ENEMY_TYPES[type];
    this.position = new THREE.Vector3(spawn.x, 0, spawn.z);
    this.spawnSide = spawnSide;
    this.radius = this.config.radius;
    this.isAI = true;
    this.maxHealth = this.config.maxHealth;
    this.health = this.maxHealth;
    this.alive = true;
    this.dead = false;
    this.deathTimer = 0;
    this.flash = 0;
    this.attackCooldown = rand(0.3, 1.1);
    this.decisionTimer = rand(0, 0.4);
    this.walkTime = rand(0, Math.PI * 2);
    this.forcedTargetUntil = 0;
    this.target = null;
    this.speed = this.config.speed;
    this.attackRange = this.config.attackRange;
    this.attackRate = this.config.attackRate;
    this.damage = this.config.damage;
    this.spawnTimer = 0.45;
    this.invulnerable = true;
    this.stallTimer = 0;
    this.stallAnchor = null;
    this.stallFlips = 0;

    this.model = buildEnemyModel(type, this.config.accent);
    this.group = this.model.group;
    this.group.position.copy(this.position);
    this.group.scale.setScalar(0.01);
    scene.add(this.group);

    const bar = makeHealthBar();
    this.healthBar = bar;
    bar.sprite.position.y = type === 'elite' ? 3.12 : type === 'gunner' ? 2.02 : 1.55;
    this.group.add(bar.sprite);

    this.hitMeshes = [];
    this.group.traverse((child) => {
      if (child.isMesh && child !== this.model.shadow) {
        child.userData.actor = this;
        this.hitMeshes.push(child);
      }
    });
    this.flashMaterials = [this.model.head.material];
    this.temp = new THREE.Vector3();
  }

  spawnAnimation(dt) {
    if (this.spawnTimer <= 0) return;
    this.spawnTimer -= dt;
    const progress = clamp(1 - this.spawnTimer / 0.45, 0, 1);
    const overshoot = 1 + Math.sin(progress * Math.PI) * 0.12;
    this.group.scale.setScalar(progress * overshoot);
    if (this.spawnTimer <= 0) {
      this.group.scale.setScalar(1);
      this.invulnerable = false;
    }
  }

  chooseTarget(game) {
    if (game.elapsed < this.forcedTargetUntil && game.player.alive) {
      return game.player;
    }
    const candidates = [];
    candidates.push({ entity: game.core, weight: this.type === 'runner' ? 2.3 : 1.2 });
    if (game.player.alive) candidates.push({ entity: game.player, weight: 1.1 });
    for (const ally of game.allies) {
      if (!ally.downed) candidates.push({ entity: ally, weight: this.type === 'gunner' ? 1.7 : 1.0 });
    }
    let best = game.core;
    let bestScore = Infinity;
    for (const candidate of candidates) {
      const entity = candidate.entity;
      let distance = dist2D(this.position, entity.position);
      if (entity === game.core && this.type !== 'runner') distance *= 0.75;
      const score = distance / candidate.weight;
      if (score < bestScore) {
        bestScore = score;
        best = entity;
      }
    }
    return best;
  }

  update(dt, game) {
    if (this.dead) {
      this.deathTimer += dt;
      this.group.rotation.z = damp(this.group.rotation.z, Math.PI * 0.5, 4, dt);
      this.group.position.y = damp(this.group.position.y, -0.35, 3, dt);
      this.group.scale.multiplyScalar(Math.max(0.92, 1 - dt * 1.8));
      return;
    }
    this.spawnAnimation(dt);
    if (this.invulnerable) return;

    this.flash = Math.max(0, this.flash - dt * 4.5);
    this.attackCooldown -= dt;
    this.decisionTimer -= dt;
    if (this.flash > 0) {
      this.model.head.material.emissive.setHex(0xffffff);
      this.model.head.material.emissiveIntensity = 2.5;
    } else {
      this.model.head.material.emissive.setHex(0x000000);
      this.model.head.material.emissiveIntensity = 0;
    }

    if (this.decisionTimer <= 0) {
      this.decisionTimer = rand(0.9, 1.5);
      this.target = this.chooseTarget(game);
    }
    if (!this.target || (this.target.downed && this.target !== game.core)) this.target = this.chooseTarget(game);
    if (!this.target) return;

    const targetPos = this.target === game.core ? game.core.position : this.target.position;
    const distance = dist2D(this.position, targetPos);
    this.updateStall(game, dt);
    let desiredX = targetPos.x - this.position.x;
    let desiredZ = targetPos.z - this.position.z;
    const directionLength = Math.hypot(desiredX, desiredZ) || 1;
    desiredX /= directionLength;
    desiredZ /= directionLength;

    let approach = true;
    let strafe = 0;
    if (this.type !== 'runner') {
      const preferred = this.config.preferredRange || 8;
      if (distance < preferred - 2.4) approach = false;
      if (distance > preferred + 2.2) approach = true;
      strafe = Math.sin(game.elapsed * 1.1 + this.walkTime) * (distance < preferred + 3 ? 0.65 : 0.22);
    }
    if (distance <= this.attackRange) approach = false;

    let moveX = 0;
    let moveZ = 0;
    if (approach) {
      moveX = desiredX;
      moveZ = desiredZ;
    } else if (this.type !== 'runner') {
      const perpendicularX = -desiredZ;
      const perpendicularZ = desiredX;
      moveX = perpendicularX * strafe - desiredX * 0.12;
      moveZ = perpendicularZ * strafe - desiredZ * 0.12;
    }

    // Separation from other enemies prevents single-file stacking.
    for (const other of game.enemies) {
      if (other === this || other.dead) continue;
      const dx = this.position.x - other.position.x;
      const dz = this.position.z - other.position.z;
      const minDistance = this.radius + other.radius + 0.28;
      const d = Math.hypot(dx, dz);
      if (d > 0.001 && d < minDistance) {
        moveX += (dx / d) * 0.9;
        moveZ += (dz / d) * 0.9;
      }
    }

    let moved = false;
    if (Math.abs(moveX) + Math.abs(moveZ) > 0.01) {
      moved = moveActor(this, moveX, moveZ, this.speed, dt, this.worldObstacles(game), CONFIG.arenaHalf);
      if (moved) this.walkTime += dt * (this.type === 'elite' ? 4.2 : 7.2);
    }
    this.group.position.set(this.position.x, 0, this.position.z);
    const targetRotation = Math.atan2(targetPos.x - this.position.x, targetPos.z - this.position.z);
    this.group.rotation.y = dampAngleTo(this.group.rotation.y, targetRotation, 7, dt);

    const walk = moved ? Math.sin(this.walkTime) : 0;
    if (this.model.legs.length > 0) {
      this.model.legs[0].rotation.x = damp(this.model.legs[0].rotation.x, walk * 0.55, 8, dt);
      this.model.legs[1].rotation.x = damp(this.model.legs[1].rotation.x, -walk * 0.55, 8, dt);
    }
    if (this.model.arms.length > 0) {
      this.model.arms[0].rotation.x = damp(this.model.arms[0].rotation.x, walk * 0.25, 8, dt);
      this.model.arms[1].rotation.x = damp(this.model.arms[1].rotation.x, -walk * 0.25 - 0.2, 8, dt);
    }
    this.group.position.y = Math.abs(walk) * (this.type === 'elite' ? 0.025 : 0.045);

    if (distance <= this.attackRange && this.attackCooldown <= 0) {
      if (this.type === 'runner') {
        this.meleeAttack(game);
      } else {
        this.rangedAttack(game, targetPos);
      }
    }

    if (this.healthBar.sprite.visible) {
      const ratio = this.health / this.maxHealth;
      drawHealthBar(this.healthBar, ratio);
    }
  }

  // 卡住自愈：4 秒内挪不出 2.6 米就换个绕行方向，两次都没走出去就重新投放，
  // 保证任何几何死角都不会把波次卡住。
  updateStall(game, dt) {
    if (!this.stallAnchor) {
      this.stallAnchor = { x: this.position.x, z: this.position.z };
      this.stallTimer = 0;
      return;
    }
    if (dist2D(this.position, this.stallAnchor) > 2.6) {
      this.stallAnchor = { x: this.position.x, z: this.position.z };
      this.stallTimer = 0;
      this.stallFlips = 0;
      return;
    }
    this.stallTimer += dt;
    if (this.stallTimer < 4) return;

    this.stallTimer = 0;
    this.stallAnchor = null;
    this.stallFlips += 1;
    this.avoidSide = -(this.avoidSide || 1);

    if (this.stallFlips >= 2 && dist2D(this.position, game.core.position) > 7) {
      this.stallFlips = 0;
      this.redeploy(game);
    }
  }

  redeploy(game) {
    const side = SPAWN_SIDES[Math.floor(Math.random() * SPAWN_SIDES.length)];
    this.position.set(side.x, 0, side.z);
    this.group.position.copy(this.position);
    this.group.rotation.y = side.yaw ?? Math.PI;
    this.spawnTimer = 0.4;
    this.invulnerable = true;
    this.attackCooldown = 0.9;
    this.target = null;
    this.decisionTimer = 0;
    game.spawnSpawnPortal?.(this.position);
  }

  worldObstacles(game) {
    return game.world.obstacles;
  }

  meleeAttack(game) {
    this.attackCooldown = this.config.attackRate;
    this.group.position.z += 0.12;
    if (this.target === game.core) {
      game.damageCore(this.config.damage, this);
    } else if (this.target === game.player) {
      game.damagePlayer(this.config.damage);
    } else if (this.target instanceof Ally) {
      game.damageAlly(this.target, this.config.damage);
    }
    game.spawnMeleeSwipe(this.position, this.target?.position || game.core.position);
  }

  rangedAttack(game, targetPos) {
    this.attackCooldown = this.config.attackRate;
    const origin = new THREE.Vector3(this.position.x, 1.35, this.position.z);
    const target = new THREE.Vector3(targetPos.x, this.target === game.core ? 2.1 : 1.15, targetPos.z);
    if (this.type === 'elite') {
      for (const offset of [-0.16, 0, 0.16]) {
        const aim = target.clone();
        aim.x += offset * 2.4;
        aim.z += offset * 2.4;
        game.spawnEnemyProjectile(origin, aim, this.config.projectileSpeed, this.config.damage / 2, true);
      }
    } else {
      game.spawnEnemyProjectile(origin, target, this.config.projectileSpeed, this.config.damage, false);
    }
    game.audio.enemyShoot();
    game.spawnEnemyMuzzle(origin);
  }

  takeDamage(amount, part, game) {
    if (this.dead || this.invulnerable) return 0;
    const multiplier = part === 'head' ? 1.65 : 1;
    const dealt = amount * multiplier;
    this.health = Math.max(0, this.health - dealt);
    this.flash = 1;
    this.healthBar.sprite.visible = true;
    drawHealthBar(this.healthBar, this.health / this.maxHealth);
    if (game.player.alive) this.forcedTargetUntil = game.elapsed + 2.2;
    if (this.health <= 0) {
      this.die(game, part === 'head');
    }
    return dealt;
  }

  die(game, headshot) {
    if (this.dead) return;
    this.dead = true;
    this.alive = false;
    this.deathTimer = 0;
    this.healthBar.sprite.visible = false;
    game.onEnemyKilled(this, headshot);
  }
}

export class EnemyProjectile {
  constructor(scene, origin, target, speed, damage, big, color = 0xff6a44) {
    this.scene = scene;
    this.position = origin.clone();
    this.radius = big ? 0.3 : 0.2;
    this.damage = damage;
    this.alive = true;
    this.life = 6;
    this.big = big;
    const direction = target.clone().sub(origin);
    this.velocity = direction.normalize().multiplyScalar(speed);
    this.group = new THREE.Group();
    this.group.position.copy(this.position);
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(this.radius, 9, 7),
      new THREE.MeshBasicMaterial({ color }),
    );
    this.group.add(mesh);
    const glow = createGlowSprite(color, big ? 1.5 : 0.9, 0.8);
    this.group.add(glow);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(this.radius * 1.5, 0.025, 4, 14),
      new THREE.MeshBasicMaterial({ color: 0xffd7a2, transparent: true, opacity: 0.7 }),
    );
    halo.rotation.x = Math.PI / 2;
    this.group.add(halo);
    this.halo = halo;
    scene.add(this.group);
    this.temp = new THREE.Vector3();
  }

  update(dt, game) {
    if (!this.alive) return;
    this.life -= dt;
    this.position.addScaledVector(this.velocity, dt);
    this.group.position.copy(this.position);
    this.halo.rotation.z += dt * 5;
    if (this.life <= 0) {
      this.destroy(game, false);
      return;
    }

    if (dist2D(this.position, game.core.position) < game.core.radius + this.radius) {
      game.damageCore(this.damage, null, this.position);
      this.destroy(game, true);
      return;
    }

    if (game.player.alive) {
      const dx = this.position.x - game.player.position.x;
      const dz = this.position.z - game.player.position.z;
      if (Math.hypot(dx, dz) < game.player.radius + this.radius + 0.2) {
        game.damagePlayer(this.damage);
        this.destroy(game, true);
        return;
      }
    }
    for (const ally of game.allies) {
      if (ally.downed) continue;
      const dx = this.position.x - ally.position.x;
      const dz = this.position.z - ally.position.z;
      if (Math.hypot(dx, dz) < ally.radius + this.radius + 0.15) {
        game.damageAlly(ally, this.damage);
        this.destroy(game, true);
        return;
      }
    }

    for (const obstacle of game.world.obstacles) {
      if (
        this.position.x > obstacle.minX - this.radius &&
        this.position.x < obstacle.maxX + this.radius &&
        this.position.z > obstacle.minZ - this.radius &&
        this.position.z < obstacle.maxZ + this.radius
      ) {
        this.destroy(game, true);
        return;
      }
    }
  }

  destroy(game, impact) {
    if (!this.alive) return;
    this.alive = false;
    if (impact) {
      game.spawnImpact(this.position, this.big ? 0xffb058 : 0xff7358, this.big ? 20 : 10, this.big ? 3.5 : 2.2);
    }
    this.scene.remove(this.group);
    this.group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
  }
}
