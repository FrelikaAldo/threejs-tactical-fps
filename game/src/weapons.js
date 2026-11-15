// Weapons: the data table, the trigger, the recoil, the spread, and the ray that decides what
// a bullet hit. One module owns every number a gun has, so a rifle is a row in a table and not
// a block of code, and a bot fires through the same functions the player does.
import * as THREE from 'three';
import { rayBox, nearestWall } from './physics.js';

export const WEAPONS = {
  kestrel: {
    id: 'kestrel', name: 'Kestrel .45', slot: 'secondary', price: 500, auto: false,
    damage: 30, headMultiplier: 3.6, legMultiplier: 0.75, rateOfFire: 380,
    magazine: 12, reserve: 36, reloadTime: 1.85, range: 60,
    spreadBase: 0.0055, spreadMove: 0.055, spreadAir: 0.12, spreadPerShot: 0.012,
    recoilPitch: 0.016, recoilYaw: 0.004, recovery: 9.5,
  },
  vk74: {
    id: 'vk74', name: 'VK-74', slot: 'primary', price: 2700, auto: true,
    damage: 34, headMultiplier: 4.0, legMultiplier: 0.8, rateOfFire: 600,
    magazine: 30, reserve: 90, reloadTime: 2.4, range: 90,
    spreadBase: 0.0028, spreadMove: 0.085, spreadAir: 0.2, spreadPerShot: 0.0065,
    recoilPitch: 0.019, recoilYaw: 0.0055, recovery: 7.2,
  },
  wasp: {
    id: 'wasp', name: 'Wasp SMG', slot: 'primary', price: 1250, auto: true,
    damage: 22, headMultiplier: 3.2, legMultiplier: 0.85, rateOfFire: 880,
    magazine: 25, reserve: 100, reloadTime: 2.0, range: 55,
    spreadBase: 0.006, spreadMove: 0.045, spreadAir: 0.14, spreadPerShot: 0.0055,
    recoilPitch: 0.011, recoilYaw: 0.006, recovery: 9,
  },
  hatchet: {
    id: 'hatchet', name: 'Hatchet', slot: 'melee', price: 0, auto: false,
    damage: 62, headMultiplier: 1.6, legMultiplier: 1, rateOfFire: 90,
    magazine: Infinity, reserve: 0, reloadTime: 0, range: 2.1,
    spreadBase: 0, spreadMove: 0, spreadAir: 0, spreadPerShot: 0,
    recoilPitch: 0.01, recoilYaw: 0.002, recovery: 12,
  },
};

export const GRENADE = { id: 'frag', name: 'Frag', price: 300, damage: 96, radius: 6.2, fuse: 2.4 };

const BODY_RADIUS = 0.42;
const BODY_HEIGHT = 1.78;

function bodyBox(position) {
  return {
    minX: position.x - BODY_RADIUS, maxX: position.x + BODY_RADIUS,
    minY: position.y, maxY: position.y + BODY_HEIGHT,
    minZ: position.z - BODY_RADIUS, maxZ: position.z + BODY_RADIUS,
  };
}

function headBox(position) {
  return {
    minX: position.x - 0.23, maxX: position.x + 0.23,
    minY: position.y + BODY_HEIGHT - 0.34, maxY: position.y + BODY_HEIGHT + 0.03,
    minZ: position.z - 0.23, maxZ: position.z + 0.23,
  };
}

// The one hit test bullets and bot vision share: nearest body along the ray, or Infinity.
export function traceTarget(origin, direction, maxDistance, targets) {
  let best = { distance: maxDistance, target: null, headshot: false };
  for (const target of targets) {
    if (!target.alive) continue;
    const head = headBox(target.position);
    const headDistance = rayBox(origin, direction, head);
    const bodyDistance = rayBox(origin, direction, bodyBox(target.position));
    const distance = Math.min(headDistance, bodyDistance);
    if (distance < best.distance) {
      best = { distance, target, headshot: headDistance <= bodyDistance };
    }
  }
  return best;
}

export function createArsenal(options) {
  const { camera, world, audio, fx, onKill, onDamageDealt } = options;
  const state = {
    slots: { primary: null, secondary: WEAPONS.kestrel, melee: WEAPONS.hatchet },
    current: 'secondary',
    ammo: { kestrel: { mag: 12, reserve: 36 } },
    grenades: 0,
    nextShotAt: 0,
    reloadUntil: 0,
    spread: 0,
    recoil: new THREE.Vector2(),
    kick: new THREE.Vector2(),
    triggerHeld: false,
  };

  const origin = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const tmp = new THREE.Vector3();

  function currentWeapon() {
    return state.slots[state.current] ?? WEAPONS.hatchet;
  }

  function ammoFor(weapon) {
    if (!state.ammo[weapon.id]) state.ammo[weapon.id] = { mag: weapon.magazine, reserve: weapon.reserve };
    return state.ammo[weapon.id];
  }

  function give(weaponId) {
    const weapon = WEAPONS[weaponId];
    if (!weapon) return;
    state.slots[weapon.slot] = weapon;
    state.ammo[weaponId] = { mag: weapon.magazine, reserve: weapon.reserve };
    state.current = weapon.slot;
  }

  function giveGrenade(count) {
    state.grenades = Math.min(2, state.grenades + count);
  }

  function beginReload(now) {
    const weapon = currentWeapon();
    if (weapon.magazine === Infinity) return;
    const ammo = ammoFor(weapon);
    if (ammo.mag >= weapon.magazine || ammo.reserve <= 0 || state.reloadUntil > now) return;
    state.reloadUntil = now + weapon.reloadTime;
    audio.play('reload', { weapon: weapon.id });
  }

  function finishReload(now) {
    const weapon = currentWeapon();
    const ammo = ammoFor(weapon);
    if (now < state.reloadUntil) return;
    if (ammo.mag >= weapon.magazine || ammo.reserve <= 0) return;
    const needed = weapon.magazine - ammo.mag;
    const taken = Math.min(needed, ammo.reserve);
    ammo.mag += taken;
    ammo.reserve -= taken;
    state.reloadUntil = 0;
  }

  function reloading(now) {
    return now < state.reloadUntil;
  }

  // Firing: spread grows with movement, in the air and with every shot taken, and decays when
  // the player stands still. Accuracy is therefore something a player has to earn back.
  function fire(now, shooter, targets, isMoving, isAirborne, onEmpty) {
    const weapon = currentWeapon();
    if (now < state.nextShotAt || reloading(now)) return false;
    const ammo = ammoFor(weapon);
    if (ammo.mag <= 0) {
      if (onEmpty) onEmpty();
      beginReload(now);
      return false;
    }
    ammo.mag -= 1;
    state.nextShotAt = now + 60 / weapon.rateOfFire;

    const movementPenalty = isMoving ? weapon.spreadMove : 0;
    const airPenalty = isAirborne ? weapon.spreadAir : 0;
    const totalSpread = weapon.spreadBase + movementPenalty + airPenalty + state.spread;

    shooter.eyePosition(origin);
    camera.getWorldDirection(direction);
    if (totalSpread > 0) {
      direction.x += (Math.random() - 0.5) * totalSpread * 2;
      direction.y += (Math.random() - 0.5) * totalSpread * 2;
      direction.z += (Math.random() - 0.5) * totalSpread * 2;
      direction.normalize();
    }

    const hit = traceTarget(origin, direction, weapon.range, targets);
    const wallDistance = nearestWall(world.colliders, origin, direction, weapon.range);
    const hitWall = wallDistance < hit.distance;
    tmp.copy(direction).multiplyScalar(hitWall ? wallDistance : hit.distance).add(origin);

    if (!hitWall && hit.target) {
      const multiplier = hit.headshot ? weapon.headMultiplier : 1;
      const damage = weapon.damage * multiplier;
      hit.target.takeDamage(damage, shooter, hit.headshot);
      onDamageDealt?.(hit.target, damage, hit.headshot);
      fx.impact(tmp, 'blood');
    } else {
      fx.impact(tmp, 'spark');
    }
    fx.tracer(origin, tmp);
    audio.play(weapon.id === 'hatchet' ? 'swing' : 'shot', { weapon: weapon.id });

    state.spread = Math.min(0.05, state.spread + weapon.spreadPerShot);
    state.kick.x += weapon.recoilPitch * (0.7 + Math.random() * 0.6);
    state.kick.y += (Math.random() - 0.5) * weapon.recoilYaw * 2;
    if (ammo.mag === 0) beginReload(now);
    return true;
  }

  function throwGrenade(now, shooter) {
    if (state.grenades <= 0) return false;
    state.grenades -= 1;
    shooter.eyePosition(origin);
    camera.getWorldDirection(direction);
    fx.spawnGrenade(origin.clone(), direction.clone().multiplyScalar(17).setY(direction.y * 17 + 3.4), world, (point) => {
      audio.play('explosion');
      fx.explosion(point);
      for (const target of options.targets()) {
        if (!target.alive) continue;
        const distance = target.position.distanceTo(point);
        if (distance > GRENADE.radius) continue;
        const falloff = 1 - distance / GRENADE.radius;
        const blocked = nearestWall(world.colliders, point, tmp.copy(target.position).sub(point).normalize(), distance) < distance - 0.4;
        if (blocked) continue;
        target.takeDamage(GRENADE.damage * falloff, shooter, false);
        onDamageDealt?.(target, GRENADE.damage * falloff, false);
      }
    });
    return true;
  }

  // Called once per fixed step: decays spread and view kick, finishes reloads.
  function step(dt, now) {
    const weapon = currentWeapon();
    state.spread = Math.max(0, state.spread - dt * 0.055);
    state.kick.multiplyScalar(Math.max(0, 1 - dt * weapon.recovery));
    finishReload(now);
  }

  return {
    state,
    WEAPONS,
    currentWeapon,
    ammoFor,
    give,
    giveGrenade,
    fire,
    throwGrenade,
    beginReload,
    reloading,
    step,
    select(slot) {
      if (!state.slots[slot]) return false;
      state.current = slot;
      state.reloadUntil = 0;
      return true;
    },
    viewKick: () => state.kick,
    spreadRadius: () => currentWeapon().spreadBase + state.spread,
    resetLoadout() {
      state.slots.primary = null;
      state.slots.secondary = WEAPONS.kestrel;
      state.slots.melee = WEAPONS.hatchet;
      state.current = 'secondary';
      state.ammo = { kestrel: { mag: WEAPONS.kestrel.magazine, reserve: WEAPONS.kestrel.reserve } };
      state.grenades = 0;
      state.spread = 0;
      state.kick.set(0, 0);
    },
  };
}