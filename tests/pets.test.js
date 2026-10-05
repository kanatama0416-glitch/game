import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FLOOR, PETS, pickTarget, stepWalker, floorRightOf } from '../js/pets.js';

const seq = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

test('targets stay on the floor and are a visible walk away', () => {
  for (const r of [0, 0.25, 0.5, 0.75, 0.999]) {
    const t = pickTarget(250, () => r);
    assert.ok(t >= FLOOR.min && t <= FLOOR.max, `in range: ${t}`);
    assert.ok(Math.abs(t - 250) >= 20 || t === FLOOR.min || t === FLOOR.max);
  }
  assert.equal(pickTarget(FLOOR.min, () => 0), FLOOR.max); // too close → go to the far end
});

test('walks toward the target at its own speed and faces that way', () => {
  const s = { x: 200, dir: 1, target: 300, pauseUntil: 0, pose: 'idle' };
  const ham = stepWalker(s, 1000, 0.5, PETS.ham, Math.random);
  const tur = stepWalker(s, 1000, 0.5, PETS.tur, Math.random);
  assert.equal(ham.pose, 'walk'); assert.equal(ham.dir, 1);
  assert.equal(ham.x, 200 + PETS.ham.speed * 0.5);
  assert.equal(tur.x, 200 + PETS.tur.speed * 0.5);
  assert.ok(tur.x < ham.x, 'the turtle is slower');
  const back = stepWalker({ ...s, target: 100 }, 1000, 0.1, PETS.ham, Math.random);
  assert.equal(back.dir, -1);
});

test('never overshoots, then pauses and picks the next target', () => {
  const s = { x: 299.5, dir: 1, target: 300, pauseUntil: 0, pose: 'walk' };
  const arrived = stepWalker(s, 1000, 0.5, PETS.tur, seq(0, 0.5));
  assert.equal(arrived.pose, 'idle');
  assert.equal(arrived.pauseUntil, 1000 + PETS.tur.pause[0]);
  assert.equal(arrived.x, 299.5);
  const near = stepWalker({ x: 299, dir: 1, target: 300, pauseUntil: 0 }, 1000, 1, PETS.ham, Math.random);
  assert.equal(near.x, 300);
  const waiting = stepWalker({ ...arrived }, 1500, 0.1, PETS.tur, Math.random);
  assert.equal(waiting.pose, 'idle'); assert.equal(waiting.x, 299.5);
});

test('the walking area starts right of the room label', () => {
  assert.equal(floorRightOf(100).min, FLOOR.min);          // short label: default
  assert.equal(floorRightOf(220).min, 246);                // long label: right of it, room for the tail
  assert.equal(floorRightOf(400).min, FLOOR.max - 40);     // never squeezed to nothing
  assert.ok(pickTarget(300, () => 0, floorRightOf(220)) >= 246);
});

test('a target outside a shrunken floor is pulled back in', () => {
  const floor = floorRightOf(220);
  const s = stepWalker({ x: 300, dir: -1, target: 195, pauseUntil: 0, pose: 'walk' }, 1000, 0.1, PETS.ham, Math.random, floor);
  assert.equal(s.target, floor.min);
});
