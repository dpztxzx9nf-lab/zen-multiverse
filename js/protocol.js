// Shared protocol number for the live server and the game client.
// Bump this when a server message or ticket change would break an older client.
// An older client that sees a higher number starts its own update (desktop or PWA) instead of guessing.
export const PROTOCOL = 1;
