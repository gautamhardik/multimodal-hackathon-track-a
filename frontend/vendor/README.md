# Vendored third-party files

Offline fallback. `js/deps.js` loads these libraries from the CDN when it is reachable and from here otherwise (offline, CDN slower than 1.2 s, or a CDN file failing). Files are copied unchanged, and the sha384 integrity hashes in `js/deps.js` must equal these bytes (checked by `backend/tests/test_api.py`). Only the files the pages import are included.

| Folder | Source | Licence |
|---|---|---|
| `three/` | three.js 0.170.0 (`build/three.module.min.js` and 5 `examples/jsm` add-ons) from npm | MIT (`three/LICENSE`) |
| `gsap/` | GSAP 3.15.0 (`index.js`, `ScrollTrigger.js` and their imports) from npm | GSAP Standard "no charge" licence, https://gsap.com/standard-license |
| `fonts/` | Geist (Vercel) and Instrument Serif, Latin and Latin Extended subsets, via Google Fonts | SIL Open Font License 1.1 |

To upgrade: re-download the same file list for the new version, update the CDN URLs and the sha384 hashes in `js/deps.js`, and run the tests.
