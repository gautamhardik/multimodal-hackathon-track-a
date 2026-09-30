"""HTTP hardening: per-client rate limiting, security headers and the Content-Security-Policy for the frontend pages."""
import re
import secrets
import time
from typing import Dict, Tuple

# Hosts the pages may load from when the CDN is reachable (see frontend/js/deps.js); the vendored copies are 'self'.
CDN_SCRIPTS = "https://cdn.jsdelivr.net"
FONT_CSS = "https://fonts.googleapis.com"
FONT_FILES = "https://fonts.gstatic.com"

SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}

REQUEST_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")


def new_nonce() -> str:
    return secrets.token_urlsafe(18)


def page_csp(nonce: str) -> str:
    """Scripts: own files, the pinned CDN, and nonce-tagged inline scripts (the page's startApp call and the import
    map that js/deps.js creates). Inline style attributes are allowed; nothing else runs inline."""
    return "; ".join([
        "default-src 'self'",
        f"script-src 'self' 'nonce-{nonce}' {CDN_SCRIPTS}",
        f"style-src 'self' 'unsafe-inline' {FONT_CSS}",
        f"font-src 'self' {FONT_FILES}",
        f"connect-src 'self' {CDN_SCRIPTS}",
        "img-src 'self' data: blob:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ])


def add_nonce(html: str, nonce: str) -> str:
    return html.replace("<script", f'<script nonce="{nonce}"')


class RateLimiter:
    """Token bucket per client key: `per_minute` sustained, bursts up to a quarter of that (at least 10).
    In-memory and per process: with N workers the effective limit is N times higher, and a shared limit
    (e.g. at the reverse proxy) is the right tool beyond a single host."""

    def __init__(self, per_minute: int):
        self.per_minute = per_minute
        self.capacity = max(10, per_minute // 4)
        self.rate = per_minute / 60.0
        self.buckets: Dict[str, Tuple[float, float]] = {}
        self._last_sweep = time.monotonic()

    def check(self, key: str) -> Tuple[bool, int]:
        """Returns (allowed, retry_after_seconds)."""
        if self.per_minute <= 0:
            return True, 0
        now = time.monotonic()
        tokens, stamp = self.buckets.get(key, (float(self.capacity), now))
        tokens = min(self.capacity, tokens + (now - stamp) * self.rate)
        allowed = tokens >= 1
        self.buckets[key] = (tokens - 1 if allowed else tokens, now)
        if now - self._last_sweep > 300:   # forget idle clients so memory stays bounded
            self.buckets = {k: v for k, v in self.buckets.items() if now - v[1] < 300}
            self._last_sweep = now
        return allowed, 0 if allowed else max(1, int((1 - tokens) / self.rate) + 1)
