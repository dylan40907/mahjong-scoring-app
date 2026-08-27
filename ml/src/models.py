"""The two networks behind the pipeline, both written from scratch.

Splitting detection from classification is what makes this tractable. A single
42-class detector has to resolve one engraved character from a tile perhaps
twelve pixels wide in the network's input, which forces a high input
resolution and a heavy backbone. Detecting *a tile* is by contrast almost
trivial - tiles are high-contrast pale rectangles on a dark table - so the
detector can run small and fast, and the classifier then sees each tile as a
dedicated crop taken from the full-resolution photograph, where the character
is a hundred pixels tall rather than twelve.

That split also matches the failure modes a user can fix. A missed box is
visible and correctable by tapping; a misread tile is correctable from a
ranked shortlist the classifier already produces.
"""

from __future__ import annotations

import math

import torch
import torch.nn as nn
import torch.nn.functional as F


# --------------------------------------------------------------------------
# Building blocks
# --------------------------------------------------------------------------

class ConvBNAct(nn.Sequential):
    def __init__(self, cin: int, cout: int, k: int = 3, stride: int = 1, groups: int = 1):
        super().__init__(
            nn.Conv2d(cin, cout, k, stride, k // 2, groups=groups, bias=False),
            nn.BatchNorm2d(cout),
            nn.ReLU(inplace=True),
        )


class SeparableConv(nn.Sequential):
    """Depthwise 3x3 followed by pointwise 1x1.

    Roughly eight times cheaper than a dense 3x3 at these widths, which is the
    difference between a detector that trains overnight on two CPU cores and
    one that does not.
    """

    def __init__(self, cin: int, cout: int, stride: int = 1):
        super().__init__(
            nn.Conv2d(cin, cin, 3, stride, 1, groups=cin, bias=False),
            nn.BatchNorm2d(cin),
            nn.ReLU(inplace=True),
            nn.Conv2d(cin, cout, 1, bias=False),
            nn.BatchNorm2d(cout),
            nn.ReLU(inplace=True),
        )


# --------------------------------------------------------------------------
# Detector
# --------------------------------------------------------------------------

class TileDetector(nn.Module):
    """Anchor-free centre-point detector for a single class.

    Predicts, on a stride-4 grid: a centre heatmap, the box size in pixels,
    and a sub-cell centre offset. Anchor-free suits this problem because tile
    aspect ratio is fixed by the physical object - every box is 3:4 - so there
    is nothing for anchor priors to buy.

    Outputs are raw. Sigmoid and decoding live in `decode`, which is also
    traced into the exported graph so the app never reimplements it.
    """

    def __init__(self, width: int = 32):
        super().__init__()
        w = width
        self.stem = nn.Sequential(ConvBNAct(3, w // 2, 3, stride=2), SeparableConv(w // 2, w))
        self.stage1 = nn.Sequential(SeparableConv(w, w * 2, stride=2), SeparableConv(w * 2, w * 2))
        self.stage2 = nn.Sequential(SeparableConv(w * 2, w * 4, stride=2), SeparableConv(w * 4, w * 4))
        self.stage3 = nn.Sequential(SeparableConv(w * 4, w * 8, stride=2), SeparableConv(w * 8, w * 8))

        self.lateral2 = nn.Conv2d(w * 4, w * 2, 1)
        self.lateral1 = nn.Conv2d(w * 2, w * 2, 1)
        self.smooth2 = SeparableConv(w * 2, w * 2)
        self.smooth1 = SeparableConv(w * 2, w * 2)
        self.top = nn.Conv2d(w * 8, w * 2, 1)

        self.heatmap_head = nn.Sequential(ConvBNAct(w * 2, w * 2), nn.Conv2d(w * 2, 1, 1))
        self.size_head = nn.Sequential(ConvBNAct(w * 2, w * 2), nn.Conv2d(w * 2, 2, 1))
        self.offset_head = nn.Sequential(ConvBNAct(w * 2, w * 2), nn.Conv2d(w * 2, 2, 1))

        self._init_weights()

    def _init_weights(self) -> None:
        for m in self.modules():
            if isinstance(m, nn.Conv2d):
                nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
                if m.bias is not None:
                    nn.init.zeros_(m.bias)
            elif isinstance(m, nn.BatchNorm2d):
                nn.init.ones_(m.weight)
                nn.init.zeros_(m.bias)
        # Bias the heatmap toward "empty" so early training is not swamped by
        # the overwhelming negative majority (Lin et al., focal loss).
        prior = 0.01
        nn.init.constant_(self.heatmap_head[-1].bias, -math.log((1 - prior) / prior))

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor]:
        s0 = self.stem(x)       # stride 2
        s1 = self.stage1(s0)    # stride 4
        s2 = self.stage2(s1)    # stride 8
        s3 = self.stage3(s2)    # stride 16

        p = self.top(s3)
        p = F.interpolate(p, size=s2.shape[-2:], mode="nearest") + self.lateral2(s2)
        p = self.smooth2(p)
        p = F.interpolate(p, size=s1.shape[-2:], mode="nearest") + self.lateral1(s1)
        p = self.smooth1(p)

        return self.heatmap_head(p), self.size_head(p), self.offset_head(p)


@torch.no_grad()
def decode(
    heatmap_logits: torch.Tensor,
    size: torch.Tensor,
    offset: torch.Tensor,
    stride: int = 4,
    top_k: int = 64,
) -> tuple[torch.Tensor, torch.Tensor]:
    """Turn raw heads into boxes.

    A 3x3 max-pool acts as non-maximum suppression: a cell survives only if it
    is the strongest in its neighbourhood. That replaces IoU-based NMS
    entirely, which matters here because tiles in a hand touch edge to edge and
    IoU-based suppression would happily delete the neighbours.

    Returns boxes in input-image pixels, shape (B, top_k, 4), and their scores.
    """
    scores = torch.sigmoid(heatmap_logits)
    peaks = F.max_pool2d(scores, 3, stride=1, padding=1)
    scores = torch.where(peaks == scores, scores, torch.zeros_like(scores))

    b, _, h, w = scores.shape
    flat = scores.view(b, -1)
    top_scores, indices = torch.topk(flat, k=min(top_k, h * w), dim=1)

    ys = (indices // w).float()
    xs = (indices % w).float()

    size_flat = size.view(b, 2, -1)
    offset_flat = offset.view(b, 2, -1)
    gather = indices.unsqueeze(1).expand(-1, 2, -1)
    box_wh = size_flat.gather(2, gather)
    centre_offset = offset_flat.gather(2, gather)

    cx = (xs + centre_offset[:, 0]) * stride
    cy = (ys + centre_offset[:, 1]) * stride
    bw = box_wh[:, 0].clamp(min=1.0)
    bh = box_wh[:, 1].clamp(min=1.0)

    boxes = torch.stack([cx - bw / 2, cy - bh / 2, cx + bw / 2, cy + bh / 2], dim=2)
    return boxes, top_scores


class DetectorForExport(nn.Module):
    """Detector plus decoding, so the exported graph emits boxes directly.

    Keeping the decode inside the graph means the React Native side never has
    to reimplement peak-finding, and there is no chance of the app and the
    evaluation harness disagreeing about what the model said.
    """

    def __init__(self, detector: TileDetector, stride: int = 4, top_k: int = 64):
        super().__init__()
        self.detector = detector
        self.stride = stride
        self.top_k = top_k

    def forward(self, x: torch.Tensor) -> tuple[torch.Tensor, torch.Tensor]:
        heatmap, size, offset = self.detector(x)
        return decode(heatmap, size, offset, self.stride, self.top_k)


# --------------------------------------------------------------------------
# Losses
# --------------------------------------------------------------------------

def focal_loss(pred_logits: torch.Tensor, target: torch.Tensor, alpha: float = 2.0, beta: float = 4.0) -> torch.Tensor:
    """Penalty-reduced pixelwise focal loss (CornerNet / CenterNet variant).

    `target` is a Gaussian-splatted heatmap rather than a one-hot map, so cells
    adjacent to a true centre are penalised less for firing - they are nearly
    right, and treating them as hard negatives destabilises training when
    objects are only three cells apart, as tiles in a row are.
    """
    pred = torch.sigmoid(pred_logits).clamp(1e-4, 1 - 1e-4)
    positive = target.eq(1).float()
    negative = 1.0 - positive

    positive_loss = -torch.log(pred) * (1 - pred) ** alpha * positive
    negative_loss = -torch.log(1 - pred) * pred ** alpha * (1 - target) ** beta * negative

    count = positive.sum()
    if count == 0:
        return negative_loss.sum()
    return (positive_loss.sum() + negative_loss.sum()) / count


def regression_loss(pred: torch.Tensor, target: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
    """L1 over the cells that actually contain an object centre."""
    mask = mask.unsqueeze(1).expand_as(pred).float()
    total = F.l1_loss(pred * mask, target * mask, reduction="sum")
    return total / mask.sum().clamp(min=1.0)


# --------------------------------------------------------------------------
# Classifier
# --------------------------------------------------------------------------

class TileClassifier(nn.Module):
    """Reads one cropped tile face and names it.

    Deliberately small. The task is closer to OCR on a fixed alphabet of 42
    glyphs than to open-world recognition: the crops are axis-aligned by the
    detector, roughly scale-normalised, and drawn from a set with no
    intra-class variation beyond print and lighting. Capacity spent beyond this
    goes into memorising synthetic noise.
    """

    def __init__(self, num_classes: int = 42, width: int = 32, dropout: float = 0.15):
        super().__init__()
        w = width
        self.features = nn.Sequential(
            ConvBNAct(3, w, 3, stride=1),
            ConvBNAct(w, w, 3, stride=2),        # 32 x 24
            SeparableConv(w, w * 2),
            SeparableConv(w * 2, w * 2, stride=2),  # 16 x 12
            SeparableConv(w * 2, w * 4),
            SeparableConv(w * 4, w * 4, stride=2),  # 8 x 6
            SeparableConv(w * 4, w * 8),
            SeparableConv(w * 8, w * 8, stride=2),  # 4 x 3
        )
        self.pool = nn.AdaptiveAvgPool2d(1)
        self.dropout = nn.Dropout(dropout)
        self.fc = nn.Linear(w * 8, num_classes)

        for m in self.modules():
            if isinstance(m, nn.Conv2d):
                nn.init.kaiming_normal_(m.weight, mode="fan_out", nonlinearity="relu")
            elif isinstance(m, nn.BatchNorm2d):
                nn.init.ones_(m.weight)
                nn.init.zeros_(m.bias)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        x = self.features(x)
        x = self.pool(x).flatten(1)
        return self.fc(self.dropout(x))


def count_parameters(model: nn.Module) -> int:
    return sum(p.numel() for p in model.parameters() if p.requires_grad)


if __name__ == "__main__":
    import time

    detector = TileDetector().eval()
    classifier = TileClassifier().eval()
    print(f"detector    {count_parameters(detector):,} params")
    print(f"classifier  {count_parameters(classifier):,} params")

    x = torch.randn(1, 3, 384, 384)
    with torch.no_grad():
        for _ in range(2):
            detector(x)
        start = time.time()
        for _ in range(5):
            hm, sz, off = detector(x)
        print(f"detector    {(time.time() - start) / 5 * 1000:.0f} ms/image @384")
        print(f"  heads: {tuple(hm.shape)} {tuple(sz.shape)} {tuple(off.shape)}")
        boxes, scores = decode(hm, sz, off)
        print(f"  decoded: {tuple(boxes.shape)} {tuple(scores.shape)}")

    c = torch.randn(32, 3, 64, 48)
    with torch.no_grad():
        classifier(c)
        start = time.time()
        for _ in range(5):
            classifier(c)
        print(f"classifier  {(time.time() - start) / 5 / 32 * 1000:.2f} ms/crop")
