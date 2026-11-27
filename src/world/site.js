// Site layout (meters). +X = east (toward the highway), -Z = north. Floor level y = 0 everywhere.
export const SITE = {
  store: { x0: -10, x1: 0, z0: -7, z1: 15, wallT: 0.3, wallH: 4.75, roofY: 4.25, ceilY: 3.0 },
  partitionZ: 6.5,
  door: { z0: 1.6, z1: 3.6, h: 2.3 },
  greenDoor: { z0: 13.0, z1: 14.0, h: 2.15 },
  windows: [[-6.4, 1.6], [3.6, 6.4]],
  kneeH: 0.72, windowTop: 2.7,
  canopy: { x0: 0, x1: 14.5, z0: -10.5, z1: 6.4, y0: 4.35, slab: 0.22, fasciaH: 0.85 },
  pillars: [[11.2, -6.2], [11.2, 1.8]],
  islands: [[11.2, -6.2], [11.2, 1.8]],
  road: { x0: 24.2, x1: 31.6, center: 27.9 },
  streetPoleX: 22.9, streetHeadX: 25.1, streetH: 8.6, streetZ0: 8, streetSpacing: 32,
  lot: { x0: -2, x1: 22.6, z0: -30, z1: 34 },
  groundRegion: { x0: -20, z0: -56, x1: 52, z1: 44 },
};

// texture tile sizes (meters per repeat)
export const UV = {
  concrete: 4, stucco: 3.2, plaster: 2.5, vct: 1.2192, ceiling: 4.8768, metal: 1.0, wood: 1.6, asphalt: 2.0, groundcover: 6,
};
