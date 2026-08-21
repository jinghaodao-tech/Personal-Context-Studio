FROM python:3.12-slim
WORKDIR /app
# Pin the CPU wheel first so pip does not pull the multi-hundred-megabyte
# CUDA distribution into this local-only sidecar.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch==2.8.0+cpu \
 && pip install --no-cache-dir gliner==0.2.24 janome==0.5.0 fastapi==0.116.1 uvicorn==0.35.0
COPY gliner-sidecar.py /app/gliner-sidecar.py
ENV GLINER_MODEL=DataSign/gliner-ja-pii-v1
ENV GLINER_QUANTIZE_INT8=false
EXPOSE 3001
CMD ["uvicorn", "gliner-sidecar:app", "--host", "0.0.0.0", "--port", "3001"]
