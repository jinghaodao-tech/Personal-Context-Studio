# Presidio + GiNZA (Japanese)

Build and run from the `integrations` directory:

```powershell
docker build -f presidio-ja.Dockerfile -t pcs-presidio-ja:5.2.0 .
docker run --rm --name pcs-presidio-ja -p 127.0.0.1:5001:3000 pcs-presidio-ja:5.2.0
```

Set `PCS_PRESIDIO_URL=http://127.0.0.1:5001` and
`PCS_PRESIDIO_LANGUAGE=ja` and `PCS_PRESIDIO_ENABLED=true` for PCS. Presidio
is disabled by default because the built-in TypeScript detector handles
structured PII faster; enable it only as an additional fallback. The image keeps Presidio's analyzer API
shape and adds GiNZA's Japanese NLP engine; PCS still falls back to local
detectors if the sidecar is unavailable.

GiNZA and the `ja_ginza` model are MIT-licensed. The image is pinned to the
Presidio Analyzer base-image digest in the Dockerfile; review the bundled
dependency notices before redistribution. GiNZA supplies Japanese tokenization
and named-entity findings (for example email/person/organization/location); it
does not replace PCS's explicit sensitive-category taxonomy or secret detector.
