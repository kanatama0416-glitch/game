// The hamster and the turtle that wander on the room floor.
// stepWalker / pickTarget are pure (no DOM) so the movement rule can be tested;
// startPets wires them to the drawing and only runs while the room is on screen.

export const FLOOR = { y: 245, min: 190, max: 338 }; // room units; left end stays clear of the room label
export const PETS = {
  ham: { speed: 26, idle: 'sniff', pause: [900, 2200] },   // units per second; pause = [min, extra random] ms
  tur: { speed: 9, idle: 'hiding', pause: [1800, 2600] },
};

// Next place to walk to: random, but at least 20 units away so a walk is visible.
export function pickTarget(x, rnd, floor = FLOOR) {
  const t = floor.min + rnd() * (floor.max - floor.min);
  if (Math.abs(t - x) >= 20) return t;
  return x < (floor.min + floor.max) / 2 ? floor.max : floor.min;
}

// Advances one walker. s = {x, dir, target, pauseUntil, pose}; returns a new state.
export function stepWalker(s, now, dt, cfg, rnd, floor = FLOOR) {
  // The floor can shrink (longer room label), so keep the target inside it.
  const target = Math.min(floor.max, Math.max(floor.min, s.target));
  if (target !== s.target) s = { ...s, target };
  if (now < s.pauseUntil) return { ...s, pose: 'idle' };
  const d = s.target - s.x;
  if (Math.abs(d) < 1) {
    return { ...s, pose: 'idle', pauseUntil: now + cfg.pause[0] + rnd() * cfg.pause[1], target: pickTarget(s.x, rnd, floor) };
  }
  const dir = Math.sign(d);
  return { ...s, pose: 'walk', dir, x: s.x + dir * Math.min(Math.abs(d), cfg.speed * dt) };
}

// ---------- drawing ----------
const SVG_NS = 'http://www.w3.org/2000/svg';

function heart(svg, x, y) {
  const h = document.createElementNS(SVG_NS, 'path');
  h.setAttribute('d', `M${x.toFixed(1)} ${y} c-3 -4 -8 -1 -5 3 l5 5 l5 -5 c3 -4 -2 -7 -5 -3 z`);
  h.setAttribute('class', 'pet-heart');
  svg.appendChild(h);
  setTimeout(() => h.remove(), 1000);
}

const REACTIONS = {
  // Hamster: hop and a heart.
  ham(el, w, svg) {
    el.classList.remove('hop'); void el.getBBox(); el.classList.add('hop');
    w.s.pauseUntil = performance.now() + 1200;
    heart(svg, w.s.x, FLOOR.y - 34);
  },
  // Turtle: tuck in, then come out with a heart.
  tur(el, w, svg) {
    w.s.pauseUntil = performance.now() + 1600;
    el.classList.add('hiding');
    setTimeout(() => { el.classList.remove('hiding'); heart(svg, w.s.x + 14 * w.s.dir, FLOOR.y - 26); }, 900);
  },
};

// Floor for this frame: the left end moves right of the room label (its text changes by chapter).
const ROOM_UNITS = 360, TAIL_ROOM = 26;
export function floorRightOf(labelRight, floor = FLOOR) {
  return { ...floor, min: Math.min(floor.max - 40, Math.max(floor.min, labelRight + TAIL_ROOM)) };
}

export function startPets({ svg, room, label, reduce = false, rnd = Math.random }) {
  function floorNow() {
    if (!label) return FLOOR;
    const r = room.getBoundingClientRect(), l = label.getBoundingClientRect();
    if (!r.width) return FLOOR;
    return floorRightOf((l.right - r.left) / r.width * ROOM_UNITS);
  }
  const walkers = [...svg.querySelectorAll('[data-pet]')].map(el => {
    const kind = el.dataset.pet, cfg = PETS[kind];
    const x = Number(el.dataset.x);
    const w = { el, kind, cfg, flip: el.querySelector('.pet-flip'), s: { x, dir: 1, target: pickTarget(x, rnd), pauseUntil: 0, pose: 'idle' } };
    const tap = () => REACTIONS[kind](el, w, svg);
    el.addEventListener('click', tap);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(); } });
    return w;
  });

  function draw(w) {
    w.el.classList.toggle('walking', w.s.pose === 'walk');
    w.el.classList.toggle(w.cfg.idle, w.s.pose === 'idle');
    w.el.setAttribute('transform', `translate(${w.s.x.toFixed(1)} ${FLOOR.y})`);
    w.flip.setAttribute('transform', `scale(${w.s.dir} 1)`);
  }
  walkers.forEach(draw);
  if (reduce) return;

  // Run only while the room is on screen and the page is visible (saves battery).
  let roomVisible = false, frameId = 0, last = 0;
  const shouldRun = () => roomVisible && !document.hidden;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    const floor = floorNow();
    for (const w of walkers) { w.s = stepWalker(w.s, now, dt, w.cfg, rnd, floor); draw(w); }
    frameId = requestAnimationFrame(frame);
  }
  function update() {
    if (shouldRun() && !frameId) { last = performance.now(); frameId = requestAnimationFrame(frame); }
    if (!shouldRun() && frameId) { cancelAnimationFrame(frameId); frameId = 0; }
  }
  new IntersectionObserver(entries => { roomVisible = entries[entries.length - 1].isIntersecting; update(); }).observe(room);
  document.addEventListener('visibilitychange', update);
}
