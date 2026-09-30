// Third-party libraries: CDN when the internet is reachable, the vendored copies in /vendor otherwise.
// Classic (non-module) script: the import map has to exist before the first module loads, so the pages call
// startApp(entry) instead of using <script type="module"> directly.
//
//   offline (navigator.onLine false)   -> local
//   online but CDN unreachable/slow     -> local (probe times out after PROBE_MS)
//   CDN chosen but a module fails       -> reload once with local (e.g. the network dropped mid-load)
//
// Integrity hashes pin the CDN files to the exact bytes vendored here (sha384 of /vendor), so the CDN copy can
// never differ from the checked local one. Browsers without import-map integrity support simply skip the check.
(function () {
  'use strict';
  var PROBE_MS = 1200;
  var CDN = { three: 'https://cdn.jsdelivr.net/npm/three@0.170.0/', gsap: 'https://cdn.jsdelivr.net/npm/gsap@3.15.0/' };
  var LOCAL = { three: './vendor/three/', gsap: './vendor/gsap/' };
  var FONTS = {
    cdn: 'https://fonts.googleapis.com/css2?family=Geist:wght@300..700&family=Instrument+Serif:ital@0;1&display=swap',
    local: 'vendor/fonts/fonts.css',
  };
  var SRI = {
    three: {
      'build/three.module.min.js': 'sha384-IDC7sAMAIMB/TZ6dgKKPPAKZ2bXXXP8+FBMBC8cU319eBhKITx+PaalhfDkDNH28',
      'examples/jsm/controls/OrbitControls.js': 'sha384-aJoe4qqS/DgF2jh9njAuvA6QIveJYoCuYOfYjdFY8P3eawzmc9bEQ40jq2TvOyuP',
      'examples/jsm/environments/RoomEnvironment.js': 'sha384-9ItPPH2vgKbkvgrqTKq7ptGYe+WuAnqlZtlqleJW4/CJjnM5R7C+efD6iS7ADPJ9',
      'examples/jsm/loaders/GLTFLoader.js': 'sha384-Lq1Wl94so5JCKGDvezrdVMJhdeKQkwb8iwRo59QrPPd61CnrCJZLxYmFlQ8ZuOKR',
      'examples/jsm/renderers/CSS2DRenderer.js': 'sha384-9CXQqRjuKfYvfHem9p/LPU6b7PaeeiDuC/gp1qRz3bEV9txWG5wi9XhrkE/0/Dn9',
      'examples/jsm/utils/BufferGeometryUtils.js': 'sha384-wOjwauvHlJO7K6APr7FmMGH2nupQa3Ndzas9bJZhsAMOK055efJud8ns4aYmASKv',
    },
    gsap: {
      'index.js': 'sha384-CXonANN5Q5Pae0kOCXGnbY2891Skh1oEA3KdyFrgl5A+9HbgTfL39dJzkIbDN/y8',
      'gsap-core.js': 'sha384-XDwKydO5jn3iq1X9bPtpysv+OnwM177VnImvUWy02ocrXFD4FwAFLzVwsXV4SxZw',
      'CSSPlugin.js': 'sha384-oKyHECOP3meKRCINSz3zIjedU+A3qKtOaTInP2gE+6e3u4B1HUk8bD1FGbDQEXJX',
      'ScrollTrigger.js': 'sha384-WW4mqizgtRZ/H3kF9Ft+qKKnlEWB1szkNS9ugP0c5qOYKfxOFOS/4S3VcSdkPd4R',
      'Observer.js': 'sha384-QX956+0RnoQ+7makHXvXM64N7Rja/60VZYnytkYSJOAkpYs3dRqsRiSABqsg+Pf+',
    },
  };
  var FORCE_KEY = 'deps-force-local';
  // The server tags each page's <script> with a CSP nonce; scripts created here (the import map) must carry it too.
  var NONCE = (document.currentScript && document.currentScript.nonce) || '';

  function importMap(base, cdn) {
    var map = {
      imports: {
        three: base.three + 'build/three.module.min.js',
        'three/addons/': base.three + 'examples/jsm/',
        gsap: base.gsap + 'index.js',
        'gsap/': base.gsap,
      },
    };
    if (cdn) {
      map.integrity = {};
      for (var pkg in SRI) for (var f in SRI[pkg]) map.integrity[base[pkg] + f] = SRI[pkg][f];
    }
    return map;
  }

  function forcedLocal() {
    try { return sessionStorage.getItem(FORCE_KEY) === '1'; } catch (e) { return false; }
  }

  // Fetches a small file the page needs anyway (it lands in the HTTP cache), with a hard time limit.
  function cdnReachable() {
    if (!navigator.onLine || forcedLocal() || !window.fetch || !window.AbortController) return Promise.resolve(false);
    var ctl = new AbortController();
    var timer = setTimeout(function () { ctl.abort(); }, PROBE_MS);
    return fetch(CDN.gsap + 'index.js', { mode: 'cors', signal: ctl.signal, integrity: SRI.gsap['index.js'] })
      .then(function (r) { return r.ok; }, function () { return false; })
      .then(function (ok) { clearTimeout(timer); return ok; });
  }

  function add(tag, attrs, parent) {
    var el = document.createElement(tag);
    if (tag === 'script' && NONCE) el.nonce = NONCE;
    for (var k in attrs) el[k] = attrs[k];
    (parent || document.head).appendChild(el);
    return el;
  }

  /** Called by the pages when a dynamic import fails: if it was a CDN module, reload once with the local copies. */
  window.depsFailed = function (err) {
    var fetchError = err instanceof TypeError && /import|fetch|module|integrity/i.test(String(err.message));
    if (!fetchError || document.documentElement.getAttribute('data-deps') !== 'cdn' || forcedLocal()) return false;
    try { sessionStorage.setItem(FORCE_KEY, '1'); location.reload(); return true; } catch (e) { return false; }
  };

  /** Choose the source, install the import map and fonts, then load `entry` (and `preload` modules early). */
  window.startApp = function (entry, preload) {
    cdnReachable().then(function (useCdn) {
      var base = useCdn ? CDN : LOCAL;
      document.documentElement.setAttribute('data-deps', useCdn ? 'cdn' : 'local');
      add('script', { type: 'importmap', textContent: JSON.stringify(importMap(base, useCdn)) });
      add('link', { rel: 'stylesheet', href: useCdn ? FONTS.cdn : FONTS.local, onerror: function () {
        if (useCdn) add('link', { rel: 'stylesheet', href: FONTS.local });   // Google Fonts blocked: local fonts
      } });
      (preload || []).forEach(function (spec) {
        var pkg = spec.split('/')[0], file = spec.slice(pkg.length + 1);
        var attrs = { rel: 'modulepreload', href: base[pkg] + file };
        if (useCdn) { attrs.crossOrigin = 'anonymous'; attrs.integrity = SRI[pkg][file]; }
        add('link', attrs);
      });
      add('script', {
        type: 'module', src: entry,
        onerror: function () { window.depsFailed(new TypeError('module import failed')); },   // a static import failed
      }, document.body);
    });
  };
})();
