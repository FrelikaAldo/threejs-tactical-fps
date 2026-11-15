// Effects: tracers, impacts, the muzzle flash, the grenade and the explosion. Every effect is
// built once into a pool and then only moved and faded, so a firefight allocates nothing and
// the frame time stays flat.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { nearestWall } from './physics.js';

const TRACER_COUNT = 28;
const IMPACT_COUNT = 40;

export function createFx(scene) {
  const tracers = [];
  const impacts = [];
  const tmp = new THREE.Vector3();

  // tracers: one line segment each, faded by opacity, reused oldest first
  for (let i = 0; i < TRACER_COUNT; i += 1) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(6), 3));
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0, depthWrite: false,
    });
    const line = new THREE.Line(geometry, material);
    line.visible = false;
    line.frustumCulled = false;
    scene.add(line);
    tracers.push({ line, life: 0, maxLife: 0.085 });
  }
  let tracerIndex = 0;

  // impacts: a tiny billboard that pops and fades, additive so it reads against dark concrete
  const impactGeometry = new THREE.PlaneGeometry(0.18, 0.18);
  for (let i = 0; i < IMPACT_COUNT; i += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0,
      depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(impactGeometry, material);
    mesh.visible = false;
    scene.add(mesh);
    impacts.push({ mesh, life: 0, maxLife: 0.22 });
  }
  let impactIndex = 0;

  const flashLight = new THREE.PointLight(new THREE.Color(PALETTE.amber), 0, 16, 2);
  scene.add(flashLight);
  let flashLife = 0;

  const grenades = [];
  const grenadeGeometry = new THREE.SphereGeometry(0.12, 10, 8);
  const grenadeMaterial = new THREE.MeshStandardMaterial({
    color: new THREE.Color(PALETTE.steel), roughness: 0.6, metalness: 0.6,
    emissive: new THREE.Color(PALETTE.amber), emissiveIntensity: 0.35,
  });

  const explosionGeometry = new THREE.SphereGeometry(1, 16, 12);
  const explosions = [];

  function tracer(from, to, enemy = false) {
    const entry = tracers[tracerIndex];
    tracerIndex = (tracerIndex + 1) % TRACER_COUNT;
    const attribute = entry.line.geometry.getAttribute('position');
    attribute.setXYZ(0, from.x, from.y, from.z);
    attribute.setXYZ(1, to.x, to.y, to.z);
    attribute.needsUpdate = true;
    entry.line.material.color.set(enemy ? PALETTE.blood : PALETTE.amber);
    entry.line.material.opacity = 0.75;
    entry.line.visible = true;
    entry.life = entry.maxLife;
  }

  function impact(point, kind = 'spark') {
    const entry = impacts[impactIndex];
    impactIndex = (impactIndex + 1) % IMPACT_COUNT;
    entry.mesh.position.copy(point);
    entry.mesh.material.color.set(kind === 'blood' ? PALETTE.blood : PALETTE.amber);
    entry.mesh.material.opacity = kind === 'blood' ? 0.9 : 0.8;
    entry.mesh.scale.setScalar(kind === 'blood' ? 1.4 : 1);
    entry.mesh.visible = true;
    entry.life = entry.maxLife;
  }

  function muzzle(point, direction) {
    flashLight.position.copy(point).addScaledVector(direction, 0.4);
    flashLight.intensity = 22;
    flashLife = 0.055;
  }

  function spawnGrenade(origin, velocity, world, onExplode) {
    const mesh = new THREE.Mesh(grenadeGeometry, grenadeMaterial);
    mesh.position.copy(origin);
    scene.add(mesh);
    grenades.push({ mesh, velocity: velocity.clone(), fuse: 2.4, world, onExplode });
  }

  function explosion(point) {
    const material = new THREE.MeshBasicMaterial({
      color: new THREE.Color(PALETTE.amber), transparent: true, opacity: 0.9,
      depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const mesh = new THREE.Mesh(explosionGeometry, material);
    mesh.position.copy(point);
    mesh.scale.setScalar(0.6);
    scene.add(mesh);
    explosions.push({ mesh, life: 0.5, maxLife: 0.5 });
    flashLight.position.copy(point).addScaledVector(tmp.set(0, 1, 0), 0.5);
    flashLight.intensity = 90;
    flashLife = 0.16;
  }

  function update(dt) {
    for (const entry of tracers) {
      if (entry.life <= 0) continue;
      entry.life -= dt;
      entry.line.material.opacity = Math.max(0, (entry.life / entry.maxLife) * 0.75);
      if (entry.life <= 0) entry.line.visible = false;
    }
    for (const entry of impacts) {
      if (entry.life <= 0) continue;
      entry.life -= dt;
      entry.mesh.material.opacity = Math.max(0, entry.life / entry.maxLife);
      entry.mesh.scale.multiplyScalar(1 + dt * 2.2);
      if (entry.life <= 0) entry.mesh.visible = false;
    }
    if (flashLife > 0) {
      flashLife -= dt;
      flashLight.intensity *= Math.max(0, 1 - dt * 22);
      if (flashLife <= 0) flashLight.intensity = 0;
    }
    for (let i = grenades.length - 1; i >= 0; i -= 1) {
      const grenade = grenades[i];
      grenade.velocity.y -= 17.5 * dt;
      const next = grenade.mesh.position.clone().addScaledVector(grenade.velocity, dt);
      const distance = next.distanceTo(grenade.mesh.position);
      const direction = next.clone().sub(grenade.mesh.position).normalize();
      const wall = nearestWall(grenade.world.colliders, grenade.mesh.position, direction, distance);
      if (wall < distance) {
        grenade.velocity.multiplyScalar(-0.32);
        grenade.mesh.position.addScaledVector(direction, Math.max(0, wall - 0.02));
      } else {
        grenade.mesh.position.copy(next);
      }
      if (grenade.mesh.position.y < 0.12) {
        grenade.mesh.position.y = 0.12;
        grenade.velocity.y = Math.abs(grenade.velocity.y) * 0.32;
        grenade.velocity.x *= 0.72;
        grenade.velocity.z *= 0.72;
      }
      grenade.fuse -= dt;
      if (grenade.fuse <= 0) {
        grenade.onExplode(grenade.mesh.position.clone());
        scene.remove(grenade.mesh);
        grenades.splice(i, 1);
      }
    }
    for (let i = explosions.length - 1; i >= 0; i -= 1) {
      const entry = explosions[i];
      entry.life -= dt;
      const progress = 1 - entry.life / entry.maxLife;
      entry.mesh.scale.setScalar(0.6 + progress * 5.4);
      entry.mesh.material.opacity = Math.max(0, 0.9 * (1 - progress));
      if (entry.life <= 0) {
        scene.remove(entry.mesh);
        entry.mesh.material.dispose();
        explosions.splice(i, 1);
      }
    }
  }

  function reset() {
    for (const entry of tracers) { entry.life = 0; entry.line.visible = false; }
    for (const entry of impacts) { entry.life = 0; entry.mesh.visible = false; }
    for (const grenade of grenades) scene.remove(grenade.mesh);
    grenades.length = 0;
    for (const entry of explosions) scene.remove(entry.mesh);
    explosions.length = 0;
    flashLight.intensity = 0;
    flashLife = 0;
  }

  return { tracer, impact, muzzle, explosion, spawnGrenade, update, reset };
}