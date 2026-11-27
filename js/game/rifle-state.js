// Shared flags so the avatar, net, and the M4 agree without import loops.
// The viewmodel is drawn only in first person (toggled, or while aiming).
// The world model is used in third person. Never both at once.
let out = false, fp = false, aiming = false;
export const rifleOut = () => out;
export const setRifleOut = (v) => { out = !!v; };
export const rifleFirstPerson = () => fp;
export const setRifleFirstPerson = (v) => { fp = !!v; };
export const rifleAiming = () => aiming;
export const setRifleAiming = (v) => { aiming = !!v; };
export const rifleUseViewmodel = () => out && (fp || aiming);
