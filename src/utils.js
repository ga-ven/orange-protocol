import * as THREE from '../vendor/three.module.js';

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const lerp = (a, b, t) => a + (b - a) * t;
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const rand = (min, max) => min + Math.random() * (max - min);
export const randInt = (min, max) => Math.floor(rand(min, max + 1));
export const pick = (items) => items[Math.floor(Math.random() * items.length)];
export const dist2D = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const angleTo = (from, to) => Math.atan2(to.x - from.x, to.z - from.z);

export function dampAngle(current, target, lambda, dt) {
  let delta = ((target - current + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return current + delta * (1 - Math.exp(-lambda * dt));
}

export function distancePointToSegment2D(point, a, b) {
  const abx = b.x - a.x;
  const abz = b.z - a.z;
  const apx = point.x - a.x;
  const apz = point.z - a.z;
  const lengthSq = abx * abx + abz * abz;
  const t = lengthSq > 0 ? clamp((apx * abx + apz * abz) / lengthSq, 0, 1) : 0;
  const x = a.x + abx * t;
  const z = a.z + abz * t;
  return Math.hypot(point.x - x, point.z - z);
}

export function raycasterHitsBox(origin, direction, maxDistance, box) {
  const ray = new THREE.Ray(origin, direction);
  const hit = new THREE.Vector3();
  if (!ray.intersectBox(box, hit)) return Infinity;
  const distance = hit.distanceTo(origin);
  return distance <= maxDistance ? distance : Infinity;
}

let glowTexture = null;
export function getGlowTexture() {
  if (glowTexture) return glowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  const gradient = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.18, 'rgba(255,225,170,0.92)');
  gradient.addColorStop(0.5, 'rgba(255,142,62,0.34)');
  gradient.addColorStop(1, 'rgba(255,120,30,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 128, 128);
  glowTexture = new THREE.CanvasTexture(canvas);
  glowTexture.colorSpace = THREE.SRGBColorSpace;
  return glowTexture;
}

export function createGlowSprite(color = 0xff8a3d, scale = 1, opacity = 0.8) {
  const material = new THREE.SpriteMaterial({
    map: getGlowTexture(),
    color,
    transparent: true,
    opacity,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.setScalar(scale);
  return sprite;
}

export function createTextSprite(title, subtitle, options = {}) {
  const width = options.width || 512;
  const height = options.height || 160;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  ctx.clearRect(0, 0, width, height);
  if (options.background !== false) {
    ctx.fillStyle = options.background || 'rgba(255,247,231,0.94)';
    ctx.beginPath();
    const radius = 34;
    ctx.roundRect(8, 8, width - 16, height - 16, radius);
    ctx.fill();
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = options.titleColor || '#4d3327';
  ctx.font = `700 ${options.titleSize || 52}px "Microsoft YaHei", "PingFang SC", sans-serif`;
  ctx.fillText(title, width / 2, subtitle ? height * 0.4 : height * 0.5);
  if (subtitle) {
    ctx.fillStyle = options.subtitleColor || '#e85c22';
    ctx.font = `600 ${options.subtitleSize || 30}px "Microsoft YaHei", "PingFang SC", sans-serif`;
    ctx.fillText(subtitle, width / 2, height * 0.7);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    depthTest: options.depthTest !== false,
  });
  const sprite = new THREE.Sprite(material);
  const aspect = width / height;
  const size = options.scale || 2.4;
  sprite.scale.set(size * aspect, size, 1);
  return sprite;
}

export function createCanvasTexture(size, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  draw(ctx, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

export function makeFloorTexture() {
  return createCanvasTexture(1024, (ctx, size) => {
    ctx.fillStyle = '#efd2aa';
    ctx.fillRect(0, 0, size, size);
    const cell = size / 4;
    for (let y = 0; y < 4; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        ctx.fillStyle = (x + y) % 2 === 0 ? '#f5ddba' : '#ebc99e';
        ctx.fillRect(x * cell + 3, y * cell + 3, cell - 6, cell - 6);
        ctx.strokeStyle = 'rgba(196,130,78,0.18)';
        ctx.lineWidth = 3;
        ctx.strokeRect(x * cell + 15, y * cell + 15, cell - 30, cell - 30);
      }
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.48)';
    ctx.lineWidth = 5;
    for (let i = 1; i < 4; i += 1) {
      ctx.beginPath();
      ctx.moveTo(i * cell, 0);
      ctx.lineTo(i * cell, size);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(0, i * cell);
      ctx.lineTo(size, i * cell);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(240,125,50,0.18)';
    for (let i = 0; i < 18; i += 1) {
      ctx.beginPath();
      ctx.arc((i * 173) % size, (i * 311 + 70) % size, 3 + (i % 4), 0, Math.PI * 2);
      ctx.fill();
    }
  });
}

export function makeStripeTexture(colorA = '#ff7a2f', colorB = '#fff1d8') {
  return createCanvasTexture(256, (ctx, size) => {
    ctx.fillStyle = colorB;
    ctx.fillRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-Math.PI / 4);
    ctx.fillStyle = colorA;
    for (let x = -size; x < size; x += 80) {
      ctx.fillRect(x, -size, 36, size * 2);
    }
    ctx.restore();
  });
}

export function setShadows(object, cast = false, receive = false) {
  object.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = cast;
      child.receiveShadow = receive;
    }
  });
}

export function canOccupy(x, z, radius, obstacles, arenaHalf) {
  if (Math.abs(x) > arenaHalf - radius || Math.abs(z) > arenaHalf - radius) return false;
  for (const box of obstacles) {
    if (box.noCollision) continue;
    const nearestX = clamp(x, box.minX, box.maxX);
    const nearestZ = clamp(z, box.minZ, box.maxZ);
    const dx = x - nearestX;
    const dz = z - nearestZ;
    if (dx * dx + dz * dz < radius * radius) return false;
  }
  return true;
}

export function moveActor(actor, dirX, dirZ, speed, dt, obstacles, arenaHalf) {
  const length = Math.hypot(dirX, dirZ);
  if (length < 0.0001) return false;
  let unitX = dirX / length;
  let unitZ = dirZ / length;

  // AI units use a stable wall-following choice so they don't jam against the
  // first cover directly between themselves and their target.
  if (actor.isAI) {
    const probeDistance = Math.max(0.9, speed * dt * 7);
    const probeX = actor.position.x + unitX * probeDistance;
    const probeZ = actor.position.z + unitZ * probeDistance;
    if (!canOccupy(probeX, probeZ, actor.radius + 0.12, obstacles, arenaHalf)) {
      if (!actor.avoidSide) actor.avoidSide = Math.random() < 0.5 ? -1 : 1;
      const perpX = -unitZ;
      const perpZ = unitX;
      const candidates = [
        [unitX * 0.32 + perpX * actor.avoidSide, unitZ * 0.32 + perpZ * actor.avoidSide],
        [unitX * 0.32 - perpX * actor.avoidSide, unitZ * 0.32 - perpZ * actor.avoidSide],
      ];
      for (let i = 0; i < candidates.length; i += 1) {
        let [candidateX, candidateZ] = candidates[i];
        const candidateLength = Math.hypot(candidateX, candidateZ) || 1;
        candidateX /= candidateLength;
        candidateZ /= candidateLength;
        const testX = actor.position.x + candidateX * probeDistance;
        const testZ = actor.position.z + candidateZ * probeDistance;
        if (canOccupy(testX, testZ, actor.radius + 0.12, obstacles, arenaHalf)) {
          unitX = candidateX;
          unitZ = candidateZ;
          break;
        }
      }
    }
  }

  let dx = unitX * speed * dt;
  let dz = unitZ * speed * dt;

  // Soft separation from a surface if an actor has already clipped its padded
  // radius. This keeps crowd movement smooth without disabling real collision.
  if (actor.isAI) {
    for (const box of obstacles) {
      if (box.noCollision) continue;
      const expandedMinX = box.minX - actor.radius - 0.18;
      const expandedMaxX = box.maxX + actor.radius + 0.18;
      const expandedMinZ = box.minZ - actor.radius - 0.18;
      const expandedMaxZ = box.maxZ + actor.radius + 0.18;
      if (
        actor.position.x > expandedMinX &&
        actor.position.x < expandedMaxX &&
        actor.position.z > expandedMinZ &&
        actor.position.z < expandedMaxZ
      ) {
        const centerX = (box.minX + box.maxX) / 2;
        const centerZ = (box.minZ + box.maxZ) / 2;
        const awayX = actor.position.x - centerX;
        const awayZ = actor.position.z - centerZ;
        const awayLength = Math.hypot(awayX, awayZ) || 1;
        dx += (awayX / awayLength) * speed * dt * 0.7;
        dz += (awayZ / awayLength) * speed * dt * 0.7;
      }
    }
  }

  let moved = false;
  const nextX = actor.position.x + dx;
  if (canOccupy(nextX, actor.position.z, actor.radius, obstacles, arenaHalf)) {
    actor.position.x = nextX;
    moved = true;
  }
  const nextZ = actor.position.z + dz;
  if (canOccupy(actor.position.x, nextZ, actor.radius, obstacles, arenaHalf)) {
    actor.position.z = nextZ;
    moved = true;
  }
  return moved;
}

export function hasLineOfSight(from, to, obstacles) {
  const origin = new THREE.Vector3(from.x, 1.1, from.z);
  const direction = new THREE.Vector3(to.x - from.x, 0, to.z - from.z);
  const distance = direction.length();
  if (distance < 0.1) return true;
  direction.normalize();
  const ray = new THREE.Ray(origin, direction);
  const hit = new THREE.Vector3();
  for (const box of obstacles) {
    if (box.noCollision) continue;
    if (ray.intersectBox(box.rayBox, hit) && hit.distanceTo(origin) < distance - 0.5) {
      return false;
    }
  }
  return true;
}

export function formatNumber(value, digits = 0) {
  return Number(value).toFixed(digits);
}

export function disposeGroup(group) {
  group.traverse((child) => {
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      for (const material of materials) {
        if (material.map && material.map.userData?.owned !== false) {
          // Shared textures are reused; do not dispose them here.
        }
        material.dispose();
      }
    }
  });
}
