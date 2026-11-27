// Procedural first-person viewmodel motion. No renderer. Units are metres / radians
// in camera space (the camera looks down -Z).
export const VM_FOV = 54;

export const REST = { x: 0.16, y: -0.15, z: -0.42, rx: 0.04, ry: 0.06, rz: 0 };
export const SPRINT = { x: 0.28, y: -0.28, z: -0.38, rx: 0.18, ry: 0.55, rz: 0.35 };

export function createMotion() {
  return { t: 0, phase: 0, lagY: 0, lagP: 0, yaw0: null, pit0: null, kick: 0, sprint: 0, bobX: 0, bobY: 0, swayX: 0, swayY: 0 };
}

export function stepMotion(st, { dt, speed = 0, yaw = 0, pitch = 0, sprinting = false, kick = 0 } = {}) {
  const d = Math.min(0.05, Math.max(0, dt || 0));
  st.t += d;
  if (kick) st.kick = Math.max(st.kick, kick);
  st.kick *= Math.max(0, 1 - d * 12);

  if (st.yaw0 == null) { st.yaw0 = yaw; st.pit0 = pitch; }
  let dy = yaw - st.yaw0; while (dy > Math.PI) dy -= Math.PI * 2; while (dy < -Math.PI) dy += Math.PI * 2;
  const dp = (pitch || 0) - (st.pit0 || 0);
  st.yaw0 = yaw; st.pit0 = pitch;
  st.lagY += dy;
  st.lagP += dp;
  const lagK = 1 - Math.exp(-8 * d);
  st.lagY += (0 - st.lagY) * lagK;
  st.lagP += (0 - st.lagP) * lagK;

  const walk = Math.min(1, Math.max(0, (speed || 0) / 5));
  st.phase += d * (8 + walk * 6);
  const wantBobX = Math.sin(st.phase) * 0.014 * walk;
  const wantBobY = Math.abs(Math.cos(st.phase)) * 0.016 * walk;
  const sm = 1 - Math.exp(-14 * d);
  st.bobX += (wantBobX - st.bobX) * sm;
  st.bobY += (wantBobY - st.bobY) * sm;
  st.swayX = Math.sin(st.t * 1.15) * 0.006 + Math.sin(st.t * 0.37) * 0.003;
  st.swayY = Math.cos(st.t * 0.92) * 0.005;
  st.sprint += ((sprinting ? 1 : 0) - st.sprint) * (1 - Math.exp(-7 * d));

  const a = 1 - st.sprint, b = st.sprint;
  return {
    x: REST.x * a + SPRINT.x * b + st.bobX + st.swayX - st.lagY * 0.12,
    y: REST.y * a + SPRINT.y * b + st.bobY + st.swayY - st.lagP * 0.1 + st.kick * 0.55,
    z: REST.z * a + SPRINT.z * b + st.kick * 0.35,
    rx: REST.rx * a + SPRINT.rx * b + st.kick + st.lagP * 0.25,
    ry: REST.ry * a + SPRINT.ry * b - st.lagY * 0.35,
    rz: REST.rz * a + SPRINT.rz * b + st.bobX * 0.8,
  };
}
