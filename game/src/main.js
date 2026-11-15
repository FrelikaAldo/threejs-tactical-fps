// Boot, and the two clocks: a fixed 60 Hz simulation and a render at the display's rate. All
// game state lives here, wired once; the modules below never reach for each other. A shot mode
// (?shot=cover|play|buy|end&seed=N) stages a deterministic frame for the screenshots.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createWorld } from './world.js';
import { createInput } from './input.js';
import { createPlayer } from './player.js';
import { createArsenal } from './weapons.js';
import { createBots } from './bots.js';
import { createRounds, PHASE } from './rounds.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createFx } from './fx.js';
import { createViewmodel } from './viewmodel.js';

const FIXED_STEP = 1 / 60;
const params = new URLSearchParams(window.location.search);
const shotMode = params.get('shot');
const seed = Number.parseInt(params.get('seed') ?? '1', 10) || 1;

function mulberry32(initial) {
  let a = initial;
  return function random() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// One seed for the whole game, so a staged shot and a played round draw the same numbers.
mulberry32(seed);

// ---------------------------------------------------------------- renderer, scene, camera
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
document.getElementById('game').appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(PALETTE.canvas);
scene.fog = new THREE.Fog(new THREE.Color(PALETTE.fog), 34, 96);
const camera = new THREE.PerspectiveCamera(78, window.innerWidth / window.innerHeight, 0.05, 180);
scene.add(camera);

const world = createWorld(scene);
const audio = createAudio();
const fx = createFx(scene);
const hud = createHud();
const player = createPlayer(world);
const viewmodel = createViewmodel(camera);
const eyePoint = new THREE.Vector3();
const eyeDirection = new THREE.Vector3();
const input = createInput(renderer.domElement, (locked) => {
  if (locked) hideOverlay();
  else if (rounds.match.phase !== PHASE.MATCH_END) showOverlay('Paused', 'Click to go back in.');
});

// The player as something the bots can shoot: one small adapter keeps the health rules in the
// round instead of inside the bot code.
const playerTarget = {
  team: 'ct',
  isPlayer: true,
  get position() { return player.state.position; },
  get alive() { return player.state.alive; },
  takeDamage(amount, attacker, headshot) {
    if (!player.state.alive) return;
    let incoming = amount;
    if (player.state.armor > 0) {
      const absorbed = Math.min(player.state.armor, incoming * 0.5);
      player.state.armor -= absorbed;
      incoming -= absorbed;
    }
    player.state.health = Math.max(0, player.state.health - incoming);
    hud.damage(incoming);
    audio.play('hurt');
    if (player.state.health <= 0) {
      player.state.alive = false;
      rounds.match.deaths += 1;
      hud.killFeed(attacker?.id === undefined ? 'Hostile' : `Hostile ${attacker.id}`, 'You', headshot);
      hud.banner('You are down — the round plays on', 3);
    }
  },
};

const bots = createBots(world, {
  scene,
  audio,
  onDeath(bot, attacker) {
    const byPlayer = attacker === playerTarget || attacker === player;
    if (byPlayer) {
      rounds.match.kills += 1;
      rounds.moneyForKill(rounds.REWARD.kill);
      hud.killFeed('You', bot.team === 't' ? `Hostile ${bot.id}` : `Agent ${bot.id}`, false);
    } else {
      hud.killFeed('Hostile', `Agent ${bot.id}`, false);
    }
  },
});

const arsenal = createArsenal({
  camera,
  world,
  audio,
  fx,
  targets: () => bots.bots.filter((bot) => bot.team === 't' && bot.alive),
  onDamageDealt(target, damage, headshot) {
    hud.hitmarker(headshot);
    audio.play(headshot ? 'headshot' : 'hit');
  },
});

const roundContext = {
  fx,
  targets: (team) => (team === 'ct'
    ? bots.bots.filter((bot) => bot.team === 't')
    : [...bots.bots.filter((bot) => bot.team === 'ct'), playerTarget]),
  enemiesOf: (team) => (team === 'ct'
    ? bots.bots.filter((bot) => bot.team === 't')
    : [...bots.bots.filter((bot) => bot.team === 'ct'), playerTarget]),
  onGunshot: (source) => rounds.onGunshot(source),
  currentSite: () => rounds.currentSite(),
  plantedSite: () => rounds.plantedSite(),
  onPlanted: (bot) => rounds.onPlanted(bot),
  bombPlanted: () => rounds.match.bomb.planted,
  plantedSiteNode: () => (rounds.match.attackSite === 'A' ? 'siteACrucible' : 'siteBLoad'),
  onDefused: () => rounds.onDefused(),
  holdPointFor: (bot) => rounds.holdPointFor(bot),
  holdPostFor: (bot) => rounds.holdPostFor(bot),
  nextGoalFor: (bot) => rounds.nextGoalFor(bot),
  shouldPush: (bot) => rounds.shouldPush(bot),
};

const rounds = createRounds(world, { player, bots, hud, audio });

// ---------------------------------------------------------------- overlay, buy, helpers
const overlay = document.getElementById('overlay');
const overlayTitle = document.getElementById('overlay-title');
const overlayCopy = document.getElementById('overlay-copy');
const playButton = document.getElementById('play');

function showOverlay(title, copy) {
  overlayTitle.textContent = title;
  overlayCopy.textContent = copy;
  overlay.hidden = false;
}
function hideOverlay() {
  overlay.hidden = true;
}

function tryBuy(itemId) {
  const item = hud.buyItems.find((entry) => entry.id === itemId);
  if (!item) return;
  if (!rounds.match.buyOpen) {
    hud.banner('Buy time is over', 1.4);
    return;
  }
  if (item.cost > rounds.match.money) {
    hud.banner('Not enough money', 1.4);
    return;
  }
  if (itemId === 'armor') {
    if (player.state.armor >= 100) return;
    if (!rounds.buy(item).ok) return;
    player.state.armor = 100;
    hud.banner('Kevlar', 1.2);
    return;
  }
  if (itemId === 'frag') {
    if (arsenal.state.grenades >= 2) return;
    if (!rounds.buy(item).ok) return;
    arsenal.giveGrenade(1);
    hud.banner('Frag grenade', 1.2);
    return;
  }
  if (itemId === 'defuser') {
    if (player.state.defuser) return;
    if (!rounds.buy(item).ok) return;
    player.state.defuser = true;
    hud.banner('Defuse kit', 1.2);
    return;
  }
  if (!rounds.buy(item).ok) return;
  arsenal.give(itemId);
  hud.banner(item.name, 1.2);
}

const BUY_KEYS = { Digit1: 'vk74', Digit2: 'wasp', Digit3: 'kestrel', Digit4: 'armor', Digit5: 'frag', Digit6: 'defuser' };

// The buy menu takes the number keys while it is open; the round's own slot keys are ignored
// then, so pressing 1 in the menu buys a rifle instead of switching to one.
window.addEventListener('keydown', (event) => {
  if (!hud.isBuyOpen()) return;
  const itemId = BUY_KEYS[event.code];
  if (!itemId) return;
  event.preventDefault();
  tryBuy(itemId);
});

playButton.addEventListener('click', () => {
  audio.play('freeze');
  hideOverlay();
  input.requestLock();
});

document.addEventListener('click', () => {
  if (!input.isLocked() && shotMode === null) input.requestLock();
});

// ---------------------------------------------------------------- the loop
let accumulator = 0;
let previous = performance.now();
let stepCount = 0;
let frameCount = 0;

function simulate(dt) {
  const look = input.drainLook();
  if (look.x !== 0 || look.y !== 0) player.applyLook(look.x, look.y);

  const match = rounds.match;
  match.buyOpen = match.phase === PHASE.FREEZE;

  if (match.phase === PHASE.FREEZE || match.phase === PHASE.LIVE) {
    // weapon switches and grenades are handled even during freeze, like a buy menu would
    if (input.take('slot1')) arsenal.select('primary');
    if (input.take('slot2')) arsenal.select('secondary');
    if (input.take('slot3')) arsenal.select('melee');
    if (input.take('reload')) arsenal.beginReload(rounds.clock());
    if (input.take('grenade')) arsenal.throwGrenade(rounds.clock(), player);
  }

  const canAct = match.phase === PHASE.LIVE && player.state.alive;
  player.step(dt, input, canAct);

  if (canAct) {
    // the camera is placed from the body before the trigger is read, so a shot leaves exactly
    // where the player is looking this step, not where the last rendered frame looked
    player.applyCamera(camera);
    const firing = input.isFiring();
    const weapon = arsenal.currentWeapon();
    if (firing && (weapon.auto || !arsenal.state.triggerHeld)) {
      arsenal.state.triggerHeld = true;
      const shot = arsenal.fire(rounds.clock(), player, roundContext.targets('ct'),
        player.isMoving(), !player.state.grounded);
      if (shot) {
        player.eyePosition(eyePoint);
        camera.getWorldDirection(eyeDirection);
        fx.muzzle(eyePoint, eyeDirection);
        viewmodel.fire();
      }
    }
    if (!firing) arsenal.state.triggerHeld = false;
    rounds.updatePlayerDefuse(dt, input.down('use'));
  }

  rounds.step(dt);
  arsenal.step(dt, rounds.clock());

  // freeze time means everyone stands still: the round clock alone decides when bots may act
  const now = rounds.clock();
  if (match.phase === PHASE.LIVE) {
    for (const bot of bots.bots) {
      if (bot.alive) bots.update(bot, dt, now, roundContext);
    }
  }

  viewmodel.select(arsenal.currentWeapon().id);
  viewmodel.update(dt, {
    speed: player.speed(),
    reloading: arsenal.reloading(rounds.clock()),
    grounded: player.state.grounded,
  });

  hud.update({ match, player, arsenal });
  hud.setSpectating(!player.state.alive && match.phase !== PHASE.MATCH_END);
  const site = rounds.match.bomb.planted ? rounds.match.bomb.site : null;
  hud.siteHint(site && player.state.alive
    ? `Defuse the bomb — hold E (${Math.max(0, Math.ceil(7 - rounds.match.bomb.defuseProgress))}s)`
    : null);
  if (input.down('scores')) hud.updateScoreboard(bots, player);
  hud.toggleScoreboard(input.down('scores') && match.phase !== PHASE.MATCH_END);
  stepCount += 1;
}

function frame(now) {
  requestAnimationFrame(frame);
  const delta = Math.min(0.25, (now - previous) / 1000);
  previous = now;

  if (shotMode === null) {
    accumulator += delta;
    while (accumulator >= FIXED_STEP) {
      simulate(FIXED_STEP);
      accumulator -= FIXED_STEP;
    }
  }

  fx.update(delta);
  player.applyCamera(camera);
  const kick = arsenal.viewKick();
  camera.rotateX(kick.x);
  camera.rotateY(kick.y);
  bots.syncMeshes(now / 1000);
  audio.setListener(player.state.position, player.state.yaw);
  renderer.render(scene, camera);
  frameCount += 1;
  if (shotMode !== null && frameCount >= 3) window.__shotReady = true;
}

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------- shot staging
// Each shot is the game's own code running: the same map, the same bots, the same HUD. Only the
// clock is paused so the frame is exactly the one we chose to show.
function stageShot(kind) {
  rounds.reset();
  rounds.match.round = 4;
  rounds.match.score.ct = 3;
  rounds.match.score.t = 2;
  rounds.match.money = 4250;
  rounds.match.phase = PHASE.LIVE;
  rounds.match.timer = 74;
  player.state.armor = 100;
  player.state.health = kind === 'play' ? 58 : 92;

  const place = (bot, x, z, yawDeg) => {
    bot.position.set(x, 0, z);
    bot.yaw = (yawDeg * Math.PI) / 180;
    bot.mesh.position.copy(bot.position);
    bot.mesh.rotation.y = bot.yaw;
  };

  if (kind === 'cover') {
    player.state.position.set(0.4, 0, 15.0);
    player.state.yaw = 0.02;
    player.state.pitch = -0.015;
    place(bots.bots[0], 2.2, 1.5, 176);
    place(bots.bots[1], -2.9, -5.4, 158);
    place(bots.bots[2], -7.8, -10.6, 168);
    place(bots.bots[4], -2.4, 8.4, 4);
    arsenal.give('vk74');
    arsenal.state.ammo.vk74 = { mag: 26, reserve: 90 };
    arsenal.giveGrenade(1);
    hud.banner('ROUND 4 — MID, CONTESTED', 99);
  } else if (kind === 'play') {
    player.state.position.set(-6.4, 0, 2.6);
    player.state.yaw = 0.32;
    player.state.pitch = 0.015;
    place(bots.bots[0], -10.6, -5.2, 150);
    place(bots.bots[2], -13.4, -8.8, 140);
    place(bots.bots[3], -17.2, -13.0, 128);
    place(bots.bots[5], -4.2, -2.0, 210);
    arsenal.give('vk74');
    arsenal.state.ammo.vk74 = { mag: 14, reserve: 60 };
    arsenal.giveGrenade(1);
    const eye = new THREE.Vector3();
    player.eyePosition(eye);
    const target = new THREE.Vector3(-10.6, 1.16, -5.2);
    fx.tracer(eye, target);
    fx.impact(target, 'blood');
    fx.muzzle(eye, target.clone().sub(eye).normalize());
    viewmodel.fire();
    hud.killFeed('You', 'Hostile t-1', true);
    hud.killFeed('Hostile', 'Agent ct-1', false);
    hud.banner('SITE A — ONE DOWN', 99);
    hud.damage(34);
  } else if (kind === 'buy') {
    player.state.position.set(-1.2, 0, 22.6);
    player.state.yaw = 0.03;
    player.state.pitch = -0.02;
    place(bots.bots[4], -3.6, 19.4, 12);
    place(bots.bots[5], 2.4, 20.2, 350);
    rounds.match.phase = PHASE.FREEZE;
    rounds.match.timer = 9;
    rounds.match.buyOpen = true;
    hud.setBuyOpen(true);
    rounds.match.money = 6100;
    hud.banner('BUY TIME — 9s', 99);
  } else if (kind === 'end') {
    rounds.match.score.ct = 8;
    rounds.match.score.t = 6;
    rounds.match.phase = PHASE.MATCH_END;
    rounds.match.timer = 0;
    player.state.position.set(-3.0, 0, 18.0);
    player.state.yaw = 0.10;
    hud.banner('COUNTER-TERRORISTS WIN THE MATCH', 99);
    hud.showMatchEnd(true, '8 — 6');
  }

  viewmodel.select(arsenal.currentWeapon().id);
  viewmodel.update(0.016, { speed: 0, reloading: false, grounded: true });
  hud.update({ match: rounds.match, player, arsenal });
  stepCount = 0;
}

if (shotMode) {
  hideOverlay();
  stageShot(shotMode);
  document.getElementById('buy-menu').hidden = shotMode !== 'buy';
  document.getElementById('defuse-bar').hidden = true;
} else {
  rounds.reset();
  showOverlay('FOUNDRY', 'A round-based tactical shooter: two teams, one bomb, a buy menu and seven bots that hold angles. Click to play.');
}

requestAnimationFrame(frame);

// A small handle for the harness and for a person poking at the console: read-only state, no
// way to change the rules from outside.
window.__foundry = { match: rounds.match, player, arsenal, bots, rounds };
