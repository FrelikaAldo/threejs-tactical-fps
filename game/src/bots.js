// Bots: a body, a rifle and a small mind. Each bot walks the waypoint graph, watches a cone in
// front of it, hears gunfire, takes cover behind the map's own boxes, and fights through the
// same trace the player's bullets use. The state machine is deliberately plain: five states,
// one transition table, no hidden modes.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { slideMove, floorAt, nearestWall } from './physics.js';
import { pathBetween, nearestNode } from './nav.js';
import { traceTarget, WEAPONS } from './weapons.js';

const BODY_HEIGHT = 1.78;
const RADIUS = 0.42;
const EYE_HEIGHT = 1.58;
const MAX_SPEED = { rusher: 4.6, rotator: 3.9, anchor: 3.4, bomber: 4.3 };
const FOV_DOT = Math.cos((100 * Math.PI) / 180) * 0.5;

export const BOT_STATES = ['hold', 'advance', 'engage', 'plant', 'defuse'];

function makeCorpseMaterial(color) {
  return new THREE.MeshStandardMaterial({ color: new THREE.Color(color), roughness: 0.85 });
}

// A bot is boxes: torso, head, arms and a rifle, in team colours. Kept small on purpose, the
// map is what the eye should read; the silhouette carries the recognition.
function buildMesh(team) {
  const group = new THREE.Group();
  const cloth = makeCorpseMaterial(team === 'ct' ? PALETTE.steel : PALETTE.rust);
  const skin = makeCorpseMaterial(PALETTE.sand);
  const accent = new THREE.MeshStandardMaterial({
    color: new THREE.Color(team === 'ct' ? PALETTE.teal : PALETTE.amber),
    emissive: new THREE.Color(team === 'ct' ? PALETTE.teal : PALETTE.amber),
    emissiveIntensity: 0.85, roughness: 0.5,
  });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.78, 0.36), cloth);
  torso.position.y = 1.16;
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.34, 0.32), skin);
  head.position.y = 1.7;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.33, 0.09, 0.06), accent);
  visor.position.set(0, 1.72, -0.16);
  const legs = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.72, 0.32), cloth);
  legs.position.y = 0.42;
  const rifle = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.1, 0.86), makeCorpseMaterial(PALETTE.steel));
  rifle.position.set(0.26, 1.2, -0.42);

  for (const part of [torso, head, visor, legs, rifle]) {
    part.castShadow = true;
    group.add(part);
  }
  group.userData.accent = accent;
  group.userData.baseEmissive = 0.85;
  return group;
}

export function createBots(world, options) {
  const { scene, audio } = options;
  const bots = [];

  // The one place a bot loses health, so a bullet from the player, a bot's bullet and a
  // grenade all land through the same path and report the same way.
  function damageBot(bot, amount, attacker, headshot) {
    if (!bot.alive) return;
    bot.health -= amount;
    bot.hitFlash = 1;
    if (bot.health <= 0) {
      bot.alive = false;
      bot.state = 'hold';
      bot.destination = null;
      options.onDeath?.(bot, attacker, headshot);
    }
  }

  function spawnBot(team, role, position, index) {
    const weapon = role === 'anchor' ? WEAPONS.wasp : WEAPONS.vk74;
    const bot = {
      id: `${team}-${index}`,
      team,
      role,
      skill: role === 'rusher' ? 0.72 : role === 'anchor' ? 0.58 : 0.64,
      position: position.clone(),
      velocity: new THREE.Vector3(),
      yaw: team === 'ct' ? Math.PI : 0,
      health: 100,
      armor: 0,
      alive: true,
      state: 'hold',
      path: [],
      pathIndex: 0,
      destination: null,
      weapon,
      ammo: weapon.magazine,
      reloadUntil: 0,
      nextShotAt: 0,
      reactionUntil: 0,
      lastSeen: new THREE.Vector3(),
      lastSeenAt: -99,
      memoryUntil: 0,
      strafeUntil: 0,
      strafeSign: 1,
      mesh: buildMesh(team),
      hasBomb: false,
      defuser: Math.random() < 0.7,
      plantProgress: 0,
      defuseProgress: 0,
      hitFlash: 0,
    };
    bot.mesh.position.copy(bot.position);
    bot.takeDamage = (amount, attacker, headshot) => damageBot(bot, amount, attacker, headshot);
    scene.add(bot.mesh);
    bots.push(bot);
    return bot;
  }

  function reset(spawnPoints) {
    for (const bot of bots) {
      bot.mesh.visible = false;
      scene.remove(bot.mesh);
    }
    bots.length = 0;
  }

  function eyeOf(bot, out) {
    return out.set(bot.position.x, bot.position.y + EYE_HEIGHT, bot.position.z);
  }

  function lookAt(bot, point, dt, turnRate = 7) {
    const targetYaw = Math.atan2(-(point.x - bot.position.x), -(point.z - bot.position.z));
    let delta = targetYaw - bot.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    bot.yaw += Math.max(-turnRate * dt, Math.min(turnRate * dt, delta));
    return Math.abs(delta);
  }

  const eye = new THREE.Vector3();
  const toTarget = new THREE.Vector3();

  // Can this bot see that point? A cone in front of the body, then a wall test, then a range
  // test: the cheapest test first so a full round of bots costs almost nothing.
  function canSee(bot, point, maxDistance = 46) {
    eyeOf(bot, eye);
    toTarget.copy(point).sub(eye);
    const distance = toTarget.length();
    if (distance > maxDistance) return false;
    toTarget.divideScalar(distance);
    const facing = -Math.sin(bot.yaw) * toTarget.x - Math.cos(bot.yaw) * toTarget.z;
    if (distance > 6 && facing < FOV_DOT) return false;
    return nearestWall(world.colliders, eye, toTarget, distance) >= distance - 0.35;
  }

  function walkTo(bot, point, dt, speedScale = 1) {
    const dx = point.x - bot.position.x;
    const dz = point.z - bot.position.z;
    const distance = Math.hypot(dx, dz);
    if (distance < 0.35) return true;
    const speed = (MAX_SPEED[bot.role] ?? 3.8) * speedScale;
    const moved = slideMove(
      world.colliders, bot.position.x, bot.position.z, RADIUS,
      bot.position.y, bot.position.y + BODY_HEIGHT,
      (dx / distance) * speed * dt, (dz / distance) * speed * dt,
    );
    bot.position.x = moved.x;
    bot.position.z = moved.z;
    bot.position.y = floorAt(world.colliders, bot.position.x, bot.position.z, bot.position.y);
    return false;
  }

  function setDestination(bot, nodeKey) {
    const from = nearestNode(world.nav, bot.position);
    bot.path = pathBetween(world.nav, from, nodeKey);
    bot.destination = nodeKey;
    if (bot.path.length === 0) bot.path = [nodeKey];
    bot.pathIndex = 0;
  }

  function followPath(bot, dt) {
    if (!bot.destination) return true;
    const nodeKey = bot.path[bot.pathIndex];
    if (!nodeKey) return true;
    const [x, z] = world.nav.nodes[nodeKey];
    const reached = walkTo(bot, { x, z }, dt);
    if (reached) {
      bot.pathIndex += 1;
      if (bot.pathIndex >= bot.path.length) {
        bot.destination = null;
        return true;
      }
    }
    return false;
  }

  // Shooting at a body: the bot turns, waits out its reaction time, then fires with spread that
  // depends on skill and on whether it is moving. A new player is not instantly headshot from
  // across the map, and a bot standing still is the dangerous one.
  function shootAt(bot, target, now, ctx) {
    eyeOf(bot, eye);
    if (now < bot.nextShotAt || now < bot.reloadUntil) return;
    if (bot.ammo <= 0) {
      bot.reloadUntil = now + bot.weapon.reloadTime;
      bot.ammo = bot.weapon.magazine;
      audio.play('reload', { position: bot.position });
      return;
    }
    bot.ammo -= 1;
    // fire in bursts: a bot that holds the trigger forever is not a fight, it is a laser
    if (bot.ammo % 5 === 0) bot.nextShotAt = now + 0.34 + Math.random() * 0.3;
    else bot.nextShotAt = now + 60 / bot.weapon.rateOfFire;

    const spread = bot.weapon.spreadBase + (1 - bot.skill) * 0.075 + (bot.state === 'advance' ? 0.03 : 0);
    toTarget.copy(target.position).setY(target.position.y + 1.2).sub(eye).normalize();
    const direction = toTarget.clone();
    direction.x += (Math.random() - 0.5) * spread * 2;
    direction.y += (Math.random() - 0.5) * spread * 2;
    direction.z += (Math.random() - 0.5) * spread * 2;
    direction.normalize();

    const wallDistance = nearestWall(world.colliders, eye, direction, bot.weapon.range);
    const hit = traceTarget(eye, direction, bot.weapon.range, ctx.targets(bot.team));
    if (hit.target && hit.distance < wallDistance) {
      const damage = bot.weapon.damage * (hit.headshot ? 1.5 : 1) * 0.45;
      hit.target.takeDamage(damage, bot, hit.headshot);
    }
    ctx.fx.tracer(eye.clone(), eye.clone().addScaledVector(direction, Math.min(wallDistance, 60)), true);
    audio.play('shot', { position: bot.position, enemy: bot.team !== 'ct' });
    ctx.onGunshot(bot);
  }

  function pickTarget(bot, ctx) {
    let best = null;
    let bestDistance = Infinity;
    for (const other of ctx.enemiesOf(bot.team)) {
      if (!other.alive) continue;
      const distance = bot.position.distanceTo(other.position);
      if (distance > 46) continue;
      if (!canSee(bot, other.position)) continue;
      if (distance < bestDistance) { bestDistance = distance; best = other; }
    }
    return best;
  }

  function update(bot, dt, now, ctx) {
    if (!bot.alive) return;
    bot.hitFlash = Math.max(0, bot.hitFlash - dt * 3);

    const enemy = pickTarget(bot, ctx);
    if (enemy) {
      bot.lastSeen.copy(enemy.position);
      bot.lastSeenAt = now;
      bot.memoryUntil = now + 4;
      bot.state = 'engage';
    } else if (bot.state === 'engage' && now > bot.memoryUntil) {
      bot.state = bot.destination ? 'advance' : 'hold';
    }

    if (bot.state === 'engage' && enemy) {
      const aimError = lookAt(bot, enemy.position, dt, 6 + bot.skill * 4);
      if (bot.reactionUntil === 0) bot.reactionUntil = now + (0.62 - bot.skill * 0.2);
      const stationary = Math.hypot(bot.velocity.x, bot.velocity.z) < 2.2;
      if (now > bot.reactionUntil && aimError < 0.22 && stationary) shootAt(bot, enemy, now, ctx);

      // strafe across the enemy's aim so a bot is not a sitting duck, then settle to shoot
      if (now > bot.strafeUntil) {
        bot.strafeSign *= -1;
        bot.strafeUntil = now + 0.55 + Math.random() * 0.5;
      }
      const strafeX = Math.cos(bot.yaw) * bot.strafeSign * 2.4 * dt;
      const strafeZ = -Math.sin(bot.yaw) * bot.strafeSign * 2.4 * dt;
      const moved = slideMove(
        world.colliders, bot.position.x, bot.position.z, RADIUS,
        bot.position.y, bot.position.y + BODY_HEIGHT, strafeX, strafeZ,
      );
      bot.position.x = moved.x;
      bot.position.z = moved.z;
      bot.position.y = floorAt(world.colliders, bot.position.x, bot.position.z, bot.position.y);
      return;
    }

    bot.reactionUntil = 0;

    if (bot.state === 'plant' && bot.hasBomb) {
      const site = ctx.currentSite();
      if (!site) return;
      const distance = bot.position.distanceTo(site.center);
      lookAt(bot, site.center, dt, 4);
      if (distance > site.radius * 0.4) {
        // still outside the site: walk in, and start the countdown only once in position
        walkTo(bot, site.center, dt, 1);
        bot.plantProgress = 0;
        return;
      }
      bot.plantProgress += dt;
      if (bot.plantProgress > 3.2) ctx.onPlanted(bot);
      return;
    }

    // counter-terrorists answer a planted bomb: a defuser walks in and works on it while the
    // others keep watching the doors, which is what makes the objective a fight and not a timer
    if (bot.team === 'ct' && ctx.bombPlanted()) {
      if (bot.state !== 'defuse') {
        bot.state = 'defuse';
        bot.destination = null;
        bot.path = [];
        bot.pathIndex = 0;
      }
    }

    if (bot.state === 'defuse') {
      const site = ctx.plantedSite();
      if (!site) return;
      const distance = bot.position.distanceTo(site.center);
      if (distance > 1.7) {
        // far away: path to the site. Inside it: walk straight at the bomb, where the floor is
        // open, instead of re-pathing to a node that is already behind the bot.
        if (distance < 7) {
          walkTo(bot, site.center, dt, 1);
        } else {
          if (!bot.destination) setDestination(bot, ctx.plantedSiteNode());
          followPath(bot, dt);
        }
        lookAt(bot, site.center, dt, 5);
        bot.defuseProgress = 0;
        return;
      }
      bot.destination = null;
      lookAt(bot, { x: site.center.x, z: site.center.z }, dt, 4);
      bot.defuseProgress += dt;
      if (bot.defuseProgress > 6) ctx.onDefused(bot);
      return;
    }

    if (bot.state === 'hold') {
      // a post watches the door it was set on and shuffles a step now and then: for a
      // counter-terrorist that is a site entrance, for a terrorist that has planted, the site
      const watch = ctx.holdPointFor(bot);
      if (watch) lookAt(bot, watch, dt, 2.4);
      if (bot.position.distanceTo(ctx.holdPostFor(bot)) > 1.6) {
        followPath(bot, dt);
      }
      if (ctx.shouldPush(bot)) {
        bot.state = 'advance';
        bot.plantProgress = 0;
      }
      return;
    }

    // advance: walk the path, and re-aim at the next node so movement looks deliberate
    if (!bot.destination && bot.state !== 'plant') {
      const goal = ctx.nextGoalFor(bot);
      if (goal) {
        setDestination(bot, goal);
        bot.state = bot.hasBomb ? 'plant' : 'advance';
      }
    }
    const reached = followPath(bot, dt);
    if (bot.destination) {
      const nextKey = bot.path[bot.pathIndex];
      if (nextKey) {
        const [x, z] = world.nav.nodes[nextKey];
        lookAt(bot, { x, z }, dt, 3.2);
      }
    } else if (reached && bot.hasBomb) {
      bot.state = 'plant';
    }
  }

  function syncMeshes(now) {
    for (const bot of bots) {
      if (!bot.alive) {
        bot.mesh.rotation.z = -Math.PI / 2.15;
        bot.mesh.position.set(bot.position.x, bot.position.y + 0.35, bot.position.z);
        continue;
      }
      bot.mesh.position.copy(bot.position);
      bot.mesh.rotation.y = bot.yaw;
      const accent = bot.mesh.userData.accent;
      accent.emissiveIntensity = bot.hitFlash > 0.01 ? 0.85 + bot.hitFlash * 1.8 : 0.85;
    }
  }

  return {
    bots,
    spawnBot,
    // set a bot walking to a named post through the graph, never in a straight line into a wall
    assignPost(bot, nodeKey) {
      setDestination(bot, nodeKey);
      bot.state = 'advance';
    },
    reset,
    update,
    syncMeshes,
    canSee,
    eyeOf,
    takeDamage(bot, amount, attacker) {
      if (!bot.alive) return;
      bot.health -= amount;
      bot.hitFlash = 1;
      if (bot.health <= 0) {
        bot.alive = false;
        bot.state = 'hold';
        bot.destination = null;
        options.onDeath?.(bot, attacker);
      }
    },
  };
}