// The map FOUNDRY, built from data: wall segments with door gaps, props, two plant sites,
// the spawns, and the waypoint graph the bots walk. Nothing here simulates; it only builds
// geometry and hands back the colliders, the nav graph and the site volumes the rest of the
// game reads. One palette, one set of materials, so the whole map shares one look.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

const WALL_HEIGHT = 5.4;
const WALL_THICKNESS = 0.7;

// Wall segments as [x1, z1, x2, z2]; a segment is axis aligned, and two segments with a gap
// between them make a doorway. The layout: Long along the west edge, Mid up the middle,
// Tunnels along the east edge, two plant sites in the north, one spawn in each half.
const WALL_SEGMENTS = [
  // outer shell
  [-30, -30, 30, -30], [30, -30, 30, 30], [30, 30, -30, 30], [-30, 30, -30, -30],

  // Long: west corridor wall, from the CT side up to site A
  [-22, 12, -22, -12],

  // the west block between Long and Mid, split to leave a connector at z 2..5
  [-22, -10, -4, -10],
  [-4, -10, -4, 2],
  [-4, 5, -4, 10],
  [-22, 10, -4, 10],
  [-22, -10, -22, 10],

  // the east block between Mid and Tunnels, connector at z -5..-2
  [4, -10, 22, -10],
  [4, -10, 4, -5],
  [4, -2, 4, 10],
  [4, 10, 22, 10],
  [22, -10, 22, 10],

  // site A south wall with a door at x -11..-7, and its east wall with a door at z -19..-16
  [-26, -12, -11, -12],
  [-7, -12, -4, -12],
  [-4, -12, -4, -16],
  [-4, -19, -4, -26],

  // site B south wall with a door at x 7..11, west wall with a door at z -19..-16
  [4, -12, 7, -12],
  [11, -12, 22, -12],
  [4, -12, 4, -16],
  [4, -19, 4, -26],

  // the walls that close each site from the north edge
  [-26, -26, -4, -26],
  [4, -26, 26, -26],
];

// Props: [x, z, width, depth, height, material]
const PROPS = [
  // site A: a crucible block to plant behind, crates to hold angles from
  [-18, -19, 5, 3, 1.15, 'steel'], [-12.5, -22.5, 2.2, 2.2, 1.9, 'rust'],
  [-8.5, -14.5, 1.6, 1.6, 1.6, 'sand'], [-23, -14.5, 2.4, 2.4, 2.4, 'sand'],
  [-15, -24.5, 1.2, 1.2, 1.2, 'steel'],

  // site B: the loading bay, containers to break sightlines
  [16, -20, 4.4, 2.4, 2.6, 'rust'], [10.5, -24, 2.6, 2.6, 1.5, 'steel'],
  [21, -14.5, 1.8, 1.8, 1.8, 'sand'], [7.5, -15, 1.4, 1.4, 1.4, 'sand'],

  // Long: the low wall every long control fight is fought over
  [-26, -2, 4.2, 1.1, 1.2, 'steel'], [-27, 7, 1.6, 1.6, 1.6, 'sand'],

  // Mid: two silos and a crate stack that break the lane in half
  [-1.2, -3.5, 2.6, 2.6, 4.2, 'steel'], [1.4, 4.5, 2, 2, 1.1, 'sand'],
  [-2, 8, 1.4, 1.4, 1.4, 'rust'],

  // Tunnels: pipes along the wall, crates at the tunnel mouth
  [26.5, -4, 1.1, 8, 1.05, 'steel'], [24, 6.5, 2.2, 2.2, 1.7, 'sand'],

  // CT spawn cover
  [-6.5, 20, 3, 1.4, 1.1, 'sand'], [6.5, 20, 3, 1.4, 1.1, 'sand'],

  // T spawn cover
  [-5, -27.5, 2.6, 1.4, 1.05, 'rust'], [5, -27.5, 2.6, 1.4, 1.05, 'rust'],
];

const SITES = {
  A: { key: 'A', name: 'Crucible', center: new THREE.Vector3(-13.6, 0, -16.4), radius: 4.6 },
  B: { key: 'B', name: 'Loading Bay', center: new THREE.Vector3(14.2, 0, -16.2), radius: 4.6 },
};

const SPAWNS = {
  ct: [
    new THREE.Vector3(-3, 0, 25.5), new THREE.Vector3(0, 0, 26.5), new THREE.Vector3(3, 0, 25.5),
    new THREE.Vector3(-6, 0, 24), new THREE.Vector3(6, 0, 24),
  ],
  t: [
    new THREE.Vector3(-3, 0, -27.5), new THREE.Vector3(0, 0, -28.5), new THREE.Vector3(3, 0, -27.5),
    new THREE.Vector3(-6, 0, -26), new THREE.Vector3(6, 0, -26),
  ],
};

// The waypoint graph: named posts the bots move between. Edges are hand checked to run down
// open floor, so no path has to be searched through geometry that is not there.
export const NAV = {
  nodes: {
    ctSpawn: [-2, 26], ctMid: [0, 18], ctLong: [-25, 17], ctTunnel: [25, 17],
    midSouth: [0, 12], midBox: [-1, 7], midSilo: [-2, 1], midNorth: [0, -6], midJunction: [0, -13],
    longDoor: [-20, 8], longMid: [-25, 0], longWall: [-24, -6], longRamp: [-24, -14], longNorth: [-27, -20],
    siteADoor: [-9, -13], siteACrate: [-14, -17], siteACrucible: [-18, -21], siteAWest: [-24, -23],
    tunnelSouth: [25, 12], tunnelMid: [26, 2], tunnelNorth: [24, -8], siteBDoor: [9, -13],
    siteBLoad: [15, -18], siteBContainer: [19, -22], siteBEast: [23, -16],
    connectorMidLong: [-13, 3.5], connectorMidTunnel: [13, -3.5], tSpawn: [0, -25], tRamp: [-12, -24],
    tLong: [-20, -24], tTunnel: [13, -24],
  },
  edges: [
    ['ctSpawn', 'ctMid'], ['ctSpawn', 'ctLong'], ['ctSpawn', 'ctTunnel'], ['ctMid', 'midSouth'],
    ['midSouth', 'midBox'], ['midBox', 'midSilo'], ['midSilo', 'midNorth'], ['midNorth', 'midJunction'],
    ['ctLong', 'longDoor'], ['longDoor', 'longMid'], ['longMid', 'longWall'], ['longWall', 'longRamp'],
    ['longRamp', 'longNorth'], ['longNorth', 'siteAWest'], ['siteAWest', 'siteACrucible'],
    ['siteACrucible', 'siteACrate'], ['siteACrate', 'siteADoor'], ['siteADoor', 'midJunction'],
    ['ctTunnel', 'tunnelSouth'], ['tunnelSouth', 'tunnelMid'], ['tunnelMid', 'tunnelNorth'],
    ['tunnelNorth', 'siteBEast'], ['siteBEast', 'siteBContainer'], ['siteBContainer', 'siteBLoad'],
    ['siteBLoad', 'siteBDoor'], ['siteBDoor', 'midJunction'], ['midSouth', 'connectorMidLong'],
    ['connectorMidLong', 'longDoor'], ['midNorth', 'connectorMidTunnel'], ['connectorMidTunnel', 'tunnelMid'],
    ['tSpawn', 'midJunction'], ['tSpawn', 'tRamp'], ['tRamp', 'tLong'], ['tRamp', 'tTunnel'],
    ['tLong', 'longNorth'], ['tTunnel', 'tunnelNorth'], ['tSpawn', 'siteADoor'], ['tSpawn', 'siteBDoor'],
  ],
};

function materialFor(key, materials) {
  return materials[key] ?? materials.sand;
}

// A box is one visual and one collider. Every solid thing on the map is made of these unless
// it is a wall, so the collider list and the geometry can never drift apart.
function addBox(scene, colliders, materials, x, z, width, depth, height, key, yBase = 0) {
  const geometry = new THREE.BoxGeometry(width, height, depth);
  const mesh = new THREE.Mesh(geometry, materialFor(key, materials));
  mesh.position.set(x, yBase + height / 2, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  colliders.push({
    minX: x - width / 2, maxX: x + width / 2,
    minY: yBase, maxY: yBase + height,
    minZ: z - depth / 2, maxZ: z + depth / 2,
  });
  return mesh;
}

function addWall(scene, colliders, materials, x1, z1, x2, z2) {
  const horizontal = Math.abs(x2 - x1) >= Math.abs(z2 - z1);
  const width = horizontal ? Math.abs(x2 - x1) + WALL_THICKNESS : WALL_THICKNESS;
  const depth = horizontal ? WALL_THICKNESS : Math.abs(z2 - z1) + WALL_THICKNESS;
  const cx = (x1 + x2) / 2;
  const cz = (z1 + z2) / 2;
  return addBox(scene, colliders, materials, cx, cz, width, depth, WALL_HEIGHT, 'wall');
}

// Lamps: a sodium point light with a small emissive housing, so the map has pools of warm
// light that tell the player where the lanes open up.
function addLamp(scene, x, z, intensity = 26, color = PALETTE.amber) {
  const housing = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.22, 0.9),
    new THREE.MeshBasicMaterial({ color }),
  );
  housing.position.set(x, WALL_HEIGHT - 0.35, z);
  scene.add(housing);
  const cable = new THREE.Mesh(
    new THREE.CylinderGeometry(0.02, 0.02, 3.2, 5),
    new THREE.MeshBasicMaterial({ color: new THREE.Color(PALETTE.steel) }),
  );
  cable.position.set(x, WALL_HEIGHT + 1.4, z);
  scene.add(cable);
  const light = new THREE.PointLight(new THREE.Color(color), intensity, 22, 1.6);
  light.position.set(x, WALL_HEIGHT - 0.8, z);
  scene.add(light);
  return light;
}

// A dusk sky: one dome, two colours mixed by height, so the horizon glows and the zenith goes
// cold. Cheaper than a texture and it never seams.
function addSky(scene) {
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      zenith: { value: new THREE.Color('#4c5a74') },
      horizon: { value: new THREE.Color('#c4783f') },
      glow: { value: new THREE.Color(PALETTE.amber) },
    },
    vertexShader: `
      varying vec3 vPosition;
      void main() {
        vPosition = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 zenith;
      uniform vec3 horizon;
      uniform vec3 glow;
      varying vec3 vPosition;
      void main() {
        float h = clamp(normalize(vPosition).y * 1.6 + 0.15, 0.0, 1.0);
        vec3 colour = mix(horizon, zenith, pow(h, 0.75));
        colour = mix(colour, glow, pow(1.0 - h, 6.0) * 0.35);
        gl_FragColor = vec4(colour, 1.0);
      }
    `,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(150, 24, 16), material);
  dome.frustumCulled = false;
  scene.add(dome);
}

// Detail that carries no collision: pipes, gratings, trim bands, cable runs and hazard stripes.
// It is what stops a map of boxes from reading as a grey box.
function addDetail(scene, materials) {
  const trimMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.steel), roughness: 0.8, metalness: 0.2 });
  const hazardMaterial = new THREE.MeshStandardMaterial({ color: new THREE.Color(PALETTE.amber), roughness: 0.7, emissive: new THREE.Color(PALETTE.amber), emissiveIntensity: 0.12 });

  const pipe = (x, y, z, length, axis, radius = 0.13) => {
    const geometry = axis === 'x' ? new THREE.CylinderGeometry(radius, radius, length, 8) : new THREE.CylinderGeometry(radius, radius, length, 8);
    const mesh = new THREE.Mesh(geometry, trimMaterial);
    if (axis === 'x') mesh.rotation.z = Math.PI / 2;
    if (axis === 'z') mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    scene.add(mesh);
  };

  // pipe runs along the long walls, at head height so they read as a line leading the eye
  pipe(-21.4, 3.1, 0, 20, 'z');
  pipe(21.4, 3.1, 0, 20, 'z');
  pipe(0, 4.3, -11.4, 12, 'x', 0.16);
  pipe(-9.6, 2.9, -12.5, 12, 'x', 0.1);

  // gratings on the floor: dark plates at the mouth of each lane
  for (const [x, z, w, d] of [[-25, 4, 3.4, 2.2], [0, 15, 4.2, 2.4], [25, 5, 3.2, 2.2], [-14, -16, 5, 3]]) {
    const grate = new THREE.Mesh(new THREE.BoxGeometry(w, 0.04, d), trimMaterial);
    grate.position.set(x, 0.05, z);
    scene.add(grate);
  }

  // hazard stripes at each site entrance, which is how a player finds a bomb site fast
  for (const [x, z, w] of [[-9, -11.6, 3.6], [9, -11.6, 3.6], [-4.4, -17.6, 3.2], [4.4, -17.6, 3.2]]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.36), hazardMaterial);
    stripe.position.set(x, 0.06, z);
    scene.add(stripe);
  }

  // wall trim: a dark band at waist height on the two lane walls, so surfaces have scale
  for (const [x, z, w, d] of [[-22, 0, 0.14, 24], [22, 0, 0.14, 22], [-13, 10, 18, 0.14], [13, -10, 18, 0.14], [-13, -10, 18, 0.14]]) {
    const band = new THREE.Mesh(new THREE.BoxGeometry(w, 0.18, d), trimMaterial);
    band.position.set(x, 1.15, z);
    scene.add(band);
  }

  // expansion joints in the floor: four thin lines that give the concrete a scale
  for (let i = -2; i <= 2; i += 1) {
    const seam = new THREE.Mesh(new THREE.BoxGeometry(58, 0.02, 0.06), trimMaterial);
    seam.position.set(0, 0.021, i * 11);
    scene.add(seam);
    const seamX = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.02, 58), trimMaterial);
    seamX.position.set(i * 11, 0.021, 0);
    scene.add(seamX);
  }
}

// A surface grain, drawn once into a canvas and tiled: two grays mixed by value noise with a
// few streaks. It is what makes concrete read as concrete instead of as flat colour, and it
// costs one texture per material family.
function grainTexture(base, variance, streaks = 0, size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  const baseColor = new THREE.Color(base);
  context.fillStyle = `#${baseColor.getHexString()}`;
  context.fillRect(0, 0, size, size);
  const image = context.getImageData(0, 0, size, size);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const noise = (Math.random() - 0.5) * variance * 255;
    data[i] = Math.max(0, Math.min(255, data[i] + noise));
    data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
    data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
  }
  context.putImageData(image, 0, 0);
  for (let i = 0; i < streaks; i += 1) {
    context.globalAlpha = 0.05 + Math.random() * 0.08;
    context.fillStyle = i % 2 === 0 ? '#000000' : '#ffffff';
    const x = Math.random() * size;
    context.fillRect(x, 0, 1 + Math.random() * 2, size);
  }
  context.globalAlpha = 1;
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 4;
  return texture;
}

export function createWorld(scene) {
  const colliders = [];
  const wallTexture = grainTexture('#9c9488', 0.1, 26);
  wallTexture.repeat.set(3, 2);
  const sandTexture = grainTexture(PALETTE.sandDark, 0.11, 18);
  sandTexture.repeat.set(2, 2);
  const rustTexture = grainTexture(PALETTE.rust, 0.14, 34);
  rustTexture.repeat.set(2, 1);
  const steelTexture = grainTexture(PALETTE.steel, 0.1, 10);
  steelTexture.repeat.set(1, 2);
  const floorTexture = grainTexture('#6f6b64', 0.13, 40);
  floorTexture.repeat.set(14, 14);

  const materials = {
    wall: new THREE.MeshStandardMaterial({ map: wallTexture, roughness: 0.94, metalness: 0.03 }),
    sand: new THREE.MeshStandardMaterial({ map: sandTexture, roughness: 0.9 }),
    rust: new THREE.MeshStandardMaterial({ map: rustTexture, roughness: 0.72, metalness: 0.22 }),
    steel: new THREE.MeshStandardMaterial({ map: steelTexture, roughness: 0.55, metalness: 0.6 }),
  };

  // floor: one large plane, with a slightly darker slate inside each site so the two
  // objectives read from across the map
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(62, 62),
    new THREE.MeshStandardMaterial({ map: floorTexture, roughness: 0.97 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  for (const site of Object.values(SITES)) {
    const pad = new THREE.Mesh(
      new THREE.CircleGeometry(site.radius, 40),
      new THREE.MeshStandardMaterial({
        color: new THREE.Color(PALETTE.steel), roughness: 0.7, metalness: 0.35,
        emissive: new THREE.Color(PALETTE.teal), emissiveIntensity: 0.08,
      }),
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(site.center.x, 0.02, site.center.z);
    pad.receiveShadow = true;
    scene.add(pad);
  }

  for (const [x1, z1, x2, z2] of WALL_SEGMENTS) {
    if (typeof x1 !== 'number') continue;
    addWall(scene, colliders, materials, x1, z1, x2, z2);
  }
  for (const [x, z, w, d, h, key] of PROPS) addBox(scene, colliders, materials, x, z, w, d, h, key);

  // catwalk over mid: a raised deck the player can climb by the ramp at the CT side, and a
  // sightline over the silo. Walkable, so it is a floor with a collider beneath it.
  addBox(scene, colliders, materials, 0, 3.2, 7.4, 3.2, 0.3, 'steel', 3.0);
  addBox(scene, colliders, materials, -3.9, 3.2, 1.2, 3.2, 0.3, 'steel', 2.2);
  addBox(scene, colliders, materials, 3.9, 3.2, 1.2, 3.2, 0.3, 'steel', 2.6);

  // lighting: dusk sky, a low warm sun from the west, sodium lamps down the lanes
  scene.add(new THREE.HemisphereLight(new THREE.Color(PALETTE.fog), new THREE.Color(PALETTE.rust), 1.55));
  const sun = new THREE.DirectionalLight(new THREE.Color(PALETTE.amber), 2.3);
  sun.position.set(-34, 24, 16);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -36;
  sun.shadow.camera.right = 36;
  sun.shadow.camera.top = 36;
  sun.shadow.camera.bottom = -36;
  sun.shadow.camera.far = 90;
  sun.shadow.bias = -0.0004;
  sun.shadow.radius = 2.4;
  scene.add(sun);

  addSky(scene);
  addDetail(scene, materials);
  addLamp(scene, -16, -19);          // site A
  addLamp(scene, 16, -19);           // site B
  addLamp(scene, 0, 6, 18);          // mid
  addLamp(scene, -25, -4, 14);       // long
  addLamp(scene, 25, 4, 14);         // tunnels

  return {
    colliders,
    sites: SITES,
    spawns: SPAWNS,
    nav: NAV,
    bounds: { minX: -29.5, maxX: 29.5, minZ: -29.5, maxZ: 29.5 },
  };
}