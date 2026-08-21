# Optional Presidio sidecar

PCS can use an unmodified Presidio Analyzer on localhost. Set
`PCS_PRESIDIO_URL` to `http://127.0.0.1:5001`; only `localhost`, `127.0.0.1`,
and `::1` are accepted. PCS posts `/analyze` with `text` and `language`.
`PCS_PRESIDIO_LANGUAGE` defaults to `ja`; `PCS_PRESIDIO_TIMEOUT_MS` defaults
to `3000` to allow the sidecar's first request to warm up.

Presidio findings are additive and exposed under `layers.presidio` and
`presidio.available`. If the sidecar is unavailable, the local detector still
runs. Pin the Presidio image/version for reproducible behavior.
