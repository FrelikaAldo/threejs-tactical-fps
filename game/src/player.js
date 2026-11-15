// The player's body and camera: Quake-style acceleration and friction, crouch that trades
// speed for a lower head, jump, and the eye height and bob that make the first-person view
// feel alive. This module owns the body's numbers; the round owns whether it may move.
import * as THREE from 'three';
import { slideMove, floorAt } from './physics.js';

const RADIUS = 0.42;
const STAND_HEIGHT = 1.78;
const CROUCH_HEIGHT = 1.15;
const EYE_STAND = 1.62;
const EYE_CROUCH = 1.02;

const MAX_SPEED = 5.6;
const WALK_SPEED = 2.5;
const CROUCH_SPEED = 2.1;
const ACCELERATION = 62;
const FRICTION = 9.5;
const AIR_ACCELERATION = 9;
const JUMP_SPEED = 5.2;
const GRAVITY = 17.5;
const LOOK_SENSITIVITY = 0.0022;
const MAX_PITCH = Math.PI / 2 - 0.02;

export function createPlayer(world) {
  const state = {
    position: new THREE.Vector3(0, 0, 25),
    velocity: new THREE.Vector3(),
    yaw: Math.PI,
    pitch: 0,
    grounded: true,
    crouching: false,
    walking: false,
    health: 100,
    armor: 0,
    alive: true,
    bobPhase: 0,
    eyeHeight: EYE_STAND,
    stepDistance: 0,
  };

  const forward = new THREE.Vector3();
  const right = new THREE.Vector3();
  const wish = new THREE.Vector3();

  function spawnAt(position, yaw = Math.PI) {
    state.position.copy(position);
    state.velocity.set(0, 0, 0);
    state.yaw = yaw;
    state.pitch = 0;
    state.health = 100;
    state.alive = true;
    state.grounded = true;
    state.crouching = false;
    state.eyeHeight = EYE_STAND;
  }

  function applyLook(lookX, lookY) {
    state.yaw -= lookX * LOOK_SENSITIVITY;
    state.pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, state.pitch - lookY * LOOK_SENSITIVITY));
  }

  // One fixed simulation step. `allowMove` is false during freeze time, so the body holds
  // still while the player can still look around and buy.
  function step(dt, input, allowMove) {
    if (!state.alive) return;

    const wantsCrouch = allowMove && input.down('crouch');
    state.crouching = wantsCrouch;
    state.walking = input.down('walk');

    const targetHeight = state.crouching ? CROUCH_HEIGHT : STAND_HEIGHT;
    const eyeTarget = state.crouching ? EYE_CROUCH : EYE_STAND;

    forward.set(-Math.sin(state.yaw), 0, -Math.cos(state.yaw));
    right.set(Math.cos(state.yaw), 0, -Math.sin(state.yaw));

    wish.set(0, 0, 0);
    if (allowMove) {
      if (input.down('forward')) wish.add(forward);
      if (input.down('back')) wish.sub(forward);
      if (input.down('right')) wish.add(right);
      if (input.down('left')) wish.sub(right);
    }
    if (wish.lengthSq() > 0) wish.normalize();

    let maxSpeed = MAX_SPEED;
    if (state.crouching) maxSpeed = CROUCH_SPEED;
    else if (state.walking) maxSpeed = WALK_SPEED;

    if (state.grounded) {
      // friction first, then acceleration along the wish direction: this is what makes a
      // counter-strafe stop the body, and what makes running and gunning cost accuracy.
      const speed = Math.hypot(state.velocity.x, state.velocity.z);
      if (speed > 0.01) {
        const drop = Math.max(speed, 1.2) * FRICTION * dt;
        const scale = Math.max(0, speed - drop) / speed;
        state.velocity.x *= scale;
        state.velocity.z *= scale;
      } else {
        state.velocity.x = 0;
        state.velocity.z = 0;
      }
      if (wish.lengthSq() > 0) {
        const current = state.velocity.x * wish.x + state.velocity.z * wish.z;
        const add = Math.min(ACCELERATION * dt * maxSpeed, maxSpeed - current);
        if (add > 0) {
          state.velocity.x += wish.x * add;
          state.velocity.z += wish.z * add;
        }
      }
      if (allowMove && input.take('jump')) {
        state.velocity.y = JUMP_SPEED;
        state.grounded = false;
      }
    } else if (wish.lengthSq() > 0) {
      state.velocity.x += wish.x * AIR_ACCELERATION * dt;
      state.velocity.z += wish.z * AIR_ACCELERATION * dt;
      const speed = Math.hypot(state.velocity.x, state.velocity.z);
      if (speed > MAX_SPEED) {
        state.velocity.x = (state.velocity.x / speed) * MAX_SPEED;
        state.velocity.z = (state.velocity.z / speed) * MAX_SPEED;
      }
    }

    state.velocity.y -= GRAVITY * dt;

    const feet = state.position.y;
    const moved = slideMove(
      world.colliders, state.position.x, state.position.z, RADIUS,
      feet, feet + targetHeight, state.velocity.x * dt, state.velocity.z * dt,
    );
    if (moved.blockedX) state.velocity.x *= 0.2;
    if (moved.blockedZ) state.velocity.z *= 0.2;
    state.position.x = moved.x;
    state.position.z = moved.z;

    const ground = floorAt(world.colliders, state.position.x, state.position.z, feet);
    state.position.y += state.velocity.y * dt;
    if (state.position.y <= ground) {
      state.position.y = ground;
      state.velocity.y = 0;
      state.grounded = true;
    }

    // clamp to the map
    const b = world.bounds;
    state.position.x = Math.max(b.minX, Math.min(b.maxX, state.position.x));
    state.position.z = Math.max(b.minZ, Math.min(b.maxZ, state.position.z));

    state.eyeHeight += (eyeTarget - state.eyeHeight) * Math.min(1, dt * 12);

    const planar = Math.hypot(state.velocity.x, state.velocity.z);
    state.bobPhase += dt * planar * 2.4;
    state.stepDistance += planar * dt;
  }

  // Camera placement, called once per rendered frame: eye height, a small bob, and a lean
  // that grows with speed. Kept apart from the fixed step so rendering never moves the body.
  function applyCamera(camera) {
    const planar = Math.hypot(state.velocity.x, state.velocity.z);
    const bobAmount = state.grounded ? Math.min(planar / MAX_SPEED, 1) * 0.028 : 0;
    const bob = Math.sin(state.bobPhase * 2) * bobAmount;
    const sway = Math.cos(state.bobPhase) * bobAmount * 0.6;
    camera.position.set(
      state.position.x + sway * Math.cos(state.yaw),
      state.position.y + state.eyeHeight + bob,
      state.position.z - sway * Math.sin(state.yaw),
    );
    camera.rotation.set(0, 0, 0);
    camera.rotateY(state.yaw);
    camera.rotateX(state.pitch);
  }

  return {
    state,
    spawnAt,
    step,
    applyCamera,
    applyLook,
    radius: RADIUS,
    height: STAND_HEIGHT,
    eyeHeight: () => state.eyeHeight,
    eyePosition: (out) => out.set(state.position.x, state.position.y + state.eyeHeight, state.position.z),
    isMoving: () => Math.hypot(state.velocity.x, state.velocity.z) > 0.6,
    speed: () => Math.hypot(state.velocity.x, state.velocity.z),
  };
}