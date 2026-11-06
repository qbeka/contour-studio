/**
 * The project page's replay. It plays a recorded drag through the real pipeline,
 * in the browser, and lets the viewer take the handle. Nothing here is precomputed.
 */

import { computeGeometry, type Geometry } from '../src/core/pipeline';
import { PRESETS, type Preset } from '../src/core/presets';
import type { PeakSource, Scene } from '../src/core/scene';
import { levelStyle, pathData, toSvg } from '../src/core/svg';

interface Take {
  preset: Preset;
  /** The source that moves. */
  source: string;
  /** Reach of the recorded loop, in scene units. */
  reach: [number, number];
}

const TAKES: Take[] = [
  { preset: PRESETS[0], source: 'summit', reach: [430, 90] },
  { preset: PRESETS[1], source: 'island', reach: [-170, 130] },
  { preset: PRESETS[2], source: 's6', reach: [150, 120] },
];

const SVG = 'http://www.w3.org/2000/svg';
const LOOP_MS = 7000;
const DRAFT_RESOLUTION = 256;
const SETTLE_MS = 90;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const art = $('art') as unknown as SVGSVGElement;
const handle = $<HTMLButtonElement>('handle');
const play = $<HTMLButtonElement>('play');
const scrub = $<HTMLInputElement>('scrub');
const detail = $<HTMLSelectElement>('detail');
const nodes = $<HTMLButtonElement>('nodes');

let take = TAKES[0];
let position = { x: 0, y: 0 };
let t = 0;
let playing = false;
let lastFrame = 0;
let settle = 0;
let latest: Geometry | null = null;
let latestScene: Scene | null = null;
let levels: SVGPathElement[] = [];
let nodeLayer: SVGGElement;

const moving = (scene: Scene) => scene.sources.find((s) => s.id === take.source) as PeakSource;

/** The recorded path. A closed loop that starts and ends where the source sits. */
function along(time: number): { x: number; y: number } {
  const start = moving(take.preset.scene);
  const turn = 2 * Math.PI * time;
  return {
    x: start.x + (take.reach[0] / 2) * (1 - Math.cos(turn)),
    y: start.y + take.reach[1] * Math.sin(turn) * Math.cos(turn / 2),
  };
}

function currentScene(): Scene {
  const scene = take.preset.scene;
  return {
    ...scene,
    sources: scene.sources.map((s) => (s.id === take.source ? { ...s, ...position } : s)),
    export: { ...scene.export, tolerance: Number(detail.value) },
  };
}

function draftData(geometry: Geometry, index: number): string {
  let d = '';
  for (const { points, closed } of geometry.levels[index]?.paths ?? []) {
    d += `M${points[0].toFixed(1)} ${points[1].toFixed(1)}`;
    for (let k = 2; k < points.length; k += 2) {
      d += `L${points[k].toFixed(1)} ${points[k + 1].toFixed(1)}`;
    }
    if (closed) d += 'z';
  }
  return d;
}

function placeHandle(): void {
  const { rect } = computeRect();
  handle.style.left = `${((position.x - rect.x) / rect.width) * 100}%`;
  handle.style.top = `${((position.y - rect.y) / rect.height) * 100}%`;
}

function computeRect(): { rect: Scene['clip'] } {
  return { rect: take.preset.scene.clip };
}

function draw(): void {
  const scene = currentScene();
  const started = performance.now();
  const geometry = computeGeometry(scene, { quality: 'draft', resolution: DRAFT_RESOLUTION });
  levels.forEach((path, i) => path.setAttribute('d', draftData(geometry, i)));
  nodeLayer.replaceChildren();
  placeHandle();
  $('readout').classList.add('busy');
  $('dot').className = '';
  $('state').textContent = `Draft, ${DRAFT_RESOLUTION} grid, ${Math.round(performance.now() - started)} ms on this device`;
  window.clearTimeout(settle);
  if (!playing) settle = window.setTimeout(refine, SETTLE_MS);
}

function refine(): void {
  const scene = currentScene();
  const started = performance.now();
  const geometry = computeGeometry(scene, { quality: 'final' });
  const svg = toSvg(geometry, scene);
  const elapsed = performance.now() - started;
  latest = geometry;
  latestScene = scene;
  levels.forEach((path, i) => {
    path.setAttribute('d', (geometry.levels[i]?.paths ?? []).map(pathData).join(''));
  });
  drawNodes();
  const { stats } = geometry;
  $('r-nodes').textContent = `${stats.outputVertices.toLocaleString('en-US')} of ${stats.sourceVertices.toLocaleString('en-US')}`;
  $('r-size').textContent = `${(new TextEncoder().encode(svg).length / 1024).toFixed(1)} KB`;
  $('r-bound').textContent = `${stats.maxBound.toFixed(2)} units`;
  $('r-cross').textContent = String(stats.crossings);
  $('readout').classList.remove('busy');
  $('dot').className = 'final';
  $('state').textContent = `Export geometry, ${geometry.resolution} grid, ${Math.round(elapsed)} ms on this device`;
}

function drawNodes(): void {
  nodeLayer.replaceChildren();
  if (nodes.getAttribute('aria-pressed') !== 'true' || !latest) return;
  const rect = latest.rect;
  const size = rect.width / 420;
  const dots = document.createElementNS(SVG, 'path');
  let d = '';
  for (const level of latest.levels) {
    for (const { points } of level.paths) {
      for (let k = 0; k < points.length; k += 2) {
        d += `M${(points[k] - size).toFixed(1)} ${(points[k + 1] - size).toFixed(1)}h${(size * 2).toFixed(1)}v${(size * 2).toFixed(1)}h-${(size * 2).toFixed(1)}z`;
      }
    }
  }
  dots.setAttribute('d', d);
  dots.setAttribute('class', 'node');
  nodeLayer.append(dots);
}

function buildStage(): void {
  const scene = take.preset.scene;
  const rect = scene.clip;
  art.setAttribute('viewBox', `${rect.x} ${rect.y} ${rect.width} ${rect.height}`);
  art.setAttribute('aria-label', `Contour lines of ${take.preset.title}`);
  art.replaceChildren();

  const trail = document.createElementNS(SVG, 'path');
  let d = '';
  for (let i = 0; i <= 120; i++) {
    const p = along(i / 120);
    d += `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }
  trail.setAttribute('d', d);
  trail.setAttribute('class', 'loop');

  levels = Array.from({ length: scene.levels.count }, (_, i) => {
    const path = document.createElementNS(SVG, 'path');
    const style = levelStyle(scene, i);
    path.setAttribute('stroke', scene.style.stroke);
    path.setAttribute('stroke-opacity', style.opacity.toFixed(2));
    path.setAttribute('stroke-width', String(style.width));
    return path;
  });
  nodeLayer = document.createElementNS(SVG, 'g');
  art.append(...levels, trail, nodeLayer);
  handle.setAttribute('aria-label', `Move ${moving(scene).name}. Drag it, or use the arrow keys`);
}

function setPlaying(next: boolean): void {
  playing = next;
  play.textContent = next ? 'Pause' : 'Play';
  if (next) {
    lastFrame = performance.now();
    requestAnimationFrame(frame);
  } else {
    draw();
  }
}

function frame(now: number): void {
  if (!playing) return;
  t += (now - lastFrame) / LOOP_MS;
  lastFrame = now;
  if (t >= 1) {
    t = 0;
    position = along(0);
    scrub.value = '0';
    setPlaying(false);
    return;
  }
  position = along(t);
  scrub.value = String(Math.round(t * 1000));
  draw();
  requestAnimationFrame(frame);
}

function load(index: number): void {
  if (playing) playing = false;
  play.textContent = 'Play';
  take = TAKES[index];
  t = 0;
  scrub.value = '0';
  position = along(0);
  buildStage();
  placeHandle();
  refine();
}

function clampToFrame(x: number, y: number): { x: number; y: number } {
  const { rect } = computeRect();
  return {
    x: Math.min(rect.x + rect.width, Math.max(rect.x, x)),
    y: Math.min(rect.y + rect.height, Math.max(rect.y, y)),
  };
}

function moveTo(x: number, y: number): void {
  if (playing) {
    playing = false;
    play.textContent = 'Play';
  }
  position = clampToFrame(x, y);
  draw();
}

handle.addEventListener('pointerdown', (event) => {
  handle.setPointerCapture(event.pointerId);
});
handle.addEventListener('pointermove', (event) => {
  if (!handle.hasPointerCapture(event.pointerId)) return;
  const box = $('stage').getBoundingClientRect();
  const { rect } = computeRect();
  moveTo(
    rect.x + ((event.clientX - box.left) / box.width) * rect.width,
    rect.y + ((event.clientY - box.top) / box.height) * rect.height,
  );
});
handle.addEventListener('keydown', (event) => {
  const step = event.shiftKey ? 50 : 10;
  const moves: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, -step],
    ArrowDown: [0, step],
  };
  const move = moves[event.key];
  if (!move) return;
  event.preventDefault();
  moveTo(position.x + move[0], position.y + move[1]);
});

play.addEventListener('click', () => {
  if (!playing) position = along(t);
  setPlaying(!playing);
});
scrub.addEventListener('input', () => {
  playing = false;
  play.textContent = 'Play';
  t = Number(scrub.value) / 1000;
  position = along(t);
  draw();
});
detail.addEventListener('change', () => refine());
nodes.addEventListener('click', () => {
  const on = nodes.getAttribute('aria-pressed') !== 'true';
  nodes.setAttribute('aria-pressed', String(on));
  nodes.textContent = on ? 'Hide nodes' : 'Show nodes';
  drawNodes();
});
$('scene').addEventListener('change', (event) => load(Number((event.target as HTMLSelectElement).value)));
$('download').addEventListener('click', () => {
  if (!latest || !latestScene) return;
  const url = URL.createObjectURL(new Blob([toSvg(latest, latestScene)], { type: 'image/svg+xml' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${take.preset.id}.svg`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function drawSignature(): void {
  const scene = PRESETS[0].scene;
  const geometry = computeGeometry(scene, { quality: 'final' });
  const rect = geometry.rect;
  const ridge = $('ridge') as unknown as SVGSVGElement;
  ridge.setAttribute('viewBox', `${rect.x} ${rect.y} ${rect.width} ${rect.height}`);
  [3, 6, 9].forEach((level, i) => {
    const longest = [...(geometry.levels[level]?.paths ?? [])].sort((a, b) => b.points.length - a.points.length)[0];
    if (!longest) return;
    const path = document.createElementNS(SVG, 'path');
    path.setAttribute('d', pathData(longest));
    path.setAttribute('stroke-opacity', String(0.3 + i * 0.3));
    ridge.append(path);
  });
}

TAKES.forEach((item, index) => $<HTMLSelectElement>('scene').add(new Option(item.preset.title, String(index))));
drawSignature();
load(0);
