// The HUD: everything the player reads while playing, drawn as DOM over the canvas so text
// stays crisp and no frame builds a texture. This module only writes to elements it is given;
// the game state it shows comes in through update() and the small event calls.
const BUY_ITEMS = [
  { id: 'vk74', key: '1', name: 'VK-74', cost: 2700, note: 'rifle' },
  { id: 'wasp', key: '2', name: 'Wasp SMG', cost: 1250, note: 'smg' },
  { id: 'kestrel', key: '3', name: 'Kestrel .45', cost: 500, note: 'pistol' },
  { id: 'armor', key: '4', name: 'Kevlar', cost: 650, note: 'armor' },
  { id: 'frag', key: '5', name: 'Frag', cost: 300, note: 'grenade' },
  { id: 'defuser', key: '6', name: 'Defuse kit', cost: 400, note: 'kit' },
];

export function createHud() {
  const el = (id) => document.getElementById(id);
  const nodes = {
    scoreCt: el('score-ct'),
    scoreT: el('score-t'),
    round: el('round-number'),
    timer: el('round-timer'),
    health: el('health-value'),
    armor: el('armor-value'),
    money: el('money-value'),
    ammoMag: el('ammo-mag'),
    ammoReserve: el('ammo-reserve'),
    weaponName: el('weapon-name'),
    grenades: el('grenade-count'),
    crosshair: el('crosshair'),
    hitmarker: el('hitmarker'),
    banner: el('banner'),
    feed: el('kill-feed'),
    bomb: el('bomb-status'),
    bombTimer: el('bomb-timer'),
    buy: el('buy-menu'),
    buyList: el('buy-list'),
    buyMoney: el('buy-money'),
    vignette: el('damage-vignette'),
    siteHint: el('site-hint'),
    spectating: el('spectating'),
    matchEnd: el('match-end'),
    matchEndTitle: el('match-end-title'),
    matchEndScore: el('match-end-score'),
    scores: el('scoreboard'),
    scoresBody: el('scoreboard-body'),
    defuse: el('defuse-bar'),
    defuseFill: el('defuse-fill'),
  };

  let buyOpen = false;
  let bannerTimer = 0;

  for (const item of BUY_ITEMS) {
    const row = document.createElement('li');
    row.className = 'buy-row';
    row.dataset.item = item.id;
    row.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span>`
      + `<span class="buy-note">${item.note}</span><span class="buy-cost">$${item.cost}</span>`;
    nodes.buyList.appendChild(row);
  }

  function formatTime(seconds) {
    const clamped = Math.max(0, Math.ceil(seconds));
    const minutes = Math.floor(clamped / 60);
    const rest = clamped % 60;
    return `${minutes}:${rest.toString().padStart(2, '0')}`;
  }

  function update({ match, player, arsenal }) {
    nodes.scoreCt.textContent = String(match.score.ct);
    nodes.scoreT.textContent = String(match.score.t);
    nodes.round.textContent = `ROUND ${Math.max(1, match.round)}`;
    nodes.timer.textContent = match.bomb.planted ? formatTime(match.bomb.timer) : formatTime(match.timer);
    nodes.timer.classList.toggle('urgent', (match.bomb.planted ? match.bomb.timer : match.timer) < 20);

    nodes.health.textContent = String(Math.max(0, Math.round(player.state.health)));
    nodes.armor.textContent = String(Math.max(0, Math.round(player.state.armor)));
    nodes.money.textContent = `$${match.money}`;

    const weapon = arsenal.currentWeapon();
    const ammo = arsenal.ammoFor(weapon);
    nodes.weaponName.textContent = weapon.name;
    nodes.ammoMag.textContent = weapon.magazine === Infinity ? '—' : String(ammo.mag);
    nodes.ammoReserve.textContent = weapon.magazine === Infinity ? '' : `/ ${ammo.reserve}`;
    nodes.ammoMag.classList.toggle('low', ammo.mag <= Math.max(1, Math.ceil(weapon.magazine * 0.2)));
    nodes.grenades.textContent = String(arsenal.state.grenades);

    const spread = arsenal.spreadRadius();
    const gap = 4 + spread * 420;
    nodes.crosshair.style.setProperty('--gap', `${gap.toFixed(1)}px`);

    if (match.bomb.planted) {
      nodes.bomb.hidden = false;
      nodes.bombTimer.textContent = formatTime(match.bomb.timer);
      nodes.bomb.classList.toggle('critical', match.bomb.timer < 12);
    } else {
      nodes.bomb.hidden = true;
    }

    if (match.bomb.planted && match.bomb.defuseProgress > 0) {
      nodes.defuse.hidden = false;
      nodes.defuseFill.style.width = `${Math.min(100, (match.bomb.defuseProgress / 7) * 100).toFixed(1)}%`;
    } else {
      nodes.defuse.hidden = true;
    }

    nodes.buy.hidden = !buyOpen;
    nodes.buyMoney.textContent = `$${match.money}`;
    for (const row of nodes.buyList.children) {
      const item = BUY_ITEMS.find((entry) => entry.id === row.dataset.item);
      row.classList.toggle('unaffordable', item && item.cost > match.money);
    }

    if (bannerTimer > 0) {
      bannerTimer -= 1 / 60;
      if (bannerTimer <= 0) nodes.banner.classList.remove('on');
    }
  }

  function banner(text, seconds = 2.4) {
    nodes.banner.textContent = text;
    nodes.banner.classList.add('on');
    bannerTimer = seconds;
  }

  function killFeed(attacker, victim, headshot) {
    const row = document.createElement('li');
    row.className = 'feed-row';
    row.innerHTML = `<b>${attacker}</b><span class="${headshot ? 'hs' : ''}">${headshot ? '✚' : '›'}</span><i>${victim}</i>`;
    nodes.feed.prepend(row);
    window.setTimeout(() => row.remove(), 5200);
    while (nodes.feed.children.length > 5) nodes.feed.lastElementChild.remove();
  }

  function hitmarker(headshot) {
    nodes.hitmarker.classList.add('on');
    nodes.hitmarker.classList.toggle('head', Boolean(headshot));
    window.setTimeout(() => nodes.hitmarker.classList.remove('on'), 90);
  }

  function damage(amount) {
    nodes.vignette.style.opacity = String(Math.min(0.85, 0.2 + amount / 90));
    window.setTimeout(() => { nodes.vignette.style.opacity = '0'; }, 130);
  }

  function setBuyOpen(open) {
    buyOpen = open;
    nodes.buy.hidden = !open;
  }

  function isBuyOpen() {
    return buyOpen;
  }

  function siteHint(text) {
    if (text) {
      nodes.siteHint.textContent = text;
      nodes.siteHint.hidden = false;
    } else {
      nodes.siteHint.hidden = true;
    }
  }

  function setSpectating(on) {
    nodes.spectating.hidden = !on;
  }

  function toggleScoreboard(show) {
    nodes.scores.hidden = !show;
  }

  function updateScoreboard(bots, player) {
    const rows = [];
    const ct = [{ name: 'You', alive: player.state.alive, me: true }];
    for (const bot of bots.bots.filter((b) => b.team === 'ct')) ct.push({ name: `Agent ${bot.id}`, alive: bot.alive });
    const t = bots.bots.filter((b) => b.team === 't').map((bot) => ({ name: `Hostile ${bot.id}`, alive: bot.alive }));
    for (const entry of [...ct, ...t]) {
      const div = document.createElement('li');
      div.className = entry.alive ? 'sb-row' : 'sb-row dead';
      if (entry.me) div.classList.add('me');
      div.textContent = entry.name;
      rows.push(div);
    }
    nodes.scoresBody.replaceChildren(...rows);
  }

  function showMatchEnd(won, score) {
    nodes.matchEnd.hidden = false;
    nodes.matchEndTitle.textContent = won ? 'MATCH WON' : 'MATCH LOST';
    nodes.matchEndTitle.className = won ? 'won' : 'lost';
    nodes.matchEndScore.textContent = score;
  }

  function hideMatchEnd() {
    nodes.matchEnd.hidden = true;
  }

  return {
    update,
    banner,
    killFeed,
    hitmarker,
    damage,
    setBuyOpen,
    isBuyOpen,
    siteHint,
    setSpectating,
    toggleScoreboard,
    updateScoreboard,
    showMatchEnd,
    hideMatchEnd,
    buyItems: BUY_ITEMS,
  };
}