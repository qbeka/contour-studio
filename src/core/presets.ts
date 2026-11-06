/**
 * The three starting scenes. All geometry here was placed by hand for this
 * project. Nothing is traced from an existing artwork. `authoring` is shown in
 * the app and repeated in docs/REPORT.md.
 */

import { emptyScene, type PeakSource, type RidgeSource, type Scene } from './scene';

export interface Preset {
  id: string;
  title: string;
  summary: string;
  authoring: string;
  scene: Scene;
}

function peak(
  id: string,
  name: string,
  x: number,
  y: number,
  radius: number,
  height: number,
): PeakSource {
  return { id, name, kind: 'peak', enabled: true, x, y, radius, height };
}

function ridge(
  id: string,
  name: string,
  points: [number, number][],
  radius: number,
  height: number,
): RidgeSource {
  return {
    id,
    name,
    kind: 'ridge',
    enabled: true,
    points: points.map(([x, y]) => ({ x, y })),
    radius,
    height,
  };
}

function quietRidge(): Scene {
  const base = emptyScene();
  return {
    ...base,
    name: 'Quiet ridge',
    seed: 2719,
    domain: { width: 1600, height: 640 },
    clip: { x: 80, y: 80, width: 1440, height: 480 },
    sources: [
      ridge(
        'crest',
        'Long crest',
        [[-60, 470], [240, 300], [560, 395], [900, 450], [1230, 285], [1680, 180]],
        210,
        0.82,
      ),
      peak('summit', 'Left summit', 262, 262, 170, 0.34),
      ridge('shoulder', 'Far shoulder', [[1050, 120], [1320, 210], [1620, 110]], 150, 0.3),
      peak('valley', 'Valley floor', 860, 560, 210, -0.2),
    ],
    noise: { amplitude: 0.022, scale: 210, octaves: 3 },
    levels: { base: 0.09, spacing: 0.085, count: 14 },
    style: { ...base.style, stroke: '#1d3a2a', strokeWidth: 0.8, fade: 0.72 },
    export: { ...base.export, tolerance: 0.12, decimals: 1 },
  };
}

function asymmetricBasin(): Scene {
  const base = emptyScene();
  return {
    ...base,
    name: 'Asymmetric basin',
    seed: 613,
    domain: { width: 1000, height: 1000 },
    clip: { x: 0, y: 0, width: 1000, height: 1000 },
    sources: [
      peak('bowl', 'Main bowl', 430, 560, 560, -1.1),
      ridge('wall', 'Steep wall', [[120, 90], [380, 150], [700, 90], [940, 300], [905, 620]], 240, 0.75),
      peak('island', 'Island', 560, 690, 150, 0.46),
      peak('notch', 'Outlet', 150, 860, 240, -0.42),
    ],
    noise: { amplitude: 0.035, scale: 260, octaves: 2 },
    levels: { base: -0.95, spacing: 0.1, count: 20 },
    style: { ...base.style, stroke: '#111511', strokeWidth: 0.9, indexEvery: 5, indexWidth: 1.7 },
    export: { ...base.export, tolerance: 0.15 },
  };
}

function interferenceStudy(): Scene {
  const base = emptyScene();
  const sources: Scene['sources'] = [];
  // Two rows of opposing sources, offset by hand so that no axis of symmetry
  // survives. The saddles between them are what makes this scene a stress case.
  const placed: [number, number, number][] = [
    [170, 190, 0.9], [420, 150, -0.8], [690, 210, 1], [950, 160, -0.9],
    [290, 420, -1], [560, 400, 0.85], [840, 450, -0.75], [1060, 380, 0.9],
    [140, 620, 0.8], [430, 660, -0.9], [720, 640, 0.95], [990, 630, -1],
  ];
  placed.forEach(([x, y, height], i) => {
    sources.push(peak(`s${i + 1}`, `Source ${i + 1}`, x, y, 340, height));
  });
  return {
    ...base,
    name: 'Interference study',
    seed: 90210,
    domain: { width: 1200, height: 800 },
    clip: { x: 0, y: 0, width: 1200, height: 800 },
    sources,
    noise: { amplitude: 0.04, scale: 120, octaves: 3 },
    levels: { base: -1.15, spacing: 0.1, count: 24 },
    style: { ...base.style, stroke: '#1d3a2a', strokeWidth: 0.7 },
    export: { ...base.export, tolerance: 0.1 },
  };
}

export const PRESETS: readonly Preset[] = [
  {
    id: 'quiet-ridge',
    title: 'Quiet ridge',
    summary: 'A low range that fades upward. Made to sit behind text.',
    authoring:
      'One long crest set by hand across the frame, with a left summit and a far shoulder to break its symmetry. A broad negative source lowers the valley. Texture stays small, so the lines read as drawn, not noisy.',
    scene: quietRidge(),
  },
  {
    id: 'asymmetric-basin',
    title: 'Asymmetric basin',
    summary: 'A deep bowl with one steep wall and an island.',
    authoring:
      'A wide negative source digs the bowl. A curved ridge steepens one side, which bunches the lines there. An island breaks the centre, and a second negative source cuts an outlet. Every fifth line is heavier, as on a survey map.',
    scene: asymmetricBasin(),
  },
  {
    id: 'interference-study',
    title: 'Interference study',
    summary: 'Twelve opposing sources and many saddles. The densest scene.',
    authoring:
      'Twelve sources of alternating sign in three offset rows, placed by hand so that no symmetry survives. Each saddle between them is an ambiguous case for contour extraction, which makes this the stress scene as well.',
    scene: interferenceStudy(),
  },
];
