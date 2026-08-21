import os
import torch
from functools import lru_cache
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from gliner import GLiNER
from gliner.data_processing import WordsSplitter

app = FastAPI(title="PCS GLiNER sidecar")

class ExtractRequest(BaseModel):
    text: str
    labels: list[str]
    threshold: float = 0.55

@lru_cache(maxsize=1)
def model() -> GLiNER:
    loaded = GLiNER.from_pretrained(os.environ.get("GLINER_MODEL", "DataSign/gliner-ja-pii-v1"), max_width=25)

    # DataSign's Japanese model was trained with Janome token boundaries.
    # Keep the splitter inside the sidecar so the Node client stays dependency-free.
    class JapaneseSplitterNoWS:
        def __init__(self):
            self._base = WordsSplitter(splitter_type="janome")

        def __call__(self, text):
            for token, start, end in self._base(text):
                if token.strip():
                    yield token, start, end

    loaded.data_processor.words_splitter = JapaneseSplitterNoWS()
    requested_quantization = os.environ.get("GLINER_QUANTIZE_INT8", "false").lower() == "true"
    # Empirical smoke testing shows dynamic INT8 changes DataSign v1's span
    # scores materially (it misses obvious Japanese entities), so keep this
    # model in FP32 until a calibrated quantized checkpoint is available.
    model_name = os.environ.get("GLINER_MODEL", "DataSign/gliner-ja-pii-v1")
    if requested_quantization and "datasign/gliner-ja-pii-v1" not in model_name.lower():
        # GLiNER v1 and GLiNER2 expose different quantization APIs. DataSign's
        # v1 model uses the underlying torch module, so use PyTorch's CPU
        # dynamic quantizer when the convenience method is unavailable.
        if hasattr(loaded, "quantize"):
            loaded.quantize("int8")
        else:
            loaded.model = torch.ao.quantization.quantize_dynamic(loaded.model, {torch.nn.Linear}, dtype=torch.qint8)
    return loaded

@app.post("/extract")
def extract(request: ExtractRequest):
    if not request.text:
        raise HTTPException(status_code=400, detail="text_required")
    try:
        entities = model().predict_entities(request.text, request.labels, threshold=request.threshold)
        return {"entities": [{"text": item.get("text"), "label": item.get("label"), "score": item.get("score"), "start": item.get("start"), "end": item.get("end")} for item in entities]}
    except Exception as error:
        raise HTTPException(status_code=503, detail=f"gliner_unavailable:{error}")
