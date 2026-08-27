"""Export both models to ONNX and verify the exported graphs numerically.

ONNX Runtime rather than TFLite: PyTorch exports to ONNX directly, whereas the
TFLite path goes through a converter that is a frequent source of silent
numeric drift. Since the app cannot be debugged from here, the shorter and
more verifiable path wins.

The detector is exported *with* its decoding step fused into the graph, so the
React Native side receives boxes and scores rather than three raw feature maps
it would have to post-process itself. Peak-finding implemented twice is
peak-finding implemented differently.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import torch

sys.path.insert(0, str(Path(__file__).parent))
from models import DetectorForExport, TileClassifier, TileDetector  # noqa: E402
from tileset import CODES, NUM_CLASSES  # noqa: E402

OPSET = 17


def export_detector(checkpoint: Path, out_path: Path, input_size: int, width: int) -> dict:
    model = TileDetector(width=width)
    if checkpoint.exists():
        state = torch.load(checkpoint, map_location="cpu", weights_only=False)
        model.load_state_dict(state["model"])
        trained = True
        metrics = state.get("metrics", {})
    else:
        trained = False
        metrics = {}

    wrapper = DetectorForExport(model).eval()
    example = torch.randn(1, 3, input_size, input_size)

    torch.onnx.export(
        wrapper,
        (example,),
        str(out_path),
        input_names=["image"],
        output_names=["boxes", "scores"],
        opset_version=OPSET,
        dynamo=False,
    )

    with torch.no_grad():
        reference = wrapper(example)

    return {
        "path": str(out_path),
        "trained": trained,
        "input_size": input_size,
        "reference": [t.numpy() for t in reference],
        "example": example.numpy(),
        "metrics": metrics,
    }


def export_classifier(checkpoint: Path, out_path: Path, width: int) -> dict:
    model = TileClassifier(NUM_CLASSES, width=width)
    trained = False
    top1 = None
    if checkpoint.exists():
        state = torch.load(checkpoint, map_location="cpu", weights_only=False)
        model.load_state_dict(state["model"])
        trained = True
        top1 = state.get("top1")
    model.eval()

    example = torch.randn(1, 3, 64, 48)
    torch.onnx.export(
        model,
        (example,),
        str(out_path),
        input_names=["crops"],
        output_names=["logits"],
        dynamic_axes={"crops": {0: "batch"}, "logits": {0: "batch"}},
        opset_version=OPSET,
        dynamo=False,
    )

    with torch.no_grad():
        reference = model(example)

    return {
        "path": str(out_path),
        "trained": trained,
        "top1": top1,
        "reference": [reference.numpy()],
        "example": example.numpy(),
    }


def verify(result: dict) -> float:
    """Run the exported graph and compare against PyTorch's own output.

    An export that loads but computes something subtly different is the worst
    possible outcome, because it looks like a model quality problem. Checking
    here costs a second.
    """
    import onnxruntime as ort

    session = ort.InferenceSession(result["path"], providers=["CPUExecutionProvider"])
    name = session.get_inputs()[0].name
    outputs = session.run(None, {name: result["example"]})

    worst = 0.0
    for produced, expected in zip(outputs, result["reference"]):
        worst = max(worst, float(np.abs(produced - expected).max()))
    return worst


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--runs", type=Path, default=Path("ml/runs"))
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--input-size", type=int, default=320)
    parser.add_argument("--width", type=int, default=32)
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)

    detector = export_detector(
        args.runs / "detector_best.pt", args.out / "detector.onnx", args.input_size, args.width
    )
    classifier = export_classifier(
        args.runs / "classifier_best.pt", args.out / "classifier.onnx", args.width
    )

    detector_drift = verify(detector)
    classifier_drift = verify(classifier)

    manifest = {
        "detector": {
            "file": "detector.onnx",
            "inputSize": args.input_size,
            "trained": detector["trained"],
            "maxOnnxDrift": detector_drift,
            "metrics": {k: v for k, v in detector["metrics"].items() if isinstance(v, (int, float))},
        },
        "classifier": {
            "file": "classifier.onnx",
            "inputWidth": 48,
            "inputHeight": 64,
            "trained": classifier["trained"],
            "top1": classifier["top1"],
            "maxOnnxDrift": classifier_drift,
        },
        "classes": list(CODES),
        "normalisation": {
            "mean": [0.485, 0.456, 0.406],
            "std": [0.229, 0.224, 0.225],
        },
    }
    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2))

    for name, info, drift in (
        ("detector", detector, detector_drift),
        ("classifier", classifier, classifier_drift),
    ):
        size_mb = Path(info["path"]).stat().st_size / 1e6
        status = "trained" if info["trained"] else "UNTRAINED (placeholder)"
        print(f"{name:<11} {size_mb:5.2f} MB  drift {drift:.2e}  {status}")


if __name__ == "__main__":
    main()
