// Build pieces: dims and cost, no three.js, so the server (server/src/builds.js) can check shared builds.
// dims in metres (x along the piece, y up, z depth). cost per material.
export const PIECES = {
  wall: { name: 'Wall', dims: [2, 2, 0.2], mats: { wood: { 'mat:wood': 2 }, stone: { 'mat:stone': 4 } } },
  floor: { name: 'Floor', dims: [2, 0.2, 2], mats: { wood: { 'mat:wood': 2 }, stone: { 'mat:stone': 4 }, metal: { 'mat:metal': 2 } } },
  beam: { name: 'Beam', dims: [2, 0.24, 0.24], mats: { wood: { 'mat:wood': 1 }, stone: { 'mat:stone': 2 }, metal: { 'mat:metal': 1 } } },
  post: { name: 'Post', dims: [0.24, 2, 0.24], mats: { wood: { 'mat:wood': 1 }, stone: { 'mat:stone': 2 }, metal: { 'mat:metal': 1 } } },
  block: { name: 'Block', dims: [1, 0.5, 0.5], mats: { stone: { 'mat:stone': 1 }, ice: { 'mat:ice': 2 } } },
  ramp: { name: 'Ramp', dims: [2, 0.2, 2.24], pitch: -0.4636, mats: { wood: { 'mat:wood': 2 }, stone: { 'mat:stone': 4 } } },
  bench: { name: 'Workbench', dims: [1.6, 0.9, 0.8], mats: { wood: { 'mat:wood': 4, 'mat:stone': 2 } }, station: true },
  // power and logic (js/game/sim/power.js): metal conducts, these make, use, store and steer it
  wire: { name: 'Copper wire', dims: [2, 0.06, 0.06], mats: { metal: { 'mat:metal': 1 } } },
  solar: { name: 'Solar crystal', dims: [1, 0.1, 1], mats: { crystal: { 'mat:crystal': 2, 'mat:metal': 1 } } },
  wheel: { name: 'Water wheel', dims: [0.3, 1.6, 1.6], mats: { wood: { 'mat:wood': 3, 'mat:metal': 1 } } },
  vane: { name: 'Wind vane', dims: [0.3, 2, 2], mats: { metal: { 'mat:metal': 2, 'mat:wood': 1 } } },
  battery: { name: 'Battery', dims: [0.5, 0.35, 0.42], mats: { metal: { 'mat:metal': 2, 'mat:crystal': 1 } } },
  lamp: { name: 'Lamp', dims: [0.34, 0.44, 0.34], mats: { crystal: { 'mat:crystal': 1, 'mat:metal': 1 } } },
  heater: { name: 'Heater coil', dims: [0.42, 0.3, 0.42], mats: { metal: { 'mat:metal': 2 } } },
  switch: { name: 'Switch', dims: [0.3, 0.4, 0.2], mats: { metal: { 'mat:metal': 1, 'mat:wood': 1 } } },
  relay: { name: 'Relay (AND/OR/XOR/NOT)', dims: [0.5, 0.3, 0.5], mats: { metal: { 'mat:metal': 1, 'mat:crystal': 1 } } },
};
