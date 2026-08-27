# Resume framing

Your original draft:

> **Mahjong Detection Model and Scoring App - Personal Project:** Develop a
> computer-vision pipeline using a custom detection model to identify and
> spatially order Mahjong tiles from images, producing structured inputs for
> automated hand analysis and scoring • Implemented an end-to-end workflow that
> converts photographed tile layouts into scoring-ready data for rapid hand
> evaluation

It describes the right project. What it lacks is anything a reader can weigh:
no architecture, no numbers, and two bullets that say the same thing twice.
Below is the same claim with the specifics filled in — all of them from
`docs/model-card.md`, so every figure is defensible in an interview.

---

## Three bullets

**Mahjong Tile Detection & Scoring App** — *Personal project · Python, PyTorch,
ONNX, TypeScript, React Native*

- Designed and trained a **two-stage computer-vision pipeline** that reads a
  mahjong hand from a single photograph: a custom anchor-free tile detector
  (289K parameters) followed by a 42-class tile classifier (159K), both written
  from scratch in PyTorch and trained on **7,200 procedurally generated scenes**
  after finding no usable public dataset. Achieves **0.995 AP@0.5** detection
  and **99.98% per-tile classification** on a held-out split; **90.8% of hands
  are read completely correctly**, end to end.
- Built the **spatial ordering** stage that turns unordered detections into a
  readable hand — estimating table rotation from nearest-neighbour geometry so
  that tilted photographs still resolve into correct rows and melds, where a
  naive coordinate sort interleaves them — and fed the result into a
  **TypeScript rules engine** implementing **99 scoring patterns** across
  Taiwanese, Hong Kong, Japanese Riichi and Chinese Official rule systems, with
  user-definable custom rulesets.
- Shipped it as an **offline Expo/React Native app** running both models
  on-device through ONNX Runtime — **under 2 MB of weights, ~45 ms per
  photograph** — and guarded the Python/TypeScript boundary with **generated
  shared constants and preprocessing parity tests**, which caught two real
  train/inference mismatches before they reached a device.

## Two bullets, if space is tight

- Built a **two-stage CV pipeline** (custom anchor-free detector + 42-class
  classifier, both trained from scratch in PyTorch on 7,200 procedurally
  generated scenes) that reads a mahjong hand from a photograph at **0.995
  AP@0.5** and **99.98% per-tile accuracy**, recovering reading order from
  detection geometry so tilted photographs still group into correct rows and
  melds.
- Shipped it as an **offline React Native app** running both models on-device
  via ONNX Runtime (**<2 MB, ~45 ms/photo**), backed by a **TypeScript rules
  engine covering 99 scoring patterns across four regional rule systems** with
  user-definable custom rulesets.

## One line, for a projects list

> **Mahjong Scorer** — Two-stage CV pipeline (custom PyTorch detector +
> classifier, trained on synthetic data, 0.995 AP@0.5) reading mahjong hands
> from photographs, with an offline React Native app and a 99-pattern scoring
> engine covering four rule systems.

---

## Notes on the numbers

Everything above is reported in `docs/model-card.md` and reproducible from
`ml/src/evaluate.py`. Two points worth having ready:

**"90.8% of hands read completely correctly" is the honest headline, not
99.98%.** A seventeen-tile hand is seventeen independent chances to be wrong.
Leading with the per-tile figure would be the sort of thing an interviewer
enjoys catching; leading with the harder number and explaining the arithmetic is
better.

**Be ready for "why synthetic data?"** The real answer is that no public
annotated mahjong dataset was reachable, and that generation turned out to be
better anyway — exact labels, controllable class balance, and every nuisance
factor as a parameter. The honest caveat, which is in the model card, is that
the models have only ever seen rendered tiles. A few dozen photographs of a
physical set, used as a calibration and evaluation set, is the obvious next
step and a good thing to say you know you'd do next.
