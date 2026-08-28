"""Train the tile classifier over cached crops.

Reports top-1 and top-3 accuracy. Top-3 is not decoration: the review screen
offers the three most likely tiles when the user taps a detection, so top-3 is
the accuracy of the correction path, and a model with high top-3 but imperfect
top-1 still yields a fast workflow.
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
import torch.nn as nn
from torch.utils.data import ConcatDataset, DataLoader, WeightedRandomSampler

sys.path.insert(0, str(Path(__file__).parent))
from data import CropDataset  # noqa: E402
from models import TileClassifier, count_parameters  # noqa: E402
from tileset import CODES, NUM_CLASSES  # noqa: E402


@torch.no_grad()
def evaluate(model: nn.Module, loader: DataLoader, device: torch.device | str = "cpu") -> dict:
    model.eval()
    correct1 = correct3 = total = 0
    confusion = np.zeros((NUM_CLASSES, NUM_CLASSES), np.int64)

    for images, labels in loader:
        images, labels = images.to(device), labels.to(device)
        logits = model(images)
        top3 = logits.topk(3, dim=1).indices
        predicted = top3[:, 0]

        correct1 += (predicted == labels).sum().item()
        correct3 += (top3 == labels.unsqueeze(1)).any(dim=1).sum().item()
        total += len(labels)
        for truth, guess in zip(labels.tolist(), predicted.tolist()):
            confusion[truth, guess] += 1

    model.train()
    per_class = np.divide(
        confusion.diagonal(), confusion.sum(axis=1),
        out=np.zeros(NUM_CLASSES), where=confusion.sum(axis=1) > 0,
    )
    return {
        "top1": correct1 / max(1, total),
        "top3": correct3 / max(1, total),
        "worst_class": float(per_class.min()),
        "worst_class_name": CODES[int(per_class.argmin())],
        "confusion": confusion,
        "per_class": per_class,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--train-store", type=Path, nargs="+", required=True,
        help="One or more crop stores, concatenated. Pass a real and a synthetic "
             "store together to fine-tune without forgetting either domain.",
    )
    parser.add_argument("--val-store", type=Path, nargs="+", required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--width", type=int, default=32)
    parser.add_argument("--batch-size", type=int, default=128)
    parser.add_argument("--epochs", type=int, default=18)
    parser.add_argument("--lr", type=float, default=3e-3)
    parser.add_argument("--weight-decay", type=float, default=5e-4)
    parser.add_argument("--label-smoothing", type=float, default=0.05)
    parser.add_argument("--workers", type=int, default=2)
    parser.add_argument("--threads", type=int, default=2)
    parser.add_argument("--max-hours", type=float, default=3.0)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument(
        "--init-from", type=Path, default=None,
        help="Start from these weights with a fresh optimiser - the fine-tuning "
             "entry point. See train_detector.py for why this is not resuming.",
    )
    parser.add_argument("--device", type=str, default="auto", help="cuda, cpu, or auto")
    parser.add_argument(
        "--balance", action="store_true",
        help="Sample classes evenly. Bonus tiles are 8 of 144 in a real wall and "
             "correspondingly thin in the crops, so without this the eight classes "
             "that actually need the attention are outvoted three to one.",
    )
    args = parser.parse_args()

    device = torch.device(
        ("cuda" if torch.cuda.is_available() else "cpu") if args.device == "auto" else args.device
    )

    torch.manual_seed(args.seed)
    np.random.seed(args.seed)
    torch.set_num_threads(args.threads)
    args.out.mkdir(parents=True, exist_ok=True)

    train_set = ConcatDataset([CropDataset(store, train=True) for store in args.train_store])
    val_set = ConcatDataset([CropDataset(store, train=False) for store in args.val_store])
    labels = np.concatenate([dataset.labels for dataset in train_set.datasets])
    sampler = None
    if args.balance:
        counts = np.bincount(labels, minlength=NUM_CLASSES).astype(np.float64)
        weight = np.divide(1.0, counts, out=np.zeros_like(counts), where=counts > 0)
        sampler = WeightedRandomSampler(
            weights=torch.from_numpy(weight[labels]),
            num_samples=len(labels),
            replacement=True,
        )
        print(f"balanced sampling: support ranged {int(counts[counts > 0].min())} "
              f"to {int(counts.max())} before weighting")

    train_loader = DataLoader(
        train_set, batch_size=args.batch_size, shuffle=sampler is None, sampler=sampler,
        num_workers=args.workers, drop_last=True, persistent_workers=args.workers > 0,
    )
    val_loader = DataLoader(
        val_set, batch_size=256, shuffle=False,
        num_workers=args.workers, persistent_workers=args.workers > 0,
    )

    model = TileClassifier(NUM_CLASSES, width=args.width).to(device)
    criterion = nn.CrossEntropyLoss(label_smoothing=args.label_smoothing)
    optimiser = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=args.weight_decay)

    steps_per_epoch = len(train_loader)
    total_steps = args.epochs * steps_per_epoch
    warmup = min(200, total_steps // 20)

    def curve(step: int) -> float:
        if step < warmup:
            return (step + 1) / max(1, warmup)
        progress = (step - warmup) / max(1, total_steps - warmup)
        return 0.5 * (1 + math.cos(math.pi * min(1.0, progress)))

    scheduler = torch.optim.lr_scheduler.LambdaLR(optimiser, curve)

    checkpoint_path = args.out / "classifier_last.pt"
    best_path = args.out / "classifier_best.pt"
    start_epoch, best_top1, history = 0, 0.0, []

    if args.init_from and not checkpoint_path.exists():
        state = torch.load(args.init_from, map_location="cpu", weights_only=False)
        model.load_state_dict(state["model"])
        print(f"Initialised from {args.init_from} (weights only, fresh optimiser)")

    if checkpoint_path.exists():
        state = torch.load(checkpoint_path, map_location="cpu", weights_only=False)
        model.load_state_dict(state["model"])
        optimiser.load_state_dict(state["optimiser"])
        scheduler.load_state_dict(state["scheduler"])
        start_epoch = state["epoch"] + 1
        best_top1 = state["best_top1"]
        history = state.get("history", [])
        print(f"Resumed from epoch {start_epoch} (best top-1 {best_top1:.4f})")

    print(f"classifier: {count_parameters(model):,} params, device {device}")
    print(f"train crops: {len(train_set):,}  val crops: {len(val_set):,}")

    deadline = time.time() + args.max_hours * 3600

    for epoch in range(start_epoch, args.epochs):
        epoch_start = time.time()
        running, seen = 0.0, 0

        for step, (images, labels) in enumerate(train_loader):
            images, labels = images.to(device), labels.to(device)
            logits = model(images)
            loss = criterion(logits, labels)

            optimiser.zero_grad(set_to_none=True)
            loss.backward()
            optimiser.step()
            scheduler.step()

            running += loss.item() * len(labels)
            seen += len(labels)
            if (step + 1) % 100 == 0:
                print(
                    f"  epoch {epoch} step {step + 1}/{steps_per_epoch} "
                    f"loss {running / seen:.4f} lr {scheduler.get_last_lr()[0]:.2e}",
                    flush=True,
                )

        metrics = evaluate(model, val_loader, device=device)
        elapsed = time.time() - epoch_start
        entry = {
            "epoch": epoch,
            "loss": running / max(1, seen),
            "top1": round(metrics["top1"], 5),
            "top3": round(metrics["top3"], 5),
            "worst_class": round(metrics["worst_class"], 4),
            "worst_class_name": metrics["worst_class_name"],
            "seconds": round(elapsed, 1),
        }
        history.append(entry)
        print(
            f"epoch {epoch}: loss {entry['loss']:.4f}  top1 {metrics['top1']:.4f}  "
            f"top3 {metrics['top3']:.4f}  worst class {metrics['worst_class_name']} "
            f"{metrics['worst_class']:.3f}  [{elapsed / 60:.1f} min]",
            flush=True,
        )

        torch.save(
            {"model": model.state_dict(), "optimiser": optimiser.state_dict(),
             "scheduler": scheduler.state_dict(), "epoch": epoch,
             "best_top1": best_top1, "history": history},
            checkpoint_path,
        )
        (args.out / "classifier_history.json").write_text(json.dumps(history, indent=2))

        if metrics["top1"] > best_top1:
            best_top1 = metrics["top1"]
            torch.save(
                {"model": model.state_dict(), "epoch": epoch, "width": args.width,
                 "top1": metrics["top1"], "top3": metrics["top3"]},
                best_path,
            )
            np.save(args.out / "confusion.npy", metrics["confusion"])
            print(f"  new best top-1 {best_top1:.4f} -> {best_path.name}", flush=True)

        if time.time() > deadline:
            print(f"Wall-clock budget of {args.max_hours}h reached; stopping after epoch {epoch}.")
            break

    print(f"Done. best top-1 {best_top1:.4f}")


if __name__ == "__main__":
    main()
