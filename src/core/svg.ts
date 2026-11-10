/**
 * Writes geometry as SVG or as a React component. See docs/GEOMETRY.md.
 *
 * Both forms print from one small element tree, so they cannot drift apart. Only
 * svg, title, rect, g and path are ever produced, and no attribute value comes
 * from outside validated scene data except the escaped title.
 */

import type { Geometry, OutputPath } from './pipeline';
import type { Rect, Scene } from './scene';
import { levelRegions, tintLoops, tintPass } from './tint';

/** An absolute command every so often limits drift in 32-bit renderers. */
const ABSOLUTE_EVERY = 64;

/** Trims a fixed-point string: 1.50 to 1.5, 0.25 to .25, -0.5 to -.5. */
function trimNumber(text: string): string {
  let out = text;
  if (out.includes('.')) {
    out = out.replace(/0+$/, '').replace(/\.$/, '');
  }
  if (out === '-0' || out === '' || out === '-') return '0';
  return out.replace(/^(-?)0\./, '$1.');
}

export function formatNumber(value: number, decimals: number): string {
  return trimNumber(value.toFixed(decimals));
}

/** Prints an integer count of 10^-decimals units, with no float rounding. */
function formatLattice(value: number, decimals: number): string {
  if (decimals === 0) return String(value);
  const sign = value < 0 ? '-' : '';
  const digits = String(Math.abs(value)).padStart(decimals + 1, '0');
  const whole = digits.slice(0, digits.length - decimals);
  const fraction = digits.slice(digits.length - decimals);
  return trimNumber(`${sign}${whole}.${fraction}`);
}

function pair(x: string, y: string): string {
  return y.startsWith('-') ? `${x}${y}` : `${x} ${y}`;
}

/**
 * Path data for one output path. Differences are taken on the integer lattice, so
 * summing them returns the rounded vertices exactly.
 */
export function pathData(path: OutputPath): string {
  const { points, decimals, closed } = path;
  const scale = 10 ** decimals;
  const n = points.length / 2;
  let lastX = Math.round(points[0] * scale);
  let lastY = Math.round(points[1] * scale);
  const parts = [`M${pair(formatLattice(lastX, decimals), formatLattice(lastY, decimals))}`];
  let inRelativeRun = false;
  for (let i = 1; i < n; i++) {
    const x = Math.round(points[i * 2] * scale);
    const y = Math.round(points[i * 2 + 1] * scale);
    if (i % ABSOLUTE_EVERY === 0) {
      parts.push(`L${pair(formatLattice(x, decimals), formatLattice(y, decimals))}`);
      inRelativeRun = false;
    } else {
      const text = pair(formatLattice(x - lastX, decimals), formatLattice(y - lastY, decimals));
      if (inRelativeRun) parts.push(text.startsWith('-') ? text : ` ${text}`);
      else parts.push(`l${text}`);
      inRelativeRun = true;
    }
    lastX = x;
    lastY = y;
  }
  if (closed) parts.push('z');
  return parts.join('');
}

export interface LevelStyle {
  opacity: number;
  width: number;
}

/** How one level is drawn. The canvas and the file both read this. */
export function levelStyle(scene: Scene, index: number): LevelStyle {
  const { fade, strokeWidth, indexEvery, indexWidth, taper } = scene.style;
  const count = scene.levels.count;
  const position = count > 1 ? index / (count - 1) : 1;
  const heavy = indexEvery > 0 && (index + 1) % indexEvery === 0;
  const weight = heavy ? indexWidth : strokeWidth;
  return {
    opacity: 1 - fade * (1 - position),
    // Left exactly as it was when there is no taper, so older files print the same.
    width: taper > 0 ? weight * (1 - taper * (1 - position)) : weight,
  };
}

/**
 * The same scene with its tint off. A tint pass is a filled shape that runs along
 * the frame, so anything that measures the lines in a file has to read this one.
 */
export function linesOnly(scene: Scene): Scene {
  return scene.style.tint === 0 ? scene : { ...scene, style: { ...scene.style, tint: 0 } };
}

/** The tint passes as path data, lowest first. Empty when the scene has no tint. */
export function tintPaths(geometry: Geometry, scene: Scene): string[] {
  const { tint } = scene.style;
  if (tint === 0) return [];
  const out: string[] = [];
  for (const region of levelRegions(geometry)) {
    if (!region) continue;
    const loops = tintLoops(region, geometry.rect, tint < 0);
    if (loops.length === 0) continue;
    const { decimals } = region;
    out.push(loops.map((points) => pathData({ points, closed: true, decimals, bound: 0 })).join(''));
  }
  return out;
}

interface Element {
  tag: 'svg' | 'title' | 'rect' | 'g' | 'path';
  attrs: [string, string][];
  text?: string;
  children?: Element[];
}

function outputSize(rect: Rect, scene: Scene): { width: number; height: number } {
  const width = scene.export.outputWidth || rect.width;
  return { width, height: (width * rect.height) / rect.width };
}

function buildTree(geometry: Geometry, scene: Scene): Element {
  const { rect } = geometry;
  const { width, height } = outputSize(rect, scene);
  const { style } = scene;
  const viewBox = [rect.x, rect.y, rect.width, rect.height]
    .map((v) => formatNumber(v, 3))
    .join(' ');
  const root: Element = {
    tag: 'svg',
    attrs: [
      ['xmlns', 'http://www.w3.org/2000/svg'],
      ['viewBox', viewBox],
      ['width', formatNumber(width, 3)],
      ['height', formatNumber(height, 3)],
      ['fill', 'none'],
      ['stroke', style.stroke],
      ['stroke-width', formatNumber(style.strokeWidth, 3)],
      ['stroke-linecap', 'round'],
      ['stroke-linejoin', 'round'],
    ],
    children: [],
  };
  const children = root.children as Element[];
  if (scene.name) children.push({ tag: 'title', attrs: [], text: scene.name });
  if (style.background) {
    children.push({
      tag: 'rect',
      attrs: [
        ['x', formatNumber(rect.x, 3)],
        ['y', formatNumber(rect.y, 3)],
        ['width', formatNumber(rect.width, 3)],
        ['height', formatNumber(rect.height, 3)],
        ['fill', style.background],
        ['stroke', 'none'],
      ],
    });
  }
  const tints = tintPaths(geometry, scene);
  if (tints.length > 0) {
    children.push({
      tag: 'g',
      attrs: [
        ['fill', style.tintColor],
        ['fill-opacity', formatNumber(tintPass(style.tint, geometry.levels.length), 4)],
        ['fill-rule', 'evenodd'],
        ['stroke', 'none'],
      ],
      children: tints.map((d) => ({ tag: 'path', attrs: [['d', d]] })),
    });
  }
  const fixed = scene.export.strokeScaling === 'fixed';
  for (const level of geometry.levels) {
    if (level.paths.length === 0) continue;
    const look = levelStyle(scene, level.index);
    const paths: Element[] = level.paths.map((path) => ({
      tag: 'path',
      attrs: fixed
        ? [
            ['vector-effect', 'non-scaling-stroke'],
            ['d', pathData(path)],
          ]
        : [['d', pathData(path)]],
    }));
    const attrs: [string, string][] = [];
    if (look.opacity !== 1) attrs.push(['stroke-opacity', formatNumber(look.opacity, 3)]);
    if (look.width !== style.strokeWidth) attrs.push(['stroke-width', formatNumber(look.width, 3)]);
    if (attrs.length > 0) children.push({ tag: 'g', attrs, children: paths });
    else children.push(...paths);
  }
  return root;
}

/** Characters XML 1.0 forbids, including lone surrogates. */
const NOT_XML = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

export function escapeText(text: string): string {
  return text
    .replace(NOT_XML, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function printSvg(element: Element): string {
  const attrs = element.attrs.map(([k, v]) => ` ${k}="${v}"`).join('');
  if (element.text !== undefined) {
    return `<${element.tag}${attrs}>${escapeText(element.text)}</${element.tag}>`;
  }
  if (!element.children) return `<${element.tag}${attrs}/>`;
  const inner = element.children.map(printSvg).join('\n');
  return `<${element.tag}${attrs}>\n${inner}\n</${element.tag}>`;
}

export function toSvg(geometry: Geometry, scene: Scene): string {
  return `${printSvg(buildTree(geometry, scene))}\n`;
}

const JSX_NAMES: Record<string, string> = {
  'stroke-width': 'strokeWidth',
  'stroke-linecap': 'strokeLinecap',
  'stroke-linejoin': 'strokeLinejoin',
  'stroke-opacity': 'strokeOpacity',
  'fill-opacity': 'fillOpacity',
  'fill-rule': 'fillRule',
  'vector-effect': 'vectorEffect',
};

function printJsx(element: Element, indent: string): string {
  const attrs = element.attrs.map(([k, v]) => ` ${JSX_NAMES[k] ?? k}="${v}"`).join('');
  if (element.text !== undefined) {
    return `${indent}<${element.tag}${attrs}>{${JSON.stringify(element.text)}}</${element.tag}>`;
  }
  if (!element.children) return `${indent}<${element.tag}${attrs} />`;
  const inner = element.children.map((c) => printJsx(c, `${indent}  `)).join('\n');
  return `${indent}<${element.tag}${attrs}>\n${inner}\n${indent}</${element.tag}>`;
}

export function componentName(scene: Scene): string {
  const words = scene.name.match(/[A-Za-z0-9]+/g) ?? [];
  const name = words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
  if (name === '' || !/^[A-Za-z]/.test(name)) return 'ContourArtwork';
  return name.endsWith('Artwork') ? name : `${name}Artwork`;
}

/**
 * A static React component with the same elements as the SVG. Extra props go to
 * the svg element, so a page can set className, or aria-hidden for decoration.
 */
export function toReact(geometry: Geometry, scene: Scene): string {
  const tree = buildTree(geometry, scene);
  const body = (tree.children as Element[]).map((c) => printJsx(c, '      ')).join('\n');
  const attrs = tree.attrs.map(([k, v]) => `      ${JSX_NAMES[k] ?? k}="${v}"`).join('\n');
  return `import type { SVGProps } from 'react';

/** Static artwork exported from Contour. It has no effects and no animation. */
export function ${componentName(scene)}(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
${attrs}
      {...props}
    >
${body}
    </svg>
  );
}
`;
}
