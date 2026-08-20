# Optional GLiNER sidecar

This sidecar adds Japanese, open-label, context-aware entity extraction without sending
PCS text to a remote API. The model is downloaded by Hugging Face on first use;
the default is `DataSign/gliner-ja-pii-v1` (Apache-2.0). Set `GLINER_MODEL`
to a locally cached or approved model in production and review that model's
license before redistribution. The default model requires Janome tokenization.

```powershell
docker build -f gliner-sidecar.Dockerfile -t pcs-gliner:local .
docker run --rm --name pcs-gliner -e GLINER_QUANTIZE_INT8=true -p 127.0.0.1:3001:3001 pcs-gliner:local
```

Then set `PCS_GLINER_URL=http://127.0.0.1:3001`. PCS treats GLiNER findings as
an additive detector; if it is unavailable, the deterministic and Presidio
layers continue to run. GLiNER is an entity/context component, not a complete
owner-vs-third-party policy engine, so PCS taxonomy and human review remain in
force. CPU dynamic INT8 quantization is supported experimentally for other
GLiNER checkpoints, but is intentionally not applied to DataSign v1 because
the Japanese smoke test showed a material span-recall regression. Keep the
DataSign sidecar in FP32 until a calibrated quantized checkpoint is available.

PCS sends only `person name`, `address`, and `secret` labels to this sidecar.
Email, phone, postal code, URL, and date formats are handled by the faster
TypeScript detector and are intentionally not duplicated here.
