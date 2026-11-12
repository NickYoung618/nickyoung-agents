/** All animation values are pure functions of one elapsed time, in milliseconds. */
export const CYCLE_MS = 30000;
export type Point = { x: number; y: number };
export const SOURCE: Point = { x: 441, y: 278 };
export const TARGET: Point = { x: 540, y: 284 };
export const SHOULDER: Point = { x: 331, y: 205 };
export const ARM_LENGTHS = [110, 125] as const;
const HOME: Point = { x: 400, y: 225 };
const PICK: Point = { x: SOURCE.x, y: SOURCE.y - 28 };
const LIFT: Point = { x: SOURCE.x, y: 180 };
const ABOVE_TARGET: Point = { x: TARGET.x, y: 186 };
const PLACE: Point = { x: TARGET.x, y: TARGET.y - 28 };
const RETREAT: Point = { x: 515, y: 190 };

const clamp = (value: number) => Math.max(0, Math.min(1, value));
function ease(time: number, start: number, end: number) {
  const p = clamp((time - start) / (end - start));
  return p * p * (3 - 2 * p);
}
function mix(a: Point, b: Point, progress: number): Point {
  return { x: a.x + (b.x - a.x) * progress, y: a.y + (b.y - a.y) * progress };
}

/** Two-link inverse kinematics; the trajectory stays within the fixed arm's reach. */
function elbowFor(wrist: Point): Point {
  const dx = wrist.x - SHOULDER.x;
  const dy = wrist.y - SHOULDER.y;
  const d = Math.hypot(dx, dy);
  const [upper, lower] = ARM_LENGTHS;
  const cosine = Math.max(-1, Math.min(1, (d * d + upper * upper - lower * lower) / (2 * upper * d)));
  const angle = Math.atan2(dy, dx) - Math.acos(cosine);
  return { x: SHOULDER.x + upper * Math.cos(angle), y: SHOULDER.y + upper * Math.sin(angle) };
}

export function sample(elapsed: number) {
  const time = ((elapsed % CYCLE_MS) + CYCLE_MS) % CYCLE_MS;
  const phase = time < 6000 ? 0 : time < 10000 ? 1 : time < 25000 ? 2 : 3;
  let wrist = HOME;
  if (time >= 10000 && time < 13000) wrist = mix(HOME, PICK, ease(time, 10000, 13000));
  else if (time >= 13000 && time < 14000) wrist = PICK;
  else if (time >= 14000 && time < 17000) wrist = mix(PICK, LIFT, ease(time, 14000, 17000));
  else if (time >= 17000 && time < 21000) wrist = mix(LIFT, ABOVE_TARGET, ease(time, 17000, 21000));
  else if (time >= 21000 && time < 23000) wrist = mix(ABOVE_TARGET, PLACE, ease(time, 21000, 23000));
  else if (time >= 23000 && time < 24000) wrist = PLACE;
  else if (time >= 24000 && time < 25000) wrist = mix(PLACE, RETREAT, ease(time, 24000, 25000));
  else if (time >= 25000 && time < 28000) wrist = mix(RETREAT, HOME, ease(time, 25000, 28000));

  const holding = time >= 14000 && time < 23000;
  const object = holding ? { x: wrist.x, y: wrist.y + 28 } : time >= 23000 ? TARGET : SOURCE;
  const gap = time < 13000 ? 37 : time < 14000 ? 37 - 12 * ease(time, 13000, 14000)
    : time < 23000 ? 25 : 25 + 12 * ease(time, 23000, 24000);
  let description: string;
  if (time < 3000) description = '视觉扫描桌面，寻找可抓取的橙色方块。';
  else if (time < 6000) description = '已框选橙色方块，记录物体位置与抓取点。';
  else if (time < 10000) description = '规划先抬起、再平移、最后下放的路径，避开桌面。';
  else if (time < 13000) description = '机械臂接近物体，张开的夹爪对准抓取点。';
  else if (time < 14000) description = '夹爪收拢，夹紧方块两侧。';
  else if (time < 17000) description = '夹持物体向上抬起，与桌面保持安全距离。';
  else if (time < 21000) description = '保持夹紧，沿规划路径将方块搬运到目标区上方。';
  else if (time < 23000) description = '缓慢下放，使方块落在目标区内。';
  else if (time < 25000) description = '张开夹爪释放方块，机械臂退出目标区。';
  else if (time < 26000) description = '重新观察目标区，检测放置结果。';
  else description = '放置成功：方块位于目标区。结果反馈给下一轮感知。';

  return {
    time, phase, wrist, elbow: elbowFor(wrist), object, gap, holding, description,
    scanX: 390 + 95 * (0.5 - 0.5 * Math.cos(Math.min(time, 6000) / 1200 * Math.PI)),
    detection: phase === 0 ? clamp((time - 1000) / 1000) : 0,
    pathProgress: phase === 1 ? clamp((time - 6000) / 3000) : phase === 2 ? 1 : 0,
    success: time >= 26000,
  };
}
