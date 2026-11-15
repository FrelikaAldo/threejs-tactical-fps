// The round: freeze time, live time, the bomb, the money, and the score. One state machine for
// the whole match, so the HUD, the bots and the shooter all read the same four values and no
// part of the game invents its own idea of what is happening.
import * as THREE from 'three';

export const PHASE = { FREEZE: 'freeze', LIVE: 'live', ROUND_END: 'roundEnd', MATCH_END: 'matchEnd' };

const FREEZE_TIME = 12;
const ROUND_TIME = 105;
const ROUND_END_TIME = 4.5;
const BOMB_TIME = 40;
const DEFUSE_TIME = 7;
const PLANT_TIME = 3.2;

const REWARD = { win: 3250, loss: 1900, plant: 300, defuse: 300, kill: 300, cap: 16000, start: 800 };

export function createRounds(world, options) {
  const { player, bots, hud, audio } = options;

  const match = {
    phase: PHASE.FREEZE,
    round: 0,
    score: { ct: 0, t: 0 },
    timer: FREEZE_TIME,
    money: REWARD.start,
    kills: 0,
    deaths: 0,
    targetScore: 8,
    buyOpen: false,
    message: '',
    messageUntil: 0,
    bomb: {
      carried: false,
      planted: false,
      site: null,
      timer: 0,
      defuseProgress: 0,
      defusing: false,
      exploded: false,
    },
    attackSite: 'A',
    lastResult: '',
  };

  const tmp = new THREE.Vector3();
  const ctPosts = ['siteADoor', 'siteBDoor', 'midJunction', 'connectorMidLong', 'connectorMidTunnel'];
  const botRoles = [];

  function message(text, seconds = 3) {
    match.message = text;
    match.messageUntil = matchClock + seconds;
  }

  let matchClock = 0;

  function moneyForKill(amount) {
    match.money = Math.min(REWARD.cap, match.money + amount);
  }

  function aliveCount(team) {
    if (team === 'ct') {
      return bots.bots.filter((bot) => bot.team === 'ct' && bot.alive).length + (player.state.alive ? 1 : 0);
    }
    return bots.bots.filter((bot) => bot.team === 't' && bot.alive).length;
  }

  // Bots on both sides ask the round what to do next, so site choice, push timing and holding
  // posts are decided once, for the whole team, instead of by each bot in isolation.
  function nextGoalFor(bot) {
    if (bot.team === 'ct' && match.bomb.planted && match.bomb.site) {
      return match.attackSite === 'A' ? 'siteACrucible' : 'siteBLoad';
    }
    if (bot.team === 't') {
      const site = world.sites[match.attackSite];
      if (bot.hasBomb) return match.attackSite === 'A' ? 'siteACrucible' : 'siteBLoad';
      if (bot.role === 'rusher') return match.attackSite === 'A' ? 'siteACrate' : 'siteBContainer';
      if (bot.role === 'bomber') return match.attackSite === 'A' ? 'siteACrate' : 'siteBContainer';
      return match.attackSite === 'A' ? 'longNorth' : 'tunnelNorth';
    }
    const post = ctPosts[(bot.slot ?? 0) % ctPosts.length];
    return post;
  }

  function holdPostFor(bot) {
    const [x, z] = world.nav.nodes[ctPosts[(bot.slot ?? 0) % ctPosts.length]] ?? [0, 0];
    return tmp.set(x, 0, z);
  }

  function holdPointFor(bot) {
    if (bot.team === 't' && match.bomb.site) {
      return { x: bot.position.x, y: 1.4, z: bot.position.z - 6 };
    }
    // look at the door the post covers: the two sites' entrances and mid
    const look = {
      siteADoor: 'siteACrate', siteBDoor: 'siteBLoad', midJunction: 'midNorth',
      connectorMidLong: 'midSilo', connectorMidTunnel: 'tunnelMid',
    }[(bot.slot ?? 0) % ctPosts.length] ?? 'midJunction';
    const [x, z] = world.nav.nodes[look] ?? [0, 0];
    return { x, y: 1.4, z };
  }

  function shouldPush(bot) {
    if (bot.team !== 'ct') return false;
    if (match.bomb.planted) return true;
    // rotate when the other site is quiet and the contact is late in the round
    return match.timer < 55 && Math.random() < 0.0015;
  }

  function currentSite() {
    return world.sites[match.attackSite] ?? null;
  }

  function plantedSite() {
    return match.bomb.site ?? null;
  }

  function onPlanted(bot) {
    if (match.bomb.planted || match.phase !== PHASE.LIVE) return;
    match.bomb.planted = true;
    match.bomb.carried = false;
    match.bomb.site = world.sites[match.attackSite];
    match.bomb.timer = BOMB_TIME;
    bot.hasBomb = false;
    bot.state = 'hold';
    bot.destination = null;
    message(`The bomb has been planted at ${match.bomb.site.name}`);
    audio.play('planted');
    moneyForKill(0);
  }

  function onDefused() {
    if (!match.bomb.planted || match.phase !== PHASE.LIVE) return;
    match.bomb.defused = true;
    endRound('ct', 'The bomb has been defused');
  }

  function onGunshot(source) {
    // gunfire is heard by the other team within 26 metres: bots turn toward it and remember it
    for (const bot of bots.bots) {
      if (!bot.alive || bot.team === source.team) continue;
      if (bot.position.distanceTo(source.position) > 26) continue;
      bot.lastSeen.copy(source.position);
      bot.memoryUntil = matchClock + 2.5;
      if (bot.state === 'hold') {
        bot.state = 'advance';
        bot.destination = null;
      }
    }
  }

  function spawnTeams() {
    const ctSpawns = world.spawns.ct;
    const tSpawns = world.spawns.t;
    player.spawnAt(ctSpawns[0], Math.PI);

    const plan = [
      ['t', 'bomber', 0], ['t', 'rusher', 1], ['t', 'rotator', 2], ['t', 'anchor', 3],
      ['ct', 'anchor', 0], ['ct', 'rotator', 1], ['ct', 'anchor', 2],
    ];
    plan.forEach(([team, role, index], order) => {
      const spawn = (team === 'ct' ? ctSpawns : tSpawns)[index % 5];
      const bot = bots.spawnBot(team, role, spawn, order);
      bot.slot = order;
      bot.hasBomb = role === 'bomber';
      bot.state = team === 'ct' ? 'hold' : 'advance';
      if (team === 'ct') bots.assignPost(bot, ctPosts[order % ctPosts.length]);
    });
  }

  function startRound() {
    match.round += 1;
    match.attackSite = Math.random() < 0.5 ? 'A' : 'B';
    match.bomb.carried = true;
    match.bomb.planted = false;
    match.bomb.defused = false;
    match.bomb.exploded = false;
    match.bomb.site = null;
    match.bomb.timer = 0;
    match.bomb.defuseProgress = 0;
    match.bomb.defusing = false;
    bots.reset();
    spawnTeams();
    match.phase = PHASE.FREEZE;
    match.timer = FREEZE_TIME;
    match.buyOpen = true;
    player.state.armor = player.state.armor > 0 ? 100 : 0;
    message(`Round ${match.round}: buy now`);
    audio.play('freeze');
  }

  function endRound(winner, reason) {
    if (match.phase !== PHASE.LIVE) return;
    match.phase = PHASE.ROUND_END;
    match.timer = ROUND_END_TIME;
    match.buyOpen = false;
    match.score[winner] += 1;
    match.lastResult = winner === 'ct' ? 'win' : 'loss';
    const reward = winner === 'ct' ? REWARD.win : REWARD.loss;
    moneyForKill(reward);
    message(winner === 'ct' ? `Counter-Terrorists win — ${reason}` : `Terrorists win — ${reason}`, 4);
    audio.play(winner === 'ct' ? 'win' : 'lose');
    if (match.score.ct >= match.targetScore || match.score.t >= match.targetScore) {
      match.phase = PHASE.MATCH_END;
      hud.showMatchEnd(match.score.ct > match.score.t, `${match.score.ct} — ${match.score.t}`);
    }
  }

  // One fixed step of the round clock: the timers, the bomb, and the conditions that end it.
  function step(dt) {
    matchClock += dt;
    if (match.phase === PHASE.FREEZE) {
      match.timer -= dt;
      if (match.timer <= 0) {
        match.phase = PHASE.LIVE;
        match.timer = ROUND_TIME;
        match.buyOpen = false;
        message('Go go go');
        audio.play('live');
      }
      return;
    }
    if (match.phase === PHASE.ROUND_END) {
      match.timer -= dt;
      if (match.timer <= 0 && match.phase === PHASE.ROUND_END) startRound();
      return;
    }
    if (match.phase !== PHASE.LIVE) return;

    if (match.bomb.planted) {
      match.bomb.timer -= dt;
      if (match.bomb.timer <= 0) {
        match.bomb.exploded = true;
        audio.play('explosion');
        endRound('t', 'the bomb exploded');
        return;
      }
      if (match.bomb.timer < 12 && Math.floor(match.bomb.timer) !== Math.floor(match.bomb.timer + dt)) {
        audio.play('beep');
      }
    } else {
      match.timer -= dt;
      if (match.timer <= 0) {
        endRound('ct', 'time ran out');
        return;
      }
    }

    const tAlive = aliveCount('t');
    const ctAlive = aliveCount('ct');
    if (tAlive === 0) {
      endRound('ct', 'the enemy team is eliminated');
      return;
    }
    if (ctAlive === 0) {
      endRound('t', 'the counter-terrorists are eliminated');
      return;
    }
    if (!player.state.alive) {
      // the player is out for the round: the round still plays out through the bots
      hud.setSpectating(true);
    }
  }

  // The player's own defuse: hold the use key inside the site while the bomb ticks down.
  function updatePlayerDefuse(dt, holdingUse) {
    if (!match.bomb.planted || !player.state.alive) return;
    const site = match.bomb.site;
    const inside = player.state.position.distanceTo(site.center) < site.radius + 1.2;
    if (holdingUse && inside) {
      match.bomb.defusing = true;
      match.bomb.defuseProgress += dt;
      if (match.bomb.defuseProgress >= DEFUSE_TIME) onDefused();
    } else {
      match.bomb.defusing = false;
      match.bomb.defuseProgress = Math.max(0, match.bomb.defuseProgress - dt * 1.6);
    }
  }

  function buy(item) {
    if (!match.buyOpen) return { ok: false, reason: 'buy time is over' };
    if (item.cost > match.money) return { ok: false, reason: 'not enough money' };
    match.money -= item.cost;
    return { ok: true };
  }

  function reset() {
    match.round = 0;
    match.score.ct = 0;
    match.score.t = 0;
    match.money = REWARD.start;
    match.kills = 0;
    match.deaths = 0;
    match.phase = PHASE.FREEZE;
    matchClock = 0;
    startRound();
  }

  return {
    match,
    PHASE,
    BOMB_TIME,
    DEFUSE_TIME,
    PLANT_TIME,
    REWARD,
    startRound,
    step,
    updatePlayerDefuse,
    buy,
    moneyForKill,
    reset,
    aliveCount,
    nextGoalFor,
    holdPostFor,
    holdPointFor,
    shouldPush,
    currentSite,
    plantedSite,
    onPlanted,
    onDefused,
    onGunshot,
    endRound,
    message,
    clock: () => matchClock,
  };
}