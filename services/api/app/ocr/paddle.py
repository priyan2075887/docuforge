from __future__ import annotations

from functools import lru_cache
from typing import Any

from PIL import Image


class PaddleOCRProvider:
    id = "paddleocr"
    model = "PP-OCRv5"

    @staticmethod
    def installed() -> bool:
        try:
            import paddle  # noqa: F401
            import paddleocr  # noqa: F401
            return True
        except ImportError:
            return False

    @staticmethod
    def install_hint() -> str:
        return ".venv\\Scripts\\python -m pip install -r requirements-ocr-paddle.txt"

    @staticmethod
    @lru_cache(maxsize=1)
    def _pipeline():
        from paddleocr import PaddleOCR
        return PaddleOCR(
            ocr_version="PP-OCRv5",
            lang="en",
            use_doc_orientation_classify=True,
            use_doc_unwarping=True,
            use_textline_orientation=True,
        )

    def recognize(self, image: Image.Image) -> dict[str, Any]:
        import numpy as np
        results = list(self._pipeline().predict(np.asarray(image.convert("RGB"))))
        lines: list[dict[str, Any]] = []
        for result in results:
            raw = getattr(result, "json", result)
            if callable(raw):
                raw = raw()
            payload = raw.get("res", raw) if isinstance(raw, dict) else {}
            texts = payload.get("rec_texts", [])
            scores = payload.get("rec_scores", [])
            boxes = payload.get("rec_boxes", payload.get("rec_polys", []))
            for index, text in enumerate(texts):
                box = boxes[index].tolist() if index < len(boxes) and hasattr(boxes[index], "tolist") else boxes[index] if index < len(boxes) else []
                lines.append({"text": str(text), "confidence": float(scores[index]) if index < len(scores) else None, "bbox": box})
        return {"text": "\n".join(line["text"] for line in lines), "lines": lines}
