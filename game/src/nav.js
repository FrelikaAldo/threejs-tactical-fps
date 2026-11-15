// Pathfinding over the waypoint graph in world.js: straight-line A* with a squared-distance
// heuristic. The graph is small (36 posts), so the open set is a plain array kept sorted by
// cost rather than a heap: fewer moving parts, and the same answer.
export function nearestNode(nav, point) {
  let best = null;
  let bestDistance = Infinity;
  for (const key of Object.keys(nav.nodes)) {
    const [x, z] = nav.nodes[key];
    const distance = (x - point.x) ** 2 + (z - point.z) ** 2;
    if (distance < bestDistance) { bestDistance = distance; best = key; }
  }
  return best;
}

export function pathBetween(nav, fromKey, toKey) {
  if (fromKey === toKey) return [];
  const neighbours = new Map();
  for (const key of Object.keys(nav.nodes)) neighbours.set(key, []);
  for (const [a, b] of nav.edges) {
    neighbours.get(a)?.push(b);
    neighbours.get(b)?.push(a);
  }
  const goal = nav.nodes[toKey];
  const gScore = new Map([[fromKey, 0]]);
  const cameFrom = new Map();
  const open = [fromKey];
  const closed = new Set();

  while (open.length > 0) {
    let bestIndex = 0;
    let bestCost = Infinity;
    for (let i = 0; i < open.length; i += 1) {
      const key = open[i];
      const [x, z] = nav.nodes[key];
      const cost = gScore.get(key) + Math.hypot(goal[0] - x, goal[1] - z);
      if (cost < bestCost) { bestCost = cost; bestIndex = i; }
    }
    const current = open.splice(bestIndex, 1)[0];
    if (current === toKey) {
      const path = [current];
      let walk = current;
      while (cameFrom.has(walk)) {
        walk = cameFrom.get(walk);
        path.unshift(walk);
      }
      return path.slice(1);
    }
    closed.add(current);
    const [cx, cz] = nav.nodes[current];
    for (const neighbour of neighbours.get(current)) {
      if (closed.has(neighbour)) continue;
      const [nx, nz] = nav.nodes[neighbour];
      const tentative = gScore.get(current) + Math.hypot(nx - cx, nz - cz);
      if (tentative < (gScore.get(neighbour) ?? Infinity)) {
        cameFrom.set(neighbour, current);
        gScore.set(neighbour, tentative);
        if (!open.includes(neighbour)) open.push(neighbour);
      }
    }
  }
  return [];
}