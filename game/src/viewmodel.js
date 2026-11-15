// The first-person weapon: a low-poly viewmodel built from boxes and parented to the camera, so
// the gun the player sees is lit by the same lamps as the room. It sways with the body, kicks
// with the recoil the rounds module reports, and drops out of frame while reloading.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const PARTS = {
  vk74: [
    ['receiver', 0.07, 0.09, 0.34, 0, 0, -0.12, PALETTE.steel],
    ['barrel', 0.035, 0.035, 0.42, 0, 0.012, -0.42, PALETTE.steel],
    ['handguard', 0.055, 0.07, 0.2, 0, -0.005, -0.3, PALETTE.rust],
    ['magazine', 0.05, 0.16, 0.09, 0, -0.13, -0.1, PALETTE.rust],
    ['stock', 0.05, 0.07, 0.2, 0, -0.02, 0.14, PALETTE.rust],
    ['sight', 0.02, 0.03, 0.03, 0, 0.06, -0.36, PALETTE.ink],
  ],
  wasp: [
    ['receiver', 0.065, 0.085, 0.26, 0, 0, -0.1, PALETTE.steel],
    ['barrel', 0.03, 0.03, 0.24, 0, 0.01, -0.28, PALETTE.steel],
    ['magazine', 0.045, 0.19, 0.07, 0, -0.14, -0.06, PALETTE.rust],
    ['stock', 0.045, 0.06, 0.14, 0, -0.015, 0.1, PALETTE.rust],
  ],
  kestrel: [
    ['receiver', 0.045, 0.075, 0.22, 0, 0, -0.1, PALETTE.steel],
    ['barrel', 0.028, 0.028, 0.12, 0, 0.012, -0.24, PALETTE.steel],
    ['grip', 0.04, 0.13, 0.06, 0, -0.1, -0.02, PALETTE.rust],
  ],
  hatchet: [
    ['haft', 0.03, 0.03, 0.34, 0, -0.06, -0.12, PALETTE.rust],
    ['head', 0.03, 0.13, 0.1, 0, 0.06, -0.28, PALETTE.steel],
  ],
};

function buildGun(parts) {
  const group = new THREE.Group();
  for (const [, w, h, d, x, y, z, color] of parts) {
    const material = new THREE.MeshStandardMaterial({
      color: new THREE.Color(color), roughness: 0.55, metalness: 0.45,
    });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    group.add(mesh);
  }
  return group;
}

export function createViewmodel(camera) {
  const rig = new THREE.Group();
  rig.scale.setScalar(0.82);
  rig.position.set(0.19, -0.135, -0.4);
  camera.add(rig);

  const guns = {};
  for (const [id, parts] of Object.entries(PARTS)) {
    const gun = buildGun(parts);
    gun.visible = false;
    rig.add(gun);
    guns[id] = gun;
  }

  // a hand on the grip, so the gun is held by something and not floating
  const handMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.sandDark), roughness: 0.9 });
  const hand = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.14), handMaterial);
  hand.position.set(-0.01, -0.09, 0.02);
  rig.add(hand);
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.12, 0.26), new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.steel), roughness: 0.85,
  }));
  sleeve.position.set(-0.01, -0.12, 0.2);
  rig.add(sleeve);

  const muzzleLight = new THREE.PointLight(new THREE.Color(PALETTE.amber), 0, 8, 2);
  muzzleLight.position.set(0, 0.02, -0.55);
  rig.add(muzzleLight);

  let current = null;
  let swayX = 0;
  let swayY = 0;
  let kick = 0;
  let reloadTilt = 0;
  let bobPhase = 0;

  function select(weaponId) {
    if (current === weaponId) return;
    for (const [id, gun] of Object.entries(guns)) gun.visible = id === weaponId;
    current = weaponId;
  }

  function fire() {
    kick = Math.min(0.09, kick + 0.035);
    muzzleLight.intensity = 9;
  }

  function update(dt, { speed, reloading, grounded }) {
    kick = Math.max(0, kick - dt * 0.5);
    muzzleLight.intensity *= Math.max(0, 1 - dt * 26);

    bobPhase += dt * (2 + speed * 1.6);
    const bob = grounded ? Math.sin(bobPhase * 2) * 0.006 * Math.min(speed, 1) : 0;
    const sway = Math.sin(bobPhase) * 0.008 * Math.min(speed, 1);

    const targetTilt = reloading ? 0.55 : 0;
    reloadTilt += (targetTilt - reloadTilt) * Math.min(1, dt * 8);

    swayX += (sway - swayX) * Math.min(1, dt * 6);
    swayY += (bob - swayY) * Math.min(1, dt * 6);

    rig.position.set(0.19 + swayX, -0.135 + swayY - kick * 0.15, -0.4 + kick);
    rig.rotation.set(-kick * 2.2 - reloadTilt * 0.5, swayX * 1.6, reloadTilt * 0.7);
  }

  return { select, fire, update, rig };}
