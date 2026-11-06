# Design

## Who it is for

A designer or developer who needs original line artwork for a cover, a project page or a quiet website background. They want to decide where the lines go. They also need a file they can hand to someone else.

## The problem

Shader tools give a good picture quickly, but the picture is a raster effect. You cannot open it in a vector editor, and you cannot say how much a "vector export" differs from what you saw on screen. Tracing the raster afterwards makes a large file with no guarantee of accuracy.

## The primary task

Place sources, shape a ridge, adjust the contours, tune export quality, save the composition.

The one memorable moment is dragging a source through the field and watching every contour respond. Everything else stays quiet so that moment has contrast. See [Rauno Freiberg on novelty](https://rauno.me/craft/novelty): repetition dulls an effect, so most of a tool should stay familiar.

## Two approaches to the central workflow

### A: Handles on the drawing (chosen)

```
+--+-----------------------------------+-----------------+
|V |                                   | Sources         |
|P |        ~~~~~~~~~~                 |  o Main peak    |
|R |     ~~~   (o)   ~~~~              |  / Long ridge   |
|  |       ~~~~~~~~~~      o---o---o   |-----------------|
|  |                                   | Selected source |
|  |                                   |  Height, Reach  |
|? |                                   | Lines | Export  |
+--+-----------------------------------+-----------------+
```

Each source is a handle on the canvas and a row in the list. Selecting either selects both. You drag a peak, or drag the points along a ridge. The drawing changes under your hand. Numbers live in the inspector for when you need precision.

Storyboard:

1. Open the app. The ridge starter is on the canvas, so the first screen is real content.
2. Press `P`, click to place a peak. Its row appears selected in the list.
3. Drag the peak. A coarse preview follows the pointer and the status reads "Draft".
4. Release. The status reads "Refining", then "Export geometry". The lines you now see are the exact lines that go in the file.
5. Open Export. Choose a line detail. See node count, file size and error bound change for this composition.
6. Download the SVG and open it anywhere.

### B: Paint the height, then trace it (rejected)

The user paints a height map with a brush, then the tool extracts contours. This is immediate and needs no concept of a source.

I rejected it for three reasons:

- A painted raster needs storage, so a scene file stops being small and portable.
- Authorship becomes harder to repeat. Moving one mountain means repainting it, while a source moves as one object.
- Numeric editing and keyboard control have nothing to hold on to. A brush has no x and y to type.

A panel of sliders with no handles was also considered and dropped early. It is the "effects with sliders" tool the product argument rules out.

## Layout

- A slim tool rail on the left: Select, Peak, Ridge, Pan, undo and redo, zoom to fit, shortcuts.
- One canvas. Source handles are real buttons laid over it, so focus, keyboard and touch work without a second input model.
- A right column with the source list, the selected source and tabs for Lines and Export.
- A thin status line under the canvas that always says what the lines on screen are: a draft, refining, or export geometry.

On a phone the rail and the right column simplify. You can view, zoom, open a starter, load a scene and export. Editing handles still works with touch, but the inspector becomes a sheet below the canvas.

## Visual direction

Warm white paper, dark ink, hairlines and precise spacing. The artwork itself is the only decoration. There are no metric tiles, gradients or constant motion.

The site tokens from `qendrimbeka.com` are the starting point: paper `#fbf8f4`, ink `#111511`, forest `#1d3a2a`. Contour has its own layout, because a drawing tool is not a page.

Type: Geist Serif for the product name, panel headings and empty states. Geist Sans for dense controls, because the brief asks for a readable sans in dense controls and small numeric labels need it. Geist Mono for numbers that must line up.

## Naming controls

Controls say what changes in the drawing, not which algorithm runs.

| Control | What it changes | Internal name |
|---|---|---|
| Height | How strongly a source lifts or sinks the lines | `height` |
| Reach | How far a source's influence extends, in units | `radius` |
| Line gap | The height difference between neighbouring lines | `levels.spacing` |
| Lines | How many lines are drawn | `levels.count` |
| First line | The height of the lowest line | `levels.base` |
| Texture | How much the lines wander | `noise.amplitude` |
| Texture size | The size of each wander | `noise.scale` |
| Line detail | How closely exported paths follow the exact lines | `export.tolerance` |

Advanced sections hold grid resolution, coordinate precision and noise octaves.

## Interaction and motion

- A drag produces one undo step.
- Motion in the interface is limited to a short fade on the status line, removed under reduced motion.
- There is no animated output in the first release. Static output is the default and the only option.

The review passes against real browser renders are recorded in `docs/REPORT.md`.
