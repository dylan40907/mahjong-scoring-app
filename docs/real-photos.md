# Photographing a real tile set

How to add photographs of your own tile set, for evaluation or fine-tuning.
Build the evaluation set before the training set, so the gap between rendered
and real tiles is measured before anything is trained on it.

## Why labelling is cheap here

The usual cost of real data is drawing boxes. Four hundred photographs is
roughly five thousand boxes, which is the reason this task stays on a to-do list
forever.

It is avoidable. If you already know *which* tiles are in a photograph and in
what order, the only missing information is where they are — and the current
detector is good enough at positions to propose them. `ingest_photos.py` runs
the detector, sorts the boxes into reading order, and zips them against the
sequence you supply. Labelling becomes flicking through review renders and
deleting the bad ones.

The count gate is what makes this safe. If the detector finds fifteen tiles
where you said there were fourteen, zipping would shift every later label by
one — mislabelled data that still looks fine in aggregate. Those photos are
refused and listed in `rejected.json` instead.

## Shoot 1: the face sheet

`docs/images/face-sheet.png` shows all 42 faces in the frozen class order, with
indices beneath. Arrange your tiles to match it, then photograph the *same
layout* fifteen times while varying one thing at a time — surface, light,
angle, focus. Every shot shares one label sequence, so fifteen photographs cost
one command.

```bash
cd ml
python src/ingest_photos.py \
  --images photos/face_sheet --sequence face-sheet \
  --out data/real/face_sheet --review data/real/face_sheet/review --runs runs
```

Roughly 630 real crops covering all 42 classes, including the flowers and
seasons that are 8 of 144 in a natural draw and would otherwise barely appear.
This alone is enough to fine-tune the classifier.

## Shoot 2: hands

Real arrangements, one line per photo in a labels file:

```
# photos/hands/labels.txt
IMG_4103.jpg: man1,man1,man1,pin4,pin5,pin6,sou7,sou8,sou9,east,east,east,red,red
IMG_4104.jpg: pin2,pin3,pin4,...
```

```bash
python src/ingest_photos.py \
  --images photos/hands --labels photos/hands/labels.txt \
  --out data/real/hands --review data/real/hands/review --runs runs
```

Vary what `synth.py` varies, so the comparison is like for like: layout (single
row, row with melds set apart, two rows, bonus spread), surface (felt, wood,
cloth), framing (whole hand, three-quarters, close), light (daylight, tungsten,
dim, with glare), and a hand or sleeve intruding on about a third. Keep the
deliberately hard cases — tiles clipped by the frame edge, tiles standing in a
rack or face down — in a separate folder. Those measure known failure modes and
should not be trained on yet.

## What the output is good for

`ingest_photos.py` writes the same `annotations.json` schema `synth.py` does, so
`evaluate.py`, `build_crops.py` and both trainers read it with no changes.

| Use | Valid? |
|---|---|
| Classifier accuracy on real tiles | Yes — the labels are independent |
| Classifier fine-tuning | Yes |
| Detector fine-tuning | Yes — loose boxes are a tolerable training signal |
| **Detection AP / precision / recall** | **No** — see below |

The boxes come from the detector, so detection metrics computed against them
score the detector against its own opinion. It returns 1.0 whatever the truth
is. To measure detection honestly, correct the boxes by hand in a labelling
tool first, or read the count gate's rejection rate as a proxy: the fraction of
photographs where the detector found exactly the right number of tiles is a
real, independent measurement, because you know the true count.

That rejection rate is the single most informative number from the first shoot.

## Human review

Every photo gets a render with its boxes and assigned labels drawn on, green
where the classifier agreed with the known layout and red where it did not. Go
through them, delete any that are wrong, and re-run to keep only the survivors:

```bash
python src/ingest_photos.py \
  --images photos/face_sheet --sequence face-sheet \
  --out data/real/face_sheet --accept-from data/real/face_sheet/review --runs runs
```

## The public dataset

There is one, and it is a good fit. Jon Chan's mahjong dataset on Roboflow
Universe is CC BY 4.0, 3,506 real photographs, and — unusually — **42 classes
with the same taxonomy as this project**, flowers and seasons included. Most
public mahjong datasets are 34-class Riichi sets that omit exactly the bonus
tiles the Taiwanese and Hong Kong rulesets need.

    https://universe.roboflow.com/jon-chan-gnsoa/mahjong-baq4s

Sample images are photographs of physical tiles on green mats, wooden desks and
carpet, with arms and clutter in frame. Several show tiles standing edge-on,
which `synth.py` never produces.

Two properties of the export drive the import defaults:

**Only `valid` and `test` are clean.** Roboflow augments the train split only,
three outputs per source image including a *vertical* flip. A vertically
flipped tile face is not a tile face — the same reason `data.py` allows
horizontal flip for the detector and refuses it for the classifier. So
`import_yolo.py` defaults to `--splits valid test`: 1,356 un-augmented photos.

**The boxes are human-drawn.** This is the only source in the project that can
honestly measure detection AP on real photographs, because the boxes did not
come from our own detector.

Downloading needs a Roboflow API key. It is read from the environment and never
written to disk — passing it as a command-line argument is deliberately not
supported, because arguments land in shell history and a per-session
environment variable does not.

```bash
cd ml
python src/fetch_public_dataset.py
```

That downloads, imports valid + test, writes the verification sheet, and runs
the evaluation. The steps are also available separately:

```bash
python src/import_yolo.py --root downloads/mahjong-83 --out data/real/public_test \
  --merge --splits test --contact-sheet ../docs/images/public-classes.png
python src/evaluate.py --roots data/real/public_test --runs runs
```

### Attribution

The dataset is CC BY 4.0, which requires credit wherever a model trained on it
is distributed. Cite it as: Jon Chan, *Mahjong Dataset*, Roboflow Universe,
`https://universe.roboflow.com/jon-chan-gnsoa/mahjong-baq4s`.

### Check the contact sheet first

The suit letters (B bamboo, C characters, D dots) are unambiguous. The flower
and season *numbering* is not: `1F`–`4F` is assumed to follow 梅蘭菊竹 and
`1S`–`4S` to follow 春夏秋冬, matching `tileset.py`. `--contact-sheet` renders
real crops grouped under the label the mapping assigns them, with the bonus
rows highlighted. If `flower_plum` shows an orchid, the mapping is wrong and
eight classes are quietly corrupted. Look before training.

## One set is not enough

Fine-tuning on a single physical set risks trading "only ever seen rendered
tiles" for "only ever seen *this* set". A second set — a cheap travel one will
do — held out entirely for evaluation is the difference between believing the
gap is closed and knowing it.
