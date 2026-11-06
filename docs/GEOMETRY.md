# Geometry

This is the specification for everything between a scene file and an exported path. The code in `src/core` follows it. If they disagree, that is a bug.

## Coordinates and units

- **Model space** is the only space geometry lives in. Origin is the top left of the domain. `x` grows right and `y` grows down, the same as SVG user space.
- **One unit** is one SVG user unit. A scene exported at its natural size renders one unit as one CSS pixel. Output width and height can scale that.
- **Height** is dimensionless. A line at level 0.5 follows the points where the field equals 0.5.
- **The domain** is the rectangle `[0, width] x [0, height]`. The field is only sampled here.
- **The frame** (`clip`) is a rectangle inside the domain. It is what gets exported by default. The domain may be larger so that you can expand the export bounds without inventing geometry.

View state (zoom, pan, CSS pixels, device scale) never enters the scene. The canvas maps model to device pixels with one transform:

```
device = dpr * (view.scale * model + view.offset)
```

Moving a window between displays changes `dpr` only. The scene and its geometry do not change.

## The field

```
F(p) = sum over enabled sources of height_i * K_i(p)  +  amplitude * N(p)
```

The supported operations are addition and subtraction. A negative height digs a basin. There is no multiplication between sources, no max and no warp in version 1.

### Peak

```
q = |p - c|^2 / R^2
K(p) = (1 - q)^3   when q < 1
K(p) = 0           otherwise
```

`K` is 1 at the centre and has continuous first and second derivatives everywhere, including at `q = 1`. Its support is compact, so a peak costs nothing beyond its reach.

### Ridge

A ridge is a curve through 2 to 16 handles. The curve is a uniform Catmull-Rom spline, flattened to 8 straight pieces per span. End tangents come from repeating the end handles. Two handles give a single straight piece.

`K` is the peak profile convolved along the curve. For one straight piece from `a` to `b`, with `u` along the piece and `d` the perpendicular distance from `p`:

```
m = 1 - d^2 / R^2                          (no contribution when m <= 0)
integrand = (m - t^2)^3                    t = distance along the piece / R
G(t) = m^3 t - m^2 t^3 + (3/5) m t^5 - t^7 / 7
K(p) = (35 / 32) * (G(t1) - G(t0))
```

`t0` and `t1` are the piece's ends clipped to `[-sqrt(m), sqrt(m)]`. The factor `35/32` makes the crest of a long straight ridge equal 1.

This is the idea behind convolution surfaces (Bloomenthal and Shirley, 1991). It is used here for two reasons:

1. A distance-to-curve field creases along the medial axis of a bend. A convolution is a sum of smooth terms, so it does not crease and the contours stay smooth.
2. Two collinear pieces sum to exactly the field of one longer piece, up to rounding. Flattening does not introduce bumps at the joints.

Ends taper to half height, which is why a ridge fades out instead of stopping at a wall. A tight bend gathers more curve inside the reach, so the crest rises there. This is intended: it reads as a mountain shoulder.

### Noise

`N` is fractal value noise, with 1 to 4 octaves. Each octave doubles frequency and halves weight. Lattice values are in `[-1, 1]` and come from an integer hash of the seed and the lattice coordinates. Between lattice points the values blend with the quintic `6t^5 - 15t^4 + 10t^3`.

Each octave is a convex combination of values in `[-1, 1]`, and the octaves are normalised by the sum of their weights. So `|N(p)| <= 1` always, and `amplitude` is a hard bound on how far texture can move the field.

### Singularities

There are none by construction. No kernel divides by distance. The only division by a varying quantity is by a ridge piece's length, and pieces shorter than `1e-9` units contribute nothing. `R` is at least 1 by validation. Every term is finite for finite input.

### Bounds

For peaks, `|K| <= 1`. For a ridge, `|K| <= (35/32) * L / R` where `L` is the curve length within reach. So `|F|` has a finite bound for any valid scene, which the validator's ranges keep well inside double precision.

### Repeatability

The field uses only `+`, `-`, `*`, `/`, `sqrt` and 32-bit integer multiply. IEEE 754 requires the first five to be correctly rounded and `Math.imul` is exact. There is no `sin`, `exp` or `pow`, whose results may differ between engines. So the same scene gives bit-identical samples on any compliant JavaScript engine. Grid sampling and pointwise evaluation add terms in the same order, so they also match exactly.

## Levels

```
L_k = base + k * spacing,   k = 0 .. count - 1
```

`spacing` is positive and `count` is at most 128.

## Sampling

The domain is divided into `nx` by `ny` cells. `resolution` is the cell count along the long side. The short side gets `round(resolution * short / long)` cells, at least 1. Samples sit at cell corners, so a 512 by 512 scene has 513 by 513 samples. Sample `i` is at `x = i * width / nx`. Dividing last makes the last sample land exactly on `width`.

## Contour extraction

Extraction is marching squares (Lorensen and Cline, 1987, in two dimensions).

### Tie policy

A corner is **above** when its value is strictly greater than the level. Otherwise it is **below**. This is the same as raising the level by an infinitely small amount, so every level acts as a regular value. Consequences:

- A flat field at exactly the level gives no contour.
- A plateau at exactly the level is treated as below, so its outline is drawn where the field rises above it.
- When a corner equals the level, the crossing lands exactly on that corner. Duplicate points are then removed (see below).

### Shared edge coordinates

Every crossing lies on a grid edge. Its position is computed by one function from that edge's two corners, always in index order, so it does not depend on which cell asks. Neighbouring cells therefore share a crossing exactly. Cracks cannot occur because there is only one number to agree on.

### Ambiguous cells

A cell with above corners on one diagonal and below corners on the other has two valid pairings. I resolve these with the asymptotic decider (Nielson and Hamann, 1991). The bilinear interpolant of the cell has one saddle, and the saddle's value relative to the level picks the pairing that matches the interpolant's real topology.

With `g = f - L` at corners `a`, `b`, `c`, `d`, the saddle is above the level when:

```
(ga*gc - gb*gd) / (ga + gc - gb - gd) > 0
```

In an ambiguous cell the denominator can never be zero: two corners are strictly positive and two are at most zero. So the code compares the sign of the numerator, flipped by which diagonal is above, and needs no division. An exact tie counts as below, the same rule as for corners.

The decision uses only that cell's four corners. This is safe across cells because the pairing changes only how a cell's own crossings connect, never where they are.

### Orientation

Every segment is oriented with the above side on its left when viewed on screen. This makes joining simple and gives tests a property they can check against the true field.

## Path assembly

Joining uses no distance tolerance. Each crossing has an integer edge id. A segment ends on the edge where the next segment starts. An edge holds at most one incoming and one outgoing segment, and the code throws if that is violated. Since matching is by id, two close but separate strands can never be joined by mistake.

Paths that reach the domain boundary are open. The rest are closed loops, stored without repeating the first point.

Then:

1. Consecutive points that are exactly equal are removed. These only arise from ties.
2. A closed path with fewer than 3 distinct points, or an open path with fewer than 2, is degenerate. It has no length or area, so it is dropped and counted in the stats.

Tiny but non-zero segments are kept here. They are valid geometry, and simplification handles them under its error bound.

## Clipping

Paths are clipped to the output rectangle with Liang-Barsky, segment by segment. A closed loop that crosses the rectangle is rotated to start outside, so that its fragments come out whole. A point on the rectangle's edge counts as inside.

The output rectangle is the frame. With expanded bounds it is the frame grown by the margin, then limited to the domain. If the domain stops the growth, the export reports that the margin was reduced.

## Simplification

Simplification is Douglas-Peucker (1973) using distance to the segment, not to the infinite line. The closed-loop version splits at vertex 0 and the vertex farthest from it.

### The error bound

Let `A` be a run of the original polyline and `c` the chord that replaced it, with tolerance `e`.

- **`A` to `c`.** Distance to a segment is convex along a straight line, so its maximum on each edge of `A` is at a vertex. Douglas-Peucker checked every vertex. So every point of `A` is within `e` of `c`.
- **`c` to `A`.** Take a point `x` on `c`. Walk along `A`. Its projection onto `c` moves continuously from one end of `c` to the other, so some point `y` on `A` projects to `x`. `y` is within `e` of `c`, and its nearest point on `c` is `x`, so `|x - y| <= e`.

So the Hausdorff distance between the simplified path and the path it replaced is at most `e`. This is a proof, not a measurement.

Rounding to `d` decimals moves each vertex by at most `q = sqrt(2)/2 * 10^-d`. Moving both ends of a segment by at most `q` moves every point on it by at most `q`. So the declared bound for a path is `e + q`.

This bound is against the **extracted** polyline. The distance to the true isoline of `F` also includes grid error, which depends on resolution and is reported separately:

| Error | Meaning | Status |
|---|---|---|
| Simplification plus rounding | Exported path against extracted path | Proved bound `e + q`, per path |
| Measured export error | Parsed SVG against extracted path | Sampled estimate, with a conservative guard below |
| Grid error | Extracted path against the true isoline | Sampled first-order estimate, checked against a 2048 cell reference in the benchmark |

### Sampled checks

`sampledHausdorff(A, B, spacing)` walks both sets of paths and places samples no more than `spacing` apart along arc length. It returns the largest distance from a sample to the other set.

This is a lower estimate of the true value. Distance to a set changes at most 1:1 along a path, and every point is within `spacing / 2` of a sample. So `sampled + spacing / 2` is a true upper bound, which the report calls the **guard**.

### Grid error estimate

At sample points on an extracted path, the first-order distance to the true isoline is `|F(p) - L| / |grad F(p)|`. The gradient comes from central differences. Points where the gradient is near zero are skipped and counted. This is an estimate. It is not used as a guarantee.

## Topology rules

The output must be topologically the same as the extracted lines, which have no crossings. Let `q` be a path's rounding bound. A first version of these rules left rounding out. An independent review found rounded paths that crossed through a shared vertex or swapped sides, so rule 1 is now stated with `q`.

1. **Separation.** Two different output paths stay more than `2(q_a + q_b)` apart. A path never touches itself, apart from neighbouring segments sharing a point. A contact includes a crossing through a vertex, a touch and a collinear overlap.
2. **No lost loops.** A closed path keeps at least 3 vertices and the sign of its area.
3. **Nothing swept.** When a chord replaces a run of points, the region between them contains no vertex of any original path. Without this, a small loop could end up on the wrong side of a neighbour with no contact to reveal it. Saalfeld (1999) describes this failure of plain Douglas-Peucker.

Rules 1 and 3 are conservative. They can refuse something that would have been fine. That costs a few bytes and never correctness.

### Why these rules are enough

The argument has two steps: from the extracted lines to the simplified paths before rounding, then to the rounded output.

**Simplification.** Suppose no original vertex lies in a swept region, and a straight original edge entered that region. It could only leave through the chord or the replaced run. It cannot cross the run, since originals do not cross. A straight edge cannot cross the straight chord twice. So no original edge enters, and each simplified path relates to the original paths as before. Two simplified paths could still cross each other: chords of neighbouring paths can meet with nothing swept. A test scene shows this happening, and rule 1 catches it.

**Rounding.** Take two paths with output distance `d > 2(q_a + q_b)`. Rounding moved each point by at most its `q`, so before rounding they were at least `d - q_a - q_b > q_a + q_b` apart. Move each vertex in a straight line to its rounded position. No point travels further than its `q`, so at no moment do the two paths touch. A continuous motion with no contact cannot change which side one path is on. So rounding keeps the arrangement.

A path is not compared with itself at a clearance. Its neighbouring segments share ends and can be short, and the arrangement between paths does not depend on it. It only has to stay simple, which the exact contact test checks.

### Limits

Rule 1 is judged on doubles, without exact arithmetic. At the end of the ladder paths sit on a `1e-6` lattice, so two paths closer than about `3e-6` units may fail rule 1 with nothing left to tighten. The output is then checked for exact contact. Two strands that meet at a tied corner in the extracted lines are allowed to meet in the output, and any other contact is reported to the user as a crossing.

### Fallback

A path that breaks a rule retries with tighter settings. Each step divides the tolerance by 4 and adds one decimal. After three steps it is retained unsimplified at 6 decimals. Each path carries its final tolerance and decimals, so the declared bound stays true per path. The export reports how many paths fell back. The loop only ends after a check that changed nothing, so the reported count always describes the final output.

A loop smaller than the `1e-6` lattice cannot be written as a loop at all. It rounds to a point, so it is dropped and counted with the degenerate paths.

### Resource limit

A run stops with a clear message once it passes 20 million extracted vertices. That is about 160 MB of coordinates, and past what a browser can hold as a single SVG string.

## SVG output

Allowed elements: `svg`, `title`, `rect`, `g`, `path`. There are no scripts, styles, external references, metadata or scene data.

Path data uses `M`, `l` and `L`, and `z` for closed paths. Relative commands are smaller, but renderers keep coordinates in 32-bit floats, so a long run of relative moves can drift. An absolute `L` every 64 nodes limits that drift. For coordinates up to 8192, one 32-bit rounding is at most 0.0005 units. Over 64 commands the drift is at most 0.03 units in the worst case. In practice this is a very loose bound, since rounding errors do not all point the same way, and the cross-renderer check in the report measures the real size.

## References

- W. E. Lorensen, H. E. Cline. Marching cubes: a high resolution 3D surface construction algorithm. SIGGRAPH 1987.
- G. M. Nielson, B. Hamann. The asymptotic decider: resolving the ambiguity in marching cubes. Visualization 1991.
- D. H. Douglas, T. K. Peucker. Algorithms for the reduction of the number of points required to represent a digitized line or its caricature. The Canadian Cartographer 10(2), 1973.
- A. Saalfeld. Topologically consistent line simplification with the Douglas-Peucker algorithm. Cartography and Geographic Information Science 26(1), 1999.
- L. Liang, B. Barsky. A new concept and method for line clipping. ACM TOG 3(1), 1984.
- J. Bloomenthal, K. Shirley. Convolution surfaces. SIGGRAPH 1991.
