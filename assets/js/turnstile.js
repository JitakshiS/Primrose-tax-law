/*
 * turnstile.js — Cloudflare Turnstile bot protection for the contact forms.
 *
 * Renders ONE Turnstile widget per page in "interaction-only" mode: it is
 * invisible to real visitors and only surfaces (fixed, bottom-centre) if a
 * genuine challenge is ever required. Turnstile tokens are not tied to a
 * specific form, so one widget covers every form on the page, including the
 * hidden nav-modal form. The token is attached to each /api/contact POST, and
 * the backend rejects submissions without a valid token, which blocks the bots.
 *
 * Defensive throughout: any failure here leaves the original request untouched,
 * and the backend fails open if its secret is ever missing, so the live form is
 * never left in a broken state.
 */
(function () {
  var SITEKEY = '0x4AAAAAADlOy-RdIS682XZ-';
  var widgetId = null;

  function render() {
    if (!window.turnstile || widgetId !== null) return;
    var holder = document.createElement('div');
    holder.id = 'primrose-turnstile';
    holder.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);z-index:99999;';
    (document.body || document.documentElement).appendChild(holder);
    try {
      widgetId = window.turnstile.render(holder, {
        sitekey: SITEKEY,
        appearance: 'interaction-only',
        'refresh-expired': 'auto'
      });
    } catch (e) { /* ignore render errors */ }
  }

  // Called by the Turnstile API once it has loaded.
  window.__primroseTurnstileInit = function () {
    if (document.body) render();
    else document.addEventListener('DOMContentLoaded', render);
  };

  // Load the Turnstile API (explicit rendering, our onload callback).
  var script = document.createElement('script');
  script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?onload=__primroseTurnstileInit&render=explicit';
  script.async = true;
  script.defer = true;
  (document.head || document.documentElement).appendChild(script);

  function getToken() {
    try {
      return (window.turnstile && widgetId !== null) ? (window.turnstile.getResponse(widgetId) || '') : '';
    } catch (e) { return ''; }
  }
  function resetWidget() {
    try { if (window.turnstile && widgetId !== null) window.turnstile.reset(widgetId); } catch (e) {}
  }

  // Attach the token to /api/contact submissions.
  var _fetch = window.fetch;
  if (typeof _fetch === 'function') {
    window.fetch = function (input, init) {
      try {
        if (init && typeof init.body === 'string' &&
            String(init.method || '').toUpperCase() === 'POST') {
          var u = typeof input === 'string' ? input : (input && input.url) || '';
          if (u.indexOf('/api/contact') !== -1) {
            var data = JSON.parse(init.body);
            data.turnstileToken = getToken();
            var newInit = Object.assign({}, init, { body: JSON.stringify(data) });
            var promise = _fetch.call(this, input, newInit);
            // Refresh the token after each submission so the next one is ready.
            if (promise && typeof promise.finally === 'function') promise.finally(resetWidget);
            return promise;
          }
        }
      } catch (e) { /* leave the request unchanged on any issue */ }
      return _fetch.call(this, input, init);
    };
  }
})();
