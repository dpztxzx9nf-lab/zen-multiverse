import { MATERIALS, floats, burns, conducts, breaks } from '../js/xenia/materials.js';
let ok = 0, bad = 0; const t = (c, m) => { if (c) ok++; else { bad++; console.log('FAIL', m); } };
t(floats('wood') && !floats('stone') && !floats('steel'), 'wood floats, stone and steel sink');
t(floats('steel', 0.9), 'a hollow steel hull floats');
t(burns('wood') && burns('cloth') && !burns('stone') && !burns('steel'), 'wood and cloth burn, stone and steel do not');
t(conducts('copper') && conducts('steel') && !conducts('wood'), 'metals conduct, wood does not');
t(breaks('glass', 200) && !breaks('steel', 200), 'glass breaks where steel holds');
t(Object.values(MATERIALS).every((m) => m.rho > 0 && m.yields), 'every material has a density and yields');
console.log(`materials: ${ok} ok, ${bad} failed`); if (bad) process.exit(1);
