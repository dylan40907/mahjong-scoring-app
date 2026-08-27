# Architecture

## The shape of the problem

A photograph of a winning hand has to become a score. Between those two points
there are three distinct problems that want different tools:

1. **Where are the tiles?** Geometry. A tile is a pale high-contrast rectangle
   on a dark table, at a fixed 3:4 aspect. Easy.
2. **Which tile is each one?** Fine-grained recognition over a closed set of 42
   glyphs. Harder, and it depends on detail measured in pixels.
3. **What is the hand worth?** Combinatorics and a rulebook. Not a vision
   problem at all.

Most of the design follows from keeping these apart.

## Why two models instead of one

The obvious approach is a single 42-class detector. It fails on arithmetic.

A photograph of a sixteen-tile row is about twelve tile-heights wide. Fed to a
detector at 320 pixels, each tile is roughly 20 pixels wide and 27 tall — and
the difference between a seven of characters and an eight of characters lives
in a few strokes occupying maybe eight of those pixels. To make that legible
the detector would have to run at 1000+ pixels, which is a different class of
model and a different training budget.

Splitting the problem removes the conflict:

- The **detector** runs at 320 pixels and answers only "where is a tile". At
  that resolution a tile is still obviously a tile. One class, anchor-free,
  289k parameters.
- The **classifier** never sees the whole photograph. It sees one tile at a
  time, cropped from the *full-resolution* image and resized to 48×64, where
  the engraving is a hundred pixels tall. 159k parameters.

Total: under 2 MB, both trainable on two CPU cores overnight, both fast enough
to run on a phone without a GPU delegate.

It also matches the failure modes a person can repair. A missing box is visible
in the review overlay and fixed by tapping "add tile"; a misread tile is fixed
from a shortlist the classifier already produced.

## The detector

A CenterNet-style anchor-free head on a small depthwise-separable backbone,
predicting on a stride-4 grid:

- a **centre heatmap** (1 channel), trained with penalty-reduced focal loss
  against Gaussian-splatted targets;
- **box size** in pixels (2 channels), L1 at positive locations only;
- a **sub-cell offset** (2 channels), likewise.

Anchor-free suits this problem specifically: every box is the same 3:4 shape
because a tile is a physical object, so anchor priors have nothing to buy.

Decoding uses a 3×3 max-pool as non-maximum suppression — a cell survives if it
is the strongest in its neighbourhood. This matters more than it sounds.
IoU-based NMS would be actively wrong here: tiles in a hand touch edge to edge,
and neighbouring boxes overlap enough that standard NMS deletes real tiles.

The decode is exported *inside* the ONNX graph, so the app receives boxes and
scores rather than three feature maps to post-process. Peak-finding implemented
twice is peak-finding implemented differently.

## The classifier

Four separable-convolution stages, global average pool, one linear layer to 42
classes. Deliberately small: the task is closer to OCR over a fixed alphabet
than to open-world recognition. The crops are axis-aligned, roughly
scale-normalised, and drawn from a set with no intra-class variation beyond
print and lighting. Extra capacity would go into memorising synthetic noise.

Training crops are cut from the ground-truth boxes of the same synthetic
scenes, with position and scale jitter standing in for the detector's
localisation error. Training the classifier on clean, perfectly-cropped tiles
would teach it to expect something inference never provides.

## Synthetic data

No public annotated mahjong dataset was reachable from the build environment —
Roboflow, Kaggle and HuggingFace are all blocked by the network proxy. The
training set is therefore generated, and that turns out to be the better option
anyway: labels are exact by construction, rare tiles can be oversampled, and
every nuisance factor becomes a parameter.

A scene is built in four stages, each carrying the tile corner points through
the same transform so the ground truth stays exact:

1. **Layout.** Tiles are placed on a flat virtual table in hand-like
   arrangements — a single row, a row with melds set apart, two rows, or a spread
   of flowers and seasons. Spacing, jitter and per-tile rotation are sampled.
2. **Camera.** One composed homography applies perspective (a phone held over a
   table, tilted up to about 35°), roll, and a framing crop. Composing first
   means each tile is resampled exactly once — resampling twice turns the
   engraving on a 40-pixel tile to mush.
3. **Surface and shadow.** A procedural felt, wood or cloth table, with a soft
   contact shadow under the tiles.
4. **Camera degradation.** Uneven lighting, vignetting, white-balance drift,
   glare, motion or focus blur, sensor noise, JPEG. Hands, sleeves and cast
   shadows intrude from the frame edge about a third of the time.

Class balance falls out of the sampling: hands are drawn without replacement
from a real 144-tile wall, and a tenth of scenes are deliberately
flower-and-season heavy, since bonus tiles are only 8 of 144 and would otherwise
be starved.

## Spatial ordering

This is the step the resume line calls "spatially order", and the naive version
is wrong in a way that only shows up in real use.

Sorting by y and then x works until the phone is not square to the table. A row
of fourteen tiles tilted twelve degrees climbs about 108 pixels end to end —
more than a tile is tall, and more than the gap between two rows. The tail of
the upper row is then lower in the image than the head of the lower one, and
any y-first sort interleaves them.

So the orientation is measured rather than assumed. Each tile contributes the
vector to its nearest neighbour; within a row that vector runs along the row, so
the angles pile up around the true direction and the few cross-row neighbours
become outliers a median discards. Everything is rotated flat, and ordering is
trivial again.

Grouping then falls out of spacing: tiles in a meld touch, and a meld is set
apart from the concealed hand by a visible gap. Half a tile width separates the
two cases. Groups of exactly three or four that are set apart are proposed as
exposed melds — and the review screen lets the player overrule that, which is
the right division of labour. Geometry proposes; the player confirms.

## The scoring engine

Pure TypeScript, no React, no I/O — which is why it is the part with the
heaviest test coverage.

**Decomposition** enumerates every valid reading of a hand rather than finding
one. `111222333` in a suit is genuinely both three triplets and three identical
runs, and which is worth more depends on the ruleset. Scoring runs against every
reading and keeps the best, which is both what the rules intend and what a
player would do for themselves.

**Patterns** are a library of ~99 detectors keyed by stable id, each answering
"how many times does this apply" against one reading. They know nothing about
values.

**Rulesets** are data: a map from pattern id to what it is worth here, plus a
payout model. That is the entire difference between Taiwanese and Hong Kong
scoring. It is also what makes user-authored rulesets possible without shipping
code — a custom ruleset is the same object as a built-in one.

**Supersession** implements the non-repeat principle. A pattern declares what
it absorbs: Big Three Dragons absorbs the Dragon Pungs it is made of rather
than scoring alongside them.

**Payouts** are four separate functions, because the shared abstraction would
be a switch statement wearing a hat. Taiwanese adds a base to a per-tai rate and
makes a discarder pay alone; Hong Kong doubles faan into a table that flattens
at the top; Riichi multiplies fu by two to the power of the han and clamps in
five steps; MCR adds points and charges everyone a flat eight.

## Guarding the seam

Two mechanisms keep the Python and TypeScript halves from drifting:

**Generated constants.** `mobile/src/tiles/tileset.ts` and the bundled asset
map are emitted from `ml/src/tileset.py`. The classifier's output layer is
indexed by position in that table; an edit on one side without the other would
silently relabel every prediction, and it would look like a bad model rather
than a bad constant.

**Preprocessing parity tests.** `ml/src/make_parity_fixtures.py` writes
reference tensors from the exact code that fed the model during training, and
the app's TypeScript preprocessing is asserted against them. This caught two
real defects: the app was sampling nearest-neighbour where training
area-averaged, and it was keeping float precision where OpenCV had quantised to
a byte. Both would have shown up only as unexplained accuracy loss on a device.

## What runs where

| Stage | Where | Why |
|---|---|---|
| Decode photo | JS (`jpeg-js`) | One decode at 1280px serves both the detector and every crop |
| Detect | ONNX Runtime, native | 320×320 letterbox, ~1 MB model |
| Crop + classify | JS crop, ONNX batch | Crops come from full resolution, batched in one call |
| Order | JS | Pure geometry, unit tested |
| Score | JS | Pure functions, unit tested |

Nothing leaves the device, and nothing needs a network.
