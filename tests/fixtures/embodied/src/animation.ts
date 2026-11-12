import { sample, CYCLE_MS, SHOULDER } from './timeline';
import { phases } from './content';

/** One requestAnimationFrame loop drives every visual effect. No CSS animations or timers. */
export function startAnimation() {
  const get = <T extends Element = SVGElement>(selector: string) => document.querySelector<T>(selector)!;
  const object = get('#object');
  const gripper = get('#gripper');
  const leftFinger = get('#finger-left');
  const rightFinger = get('#finger-right');
  const arm = get('#arm-links');
  const elbow = get('#elbow-joint');
  const scan = get('#scan-line');
  const detection = get('#perception-overlay');
  const path = get('#planned-path');
  const feedback = get('#feedback-overlay');
  const toggle = get<HTMLButtonElement>('#play-toggle');
  const replay = get<HTMLButtonElement>('#replay');
  const progress = get<HTMLProgressElement>('#time-progress');
  const display = get<HTMLElement>('#time-display');
  const description = get<HTMLElement>('#dynamic-description');
  const status = get<HTMLElement>('#play-status');
  const phaseLabel = get<HTMLElement>('#phase-label');
  const motionNote = get<HTMLElement>('#motion-note');
  const phaseElements = phases.map((phase) => get<HTMLElement>(`[data-phase="${phase.id}"]`));
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let playing = !reduced.matches;
  let hasPlayed = playing;
  let elapsed = 0;
  let previous = performance.now();
  let lastPhase = -1;

  function render() {
    const pose = sample(elapsed);
    object.setAttribute('transform', `translate(${pose.object.x} ${pose.object.y})`);
    gripper.setAttribute('transform', `translate(${pose.wrist.x} ${pose.wrist.y})`);
    leftFinger.setAttribute('transform', `translate(${-pose.gap} 0)`);
    rightFinger.setAttribute('transform', `translate(${pose.gap} 0)`);
    arm.setAttribute('d', `M${SHOULDER.x} ${SHOULDER.y}L${pose.elbow.x} ${pose.elbow.y}L${pose.wrist.x} ${pose.wrist.y}`);
    elbow.setAttribute('cx', `${pose.elbow.x}`);
    elbow.setAttribute('cy', `${pose.elbow.y}`);
    scan.setAttribute('transform', `translate(${pose.scanX} 0)`);
    scan.setAttribute('opacity', pose.phase === 0 ? '0.8' : '0');
    detection.setAttribute('opacity', `${pose.detection}`);
    path.setAttribute('opacity', pose.pathProgress > 0 ? '1' : '0');
    path.setAttribute('stroke-dashoffset', `${1 - pose.pathProgress}`);
    feedback.setAttribute('opacity', pose.phase === 3 ? '1' : '0');
    get('#result-check').setAttribute('opacity', pose.success ? '1' : '0');
    get('#target-zone').setAttribute('fill-opacity', pose.success ? '.22' : '.06');
    description.textContent = pose.description;
    progress.value = pose.time;
    display.textContent = `00:${Math.floor(pose.time / 1000).toString().padStart(2, '0')} / 00:30`;
    if (pose.phase !== lastPhase) {
      phaseElements.forEach((element, i) => {
        if (i === pose.phase) element.setAttribute('aria-current', 'step');
        else element.removeAttribute('aria-current');
      });
      phaseLabel.textContent = `${String(pose.phase + 1).padStart(2, '0')} · ${phases[pose.phase].name}`;
      lastPhase = pose.phase;
    }
    status.textContent = playing ? '循环演示中' : hasPlayed ? '已暂停' : '等待播放';
    toggle.textContent = playing ? '暂停' : hasPlayed ? '继续' : '播放';
    toggle.setAttribute('aria-label', toggle.textContent);
    motionNote.hidden = !reduced.matches;
    motionNote.textContent = playing ? '减少动态效果偏好已启用；当前为主动播放。' : '已遵循减少动态效果偏好，点击播放可观看。';
  }

  function frame(now: number) {
    if (playing) elapsed = (elapsed + Math.max(0, now - previous)) % CYCLE_MS;
    previous = now;
    render();
    requestAnimationFrame(frame);
  }
  toggle.addEventListener('click', () => {
    // Account for the fraction since the last frame before freezing or resuming.
    const now = performance.now();
    if (playing) elapsed = (elapsed + Math.max(0, now - previous)) % CYCLE_MS;
    previous = now;
    playing = !playing;
    if (playing) hasPlayed = true;
    render();
  });
  replay.addEventListener('click', () => {
    elapsed = 0;
    previous = performance.now();
    playing = true;
    hasPlayed = true;
    render();
  });
  reduced.addEventListener('change', () => {
    if (reduced.matches) playing = false;
    previous = performance.now();
    render();
  });
  render();
  requestAnimationFrame(frame);
}
