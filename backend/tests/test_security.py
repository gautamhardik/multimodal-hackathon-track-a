"""HTTP hardening: headers, CSP nonces, request IDs, body limits, rate limiting and CORS."""
import re

import pytest
from fastapi.testclient import TestClient

from backend.app import main
from backend.app.security import RateLimiter


@pytest.fixture(scope="module")
def client():
    with TestClient(main.app) as c:
        yield c


def test_security_headers_and_request_id(client):
    r = client.get("/health")
    assert r.status_code == 200
    for header in ("X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"):
        assert header in r.headers
    assert re.fullmatch(r"[0-9a-f]{16}", r.headers["X-Request-ID"])
    assert client.get("/health", headers={"X-Request-ID": "trace-42"}).headers["X-Request-ID"] == "trace-42"
    assert client.get("/health", headers={"X-Request-ID": "bad id\nx"}).headers["X-Request-ID"] != "bad id\nx"


def test_pages_have_nonce_csp(client):
    for path in ("/", "/app.html", "/index.html"):
        r = client.get(path)
        csp = r.headers["Content-Security-Policy"]
        nonce = re.search(r"'nonce-([^']+)'", csp).group(1)
        scripts = re.findall(r"<script[^>]*>", r.text)
        assert scripts and all(f'nonce="{nonce}"' in tag for tag in scripts), path
        assert "frame-ancestors 'none'" in csp and "object-src 'none'" in csp
        assert "unsafe-inline" not in csp.split("script-src")[1].split(";")[0]   # no inline scripts without the nonce
    assert client.get("/").headers["Content-Security-Policy"] != client.get("/").headers["Content-Security-Policy"]


def test_body_limits(client):
    big = b'{"x": "' + b"a" * (main.MAX_BODY_BYTES + 10) + b'"}'
    r = client.post("/predict", content=big, headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and r.json()["request_id"]
    chunked = client.post("/predict", content=iter([b"{}"]), headers={"Content-Type": "application/json"})
    assert chunked.status_code == 411


def test_predict_rate_limit(client, monkeypatch):
    limiter = RateLimiter(60)
    limiter.capacity = 2
    monkeypatch.setattr(main, "predict_limiter", limiter)
    codes = [client.post("/predict", json={}).status_code for _ in range(3)]
    assert codes[:2] == [422, 422] and codes[2] == 429
    r = client.post("/predict", json={})
    assert r.status_code == 429 and int(r.headers["Retry-After"]) >= 1


def test_rate_limiter_refills():
    limiter = RateLimiter(60)
    limiter.capacity = 1
    assert limiter.check("a")[0] and not limiter.check("a")[0]
    tokens, stamp = limiter.buckets["a"]
    limiter.buckets["a"] = (tokens, stamp - 2)   # two seconds later: one token per second refilled
    assert limiter.check("a")[0]
    assert limiter.check("b")[0]   # clients are independent
    assert RateLimiter(0).check("a") == (True, 0)   # 0 disables the limit


def test_no_cross_origin_access_by_default(client):
    r = client.get("/health", headers={"Origin": "https://evil.example"})
    assert "access-control-allow-origin" not in {k.lower() for k in r.headers}


def test_errors_carry_request_id_but_no_internals(client, monkeypatch):
    def boom(*_, **__):
        raise RuntimeError("secret internal detail")
    monkeypatch.setattr(main.engine, "predict", boom)
    patient = client.get("/example-patients").json()["patients"][0]["features"]
    r = client.post("/predict", json=patient, headers={"X-Request-ID": "err-1"})
    assert r.status_code == 500 and "err-1" in r.json()["detail"] and "secret" not in r.text
