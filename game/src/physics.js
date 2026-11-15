// Physics shared by the player and the bots: a body is a cylinder, the world is a list of
// axis-aligned boxes, and both walk the same code so a bot can never stand where the player
// cannot. Also the one ray/box test, used by line-of-sight and by gunfire.
const SKIN = 0.0005;

function overlaps(collider, x, z, radius, feetY, headY) {
  if (headY <= collider.minY + SKIN || feetY >= collider.maxY - SKIN) return false;
  const closestX = Math.max(collider.minX, Math.min(x, collider.maxX));
  const closestZ = Math.max(collider.minZ, Math.min(z, collider.maxZ));
  const dx = x - closestX;
  const dz = z - closestZ;
  return dx * dx + dz * dz < radius * radius;
}

// Moves a body by (dx, dz) against the collider list, one axis at a time, so a body slides
// along a wall instead of stopping dead on it. Returns the position it ended at.
export function slideMove(colliders, x, z, radius, feetY, headY, dx, dz) {
  let nx = x;
  let nz = z;
  let blockedX = false;
  let blockedZ = false;

  if (dx !== 0) {
    const tryX = nx + dx;
    for (const collider of colliders) {
      if (overlaps(collider, tryX, nz, radius, feetY, headY)) { blockedX = true; break; }
    }
    if (!blockedX) nx = tryX;
  }
  if (dz !== 0) {
    const tryZ = nz + dz;
    for (const collider of colliders) {
      if (overlaps(collider, nx, tryZ, radius, feetY, headY)) { blockedZ = true; break; }
    }
    if (!blockedZ) nz = tryZ;
  }
  return { x: nx, z: nz, blockedX, blockedZ };
}

// The floor height under a body: the top of the tallest collider it stands over, or 0 for the
// map floor. Lets the catwalk over mid be walked on without a second physics path.
export function floorAt(colliders, x, z, feetY) {
  let top = 0;
  for (const collider of colliders) {
    if (x < collider.minX || x > collider.maxX || z < collider.minZ || z > collider.maxZ) continue;
    if (collider.maxY > feetY + 0.55) continue;
    if (collider.maxY > top) top = collider.maxY;
  }
  return top;
}

// Ray against one box (slab method). Returns the distance along the ray, or Infinity.
export function rayBox(origin, direction, box) {
  let tMin = 0;
  let tMax = Infinity;
  const axes = [
    [origin.x, direction.x, box.minX, box.maxX],
    [origin.y, direction.y, box.minY, box.maxY],
    [origin.z, direction.z, box.minZ, box.maxZ],
  ];
  for (const [o, d, lo, hi] of axes) {
    if (Math.abs(d) < 1e-8) {
      if (o < lo || o > hi) return Infinity;
      continue;
    }
    const t1 = (lo - o) / d;
    const t2 = (hi - o) / d;
    tMin = Math.max(tMin, Math.min(t1, t2));
    tMax = Math.min(tMax, Math.max(t1, t2));
    if (tMin > tMax) return Infinity;
  }
  return tMin;
}

// Distance to the nearest wall along a ray, used for line of sight and for bullet impact.
export function nearestWall(colliders, origin, direction, maxDistance) {
  let best = maxDistance;
  for (const collider of colliders) {
    const t = rayBox(origin, direction, collider);
    if (t < best) best = t;
  }
  return best;
}