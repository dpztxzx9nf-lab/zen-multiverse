// World generation version. Bump this when the globe, caves or ore tables change
// in a way that should drop old terrain edits so everyone sees the same land.
// Accounts, chat and last-known positions stay. Client saves still load; only
// the stored voxel diffs from an older generation are thrown away.
export const WORLD_GEN = 34;
