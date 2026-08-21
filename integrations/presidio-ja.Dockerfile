FROM ghcr.io/data-privacy-stack/presidio-analyzer@sha256:ae8f6f111ac2f04e3fec552f7f80edd0dcbfa2dd69ee1b9e030475be31669885
RUN pip install --no-cache-dir ginza==5.2.0 ja_ginza==5.2.0
# The stock Presidio image currently ships spaCy 3.8, whose stricter config
# validation rejects GiNZA's optional null compound-splitter mode.  C is GiNZA's
# documented default and keeps the model load deterministic.
RUN sed -i 's/split_mode = null/split_mode = "C"/g' /home/presidio/.local/lib/python3.12/site-packages/ja_ginza/ja_ginza-5.2.0/config.cfg \
 && sed -i 's/"split_mode":null/"split_mode":"C"/g' /home/presidio/.local/lib/python3.12/site-packages/ja_ginza/ja_ginza-5.2.0/compound_splitter/cfg
COPY presidio-ja-app.py /app/app-ja.py
CMD ["gunicorn", "-w", "1", "-b", "0.0.0.0:3000", "app-ja:app"]
