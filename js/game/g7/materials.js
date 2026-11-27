// What the world is made of. One table for the voxel ground, props and build pieces:
// how hard it is to dig, what you get back, how it sounds, how it slides, how it breaks.
export const VS = 0.5; // voxel size (m), as in Enshrouded
export const MAT = { AIR: 0, SOIL: 1, SAND: 2, STONE: 3, ICE: 4, ORE: 5, CRYSTAL: 6, PACKED: 7, SNOW: 8, SCRAP: 9, RESONITE: 10, DEEP_RESONITE: 11 };
export const MATS = {
  1: { id: 'soil', name: 'Soil', item: 'mat:soil', hard: 0.6, color: '#5e4330', step: 'grass', friction: 0.9 },
  2: { id: 'sand', name: 'Sand', item: 'mat:sand', hard: 0.4, color: '#c9b089', step: 'sand', friction: 0.8, pours: true },
  3: { id: 'stone', name: 'Stone', item: 'mat:stone', hard: 2.2, color: '#8b857d', step: 'stone', friction: 0.85, tool: 'pick' },
  4: { id: 'ice', name: 'Ice', item: 'mat:ice', hard: 1.2, color: '#b9d6e6', step: 'snow', friction: 0.06 },
  5: { id: 'ore', name: 'Metal ore', item: 'mat:ore', hard: 3.0, color: '#6d5244', step: 'stone', friction: 0.85, tool: 'pick', purpose: 'Smelted into Halvorsen parts and metal tools' },
  6: { id: 'crystal', name: 'Crystal', item: 'mat:crystal', hard: 2.6, color: '#b7b0f2', step: 'stone', friction: 0.5, tool: 'pick', purpose: 'Glasswood plates and Choirworks energy cells' },
  7: { id: 'packed', name: 'Packed earth', item: 'mat:soil', hard: 0.8, color: '#6a4c36', step: 'gravel', friction: 0.9 },
  8: { id: 'snow', name: 'Snow', item: 'mat:ice', hard: 0.3, color: '#e9eef2', step: 'snow', friction: 0.5, pours: true },
  9: { id: 'scrap', name: 'Scrap ore', item: 'mat:scrap', hard: 1.8, color: '#8a5a3a', step: 'stone', friction: 0.8, tool: 'pick', purpose: 'Common gun and tool parts' },
  10: { id: 'resonite', name: 'Resonite', item: 'mat:resonite', hard: 3.4, color: '#2ec8c0', step: 'stone', friction: 0.5, tool: 'pick', emissive: '#1ad4c8', purpose: 'Stores sound and energy for relic craft and claims' },
  11: { id: 'deep-resonite', name: 'Deep Resonite', item: 'mat:deep-resonite', hard: 4.2, color: '#c44cff', step: 'stone', friction: 0.45, tool: 'pick', emissive: '#e060ff', purpose: 'The loudest grade, used for Relic catalysts and the Bell' },
};

// how solid things behave (props and build pieces). Support numbers are Valheim's (WearNTear.cs):
// maxSupport when grounded, minSupport to stay up, support lost per metre vertically / sideways.
export const SOLID = {
  wood: { name: 'Wood', density: 600, maxS: 100, minS: 10, vLoss: 0.125, hLoss: 0.2, friction: 0.6, restitution: 0.15, toughness: 1, breaks: 'splinters', step: 'wood', item: 'mat:wood', color: '#9a7350', tex: 'wood_planks' },
  stone: { name: 'Stone', density: 2500, maxS: 1000, minS: 100, vLoss: 0.125, hLoss: 1.0, friction: 0.8, restitution: 0.05, toughness: 2.2, breaks: 'chunks', step: 'stone', item: 'mat:stone', color: '#9a948b', tex: 'japanese_stone_wall' },
  metal: { name: 'Metal', density: 7800, maxS: 1500, minS: 20, vLoss: 1 / 13, hLoss: 1 / 13, friction: 0.5, restitution: 0.1, toughness: 6, breaks: 'bend', step: 'stone', item: 'mat:metal', color: '#9aa3a8', tex: 'metal_plate' },
  ice: { name: 'Ice', density: 920, maxS: 1000, minS: 100, vLoss: 0.125, hLoss: 1 / 3, friction: 0.03, restitution: 0.1, toughness: 0.8, breaks: 'shards', step: 'snow', item: 'mat:ice', color: '#cfe6f2', tex: null },
  crystal: { name: 'Crystal', density: 2650, maxS: 1000, minS: 100, vLoss: 0.125, hLoss: 0.5, friction: 0.4, restitution: 0.1, toughness: 1.6, breaks: 'shards', step: 'stone', item: 'mat:crystal', color: '#c4bdf7', tex: null },
  shell: { name: 'Shell', density: 1200, friction: 0.6, restitution: 0.2, toughness: 0.6, breaks: 'shards', step: 'stone', item: 'find:shell', color: '#efd9c4', tex: null },
};
