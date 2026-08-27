"""Train the tile detector.

Runs on CPU by design - the whole point of the two-stage split is that the
detector can be small enough to train without a GPU. Training is checkpointed
every epoch and bounded by a wall-clock budget so an interrupted run resumes
rather than restarting.
"""

from __future__ import annotations

import argparse
import json
import math
import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn.functional as F
from torch.utils.data import DataLoader, Subset

sys.path.insert(0, str(Path(__file__).parent))
from data import SceneDataset, collate_scenes  # noqa: E402
from models import TileDetector, decode, focal_loss, regression_loss, count_parameters  # noqa: E402


# --------------------------------------------------------------------------
# Evaluation
# --------------------------------------------------------------------------

def box_iou(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """Pairwise IoU between (N,4) and (M,4) boxes in xyxy."""
    area_a = np.clip(a[:, 2] - a[:, 0], 0, None) * np.clip(a[:, 3] - a[:, 1], 0, None)
    area_b = np.clip(b[:, 2] - b[:, 0], 0, None) * np.clip(b[:, 3] - b[:, 1], 0, None)

    lt = np.maximum(a[:, None, :2], b[None, :, :2])
    rb = np.minimum(a[:, None, 2:], b[None, :, 2:])
    wh = np.clip(rb - lt, 0, None)
    overlap = wh[..., 0] * wh[..., 1]
    union = area_a[:, None] + area_b[None, :] - overlap
    return overlap / np.clip(union, 1e-9, None)


def average_precision(
    predictions: list[tuple[np.ndarray, np.ndarray]],
    truths: list[np.ndarray],
    iou_threshold: float = 0.5,
) -> dict[str, float]:
    """Single-class AP by the standard greedy-match, all-point-interpolation
    protocol, plus metrics that matter more for this application than AP does.

    A hand is only scoreable if every tile is found, so `exact_count` - the
    fraction of scenes where the detector returns precisely the right number
    of boxes at the operating threshold - is reported alongside AP.
    """
    rows: list[tuple[float, int]] = []
    total_truth = 0
    exact_count_hits = 0
    operating_threshold = 0.35

    for (boxes, scores), truth in zip(predictions, truths):
        total_truth += len(truth)
        order = np.argsort(-scores)
        boxes, scores = boxes[order], scores[order]

        matched = np.zeros(len(truth), bool)
        if len(truth) and len(boxes):
            ious = box_iou(boxes, truth)
        else:
            ious = np.zeros((len(boxes), len(truth)))

        for i, score in enumerate(scores):
            hit = 0
            if len(truth):
                candidates = np.where(~matched & (ious[i] >= iou_threshold))[0]
                if len(candidates):
                    best = candidates[np.argmax(ious[i][candidates])]
                    matched[best] = True
                    hit = 1
            rows.append((float(score), hit))

        if (scores >= operating_threshold).sum() == len(truth):
            exact_count_hits += 1

    if not rows or total_truth == 0:
        return {"ap50": 0.0, "precision": 0.0, "recall": 0.0, "exact_count": 0.0}

    rows.sort(key=lambda r: -r[0])
    hits = np.array([r[1] for r in rows], np.float32)
    confidences = np.array([r[0] for r in rows], np.float32)

    tp = np.cumsum(hits)
    fp = np.cumsum(1 - hits)
    recall = tp / total_truth
    precision = tp / np.maximum(tp + fp, 1e-9)

    # All-point interpolation.
    mrec = np.concatenate([[0.0], recall, [1.0]])
    mpre = np.concatenate([[0.0], precision, [0.0]])
    for i in range(len(mpre) - 2, -1, -1):
        mpre[i] = max(mpre[i], mpre[i + 1])
    indices = np.where(mrec[1:] != mrec[:-1])[0]
    ap = float(np.sum((mrec[indices + 1] - mrec[indices]) * mpre[indices + 1]))

    keep = confidences >= operating_threshold
    if keep.any():
        op_tp = hits[keep].sum()
        op_precision = float(op_tp / keep.sum())
        op_recall = float(op_tp / total_truth)
    else:
        op_precision = op_recall = 0.0

    return {
        "ap50": ap,
        "precision": op_precision,
        "recall": op_recall,
        "exact_count": exact_count_hits / len(truths),
    }


@torch.no_grad()
def evaluate(model: TileDetector, loader: DataLoader, max_batches: int | None = None) -> dict[str, float]:
    model.eval()
    predictions, truths = [], []
    for i, batch in enumerate(loader):
        if max_batches is not None and i >= max_batches:
            break
        heatmap, size, offset = model(batch["image"])
        boxes, scores = decode(heatmap, size, offset)
        for b in range(len(boxes)):
            predictions.append((boxes[b].numpy(), scores[b].numpy()))
            truths.append(batch["boxes"][b].numpy())
    model.train()
    return average_precision(predictions, truths)


# --------------------------------------------------------------------------
# Training
# --------------------------------------------------------------------------

def build_scheduler(optimiser, total_steps: int, warmup: int):
    def curve(step: int) -> float:
        if step < warmup:
            return (step + 1) / max(1, warmup)
        progress = (step - warmup) / max(1, total_steps - warmup)
        return 0.5 * (1 + math.cos(math.pi * min(1.0, progress)))

    return torch.optim.lr_scheduler.LambdaLR(optimiser, curve)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--train-roots", type=Path, nargs="+", required=True)
    parser.add_argument("--val-root", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--input-size", type=int, default=320)
    parser.add_argument("--width", type=int, default=32)
    parser.add_argument("--batch-size", type=int, default=16)
    parser.add_argument("--steps-per-epoch", type=int, default=180)
    parser.add_argument("--epochs", type=int, default=26)
    parser.add_argument("--lr", type=float, default=2.5e-3)
    parser.add_argument("--weight-decay", type=float, default=1e-4)
    parser.add_argument("--size-weight", type=float, default=0.1)
    parser.add_argument("--offset-weight", type=float, default=1.0)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--max-hours", type=float, default=6.0)
    parser.add_argument("--eval-batches", type=int, default=16)
    parser.add_argument("--seed", type=int, default=0)
    args = parser.parse_args()

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    torch.set_num_threads(args.threads)
    args.out.mkdir(parents=True, exist_ok=True)

    train_set = SceneDataset(list(args.train_roots), args.input_size, train=True)
    val_set = SceneDataset([args.val_root], args.input_size, train=False)

    train_loader = DataLoader(
        train_set, batch_size=args.batch_size, shuffle=True, num_workers=args.workers,
        collate_fn=collate_scenes, drop_last=True, persistent_workers=args.workers > 0,
    )
    val_loader = DataLoader(
        val_set, batch_size=args.batch_size, shuffle=False, num_workers=args.workers,
        collate_fn=collate_scenes, persistent_workers=args.workers > 0,
    )

    model = TileDetector(width=args.width)
    optimiser = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)
    total_steps = args.epochs * args.steps_per_epoch
    scheduler = build_scheduler(optimiser, total_steps, warmup=min(300, total_steps // 12))

    checkpoint_path = args.out / "detector_last.pt"
    best_path = args.out / "detector_best.pt"
    history_path = args.out / "detector_history.json"

    start_epoch, best_ap, history = 0, 0.0, []
    if checkpoint_path.exists():
        state = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
        model.load_state_dict(state["model"])
        optimiser.load_state_dict(state["optimiser"])
        scheduler.load_state_dict(state["scheduler"])
        start_epoch = state["epoch"] + 1
        best_ap = state["best_ap"]
        history = state.get("history", [])
        print(f"Resumed from epoch {start_epoch} (best AP50 {best_ap:.4f})")

    print(f"detector: {count_parameters(model):,} params, input {args.input_size}")
    print(f"train scenes: {len(train_set):,}  val scenes: {len(val_set):,}")

    deadline = time.time() + args.max_hours * 3600
    iterator = iter(train_loader)
    stopped_early = False

    for epoch in range(start_epoch, args.epochs):
        model.train()
        epoch_start = time.time()
        totals = {"loss": 0.0, "hm": 0.0, "size": 0.0, "off": 0.0}

        for step in range(args.steps_per_epoch):
            try:
                batch = next(iterator)
            except StopIteration:
                iterator = iter(train_loader)
                batch = next(iterator)

            heatmap, size, offset = model(batch["image"])
            hm_loss = focal_loss(heatmap, batch["heatmap"])
            size_loss = regression_loss(size, batch["size"], batch["mask"])
            off_loss = regression_loss(offset, batch["offset"], batch["mask"])
            loss = hm_loss + args.size_weight * size_loss + args.offset_weight * off_loss

            optimiser.zero_grad(set_to_none=True)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), 5.0)
            optimiser.step()
            scheduler.step()

            totals["loss"] += loss.item()
            totals["hm"] += hm_loss.item()
            totals["size"] += size_loss.item()
            totals["off"] += off_loss.item()

            if (step + 1) % 40 == 0:
                done = step + 1
                print(
                    f"  epoch {epoch} step {done}/{args.steps_per_epoch} "
                    f"loss {totals['loss'] / done:.4f} "
                    f"(hm {totals['hm'] / done:.4f} size {totals['size'] / done:.3f} "
                    f"off {totals['off'] / done:.4f}) "
                    f"lr {scheduler.get_last_lr()[0]:.2e}",
                    flush=True,
                )

        metrics = evaluate(model, val_loader, max_batches=args.eval_batches)
        elapsed = time.time() - epoch_start
        entry = {
            "epoch": epoch,
            "loss": totals["loss"] / args.steps_per_epoch,
            "seconds": round(elapsed, 1),
            **{k: round(v, 4) for k, v in metrics.items()},
        }
        history.append(entry)
        print(
            f"epoch {epoch}: loss {entry['loss']:.4f}  AP50 {metrics['ap50']:.4f}  "
            f"P {metrics['precision']:.3f}  R {metrics['recall']:.3f}  "
            f"exact-count {metrics['exact_count']:.3f}  [{elapsed / 60:.1f} min]",
            flush=True,
        )

        state = {
            "model": model.state_dict(),
            "optimiser": optimiser.state_dict(),
            "scheduler": scheduler.state_dict(),
            "epoch": epoch,
            "best_ap": best_ap,
            "history": history,
            "args": vars(args) | {k: str(v) for k, v in vars(args).items() if isinstance(v, Path)},
        }
        torch.save(state, checkpoint_path)
        history_path.write_text(json.dumps(history, indent=2))

        if metrics["ap50"] > best_ap:
            best_ap = metrics["ap50"]
            state["best_ap"] = best_ap
            torch.save(
                {"model": model.state_dict(), "metrics": metrics, "epoch": epoch,
                 "input_size": args.input_size, "width": args.width},
                best_path,
            )
            torch.save(state, checkpoint_path)
            print(f"  new best AP50 {best_ap:.4f} -> {best_path.name}", flush=True)

        if time.time() > deadline:
            print(f"Wall-clock budget of {args.max_hours}h reached; stopping after epoch {epoch}.")
            stopped_early = True
            break

    print(f"Done. best AP50 {best_ap:.4f}{' (budget-limited)' if stopped_early else ''}")


if __name__ == "__main__":
    main()
