// Shared, tiny flags so the avatar, net, and the M4 viewmodel can agree
// without importing each other in a loop.
let out = false, fp = true;
export const rifleOut = () => out;
export const setRifleOut = (v) => { out = !!v; };
export const rifleFirstPerson = () => fp;
export const setRifleFirstPerson = (v) => { fp = !!v; };
