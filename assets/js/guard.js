/*
 * guard.js — light content-protection deterrent for primrosetax.ca
 *
 * IMPORTANT: This is a casual deterrent only, NOT a security control.
 * Anyone determined can still view the source (browser menu, disabled JS,
 * curl, etc.) — that is unavoidable on any website. Real security lives on
 * the server (env-var secrets, locked DB rules), not here.
 *
 * To keep the site usable for real visitors, the following stay fully
 * interactive: form fields, links (incl. tel: / mailto: so clients can copy
 * the phone number and email), and anything marked data-selectable.
 */
(function () {
  var EXEMPT = 'input, textarea, select, a, [data-selectable]';

  // Disable text selection on general content; re-enable on exempt elements.
  var style = document.createElement('style');
  style.textContent =
    'body{-webkit-user-select:none;-moz-user-select:none;-ms-user-select:none;user-select:none;-webkit-touch-callout:none;}' +
    EXEMPT + '{-webkit-user-select:text;-moz-user-select:text;-ms-user-select:text;user-select:text;-webkit-touch-callout:default;}' +
    'img{-webkit-user-drag:none;}' +
    '.hp-field{position:absolute!important;left:-9999px!important;top:auto;width:1px;height:1px;opacity:0;overflow:hidden;pointer-events:none;}';
  (document.head || document.documentElement).appendChild(style);

  /* ---- Spam honeypot (anti-bot) ----
   * Inject an off-screen field into every form. Humans never fill it; bots do.
   * The patched fetch below forwards its value to the server as `_hp`, and the
   * backend silently drops any submission where it's filled. Zero impact on
   * real visitors, and no per-form code needed. */
  function addHoneypots() {
    var forms = document.querySelectorAll('form');
    for (var i = 0; i < forms.length; i++) {
      if (forms[i].querySelector('.hp-field')) continue;
      var hp = document.createElement('input');
      hp.type = 'text';
      hp.name = 'website_url';
      hp.className = 'hp-field';
      hp.tabIndex = -1;
      hp.setAttribute('autocomplete', 'off');
      hp.setAttribute('aria-hidden', 'true');
      forms[i].appendChild(hp);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', addHoneypots);
  } else {
    addHoneypots();
  }

  // Forward the honeypot value on contact-form submissions (defensive: any
  // problem leaves the request completely untouched).
  var _fetch = window.fetch;
  if (typeof _fetch === 'function') {
    window.fetch = function (input, init) {
      try {
        if (init && typeof init.body === 'string' &&
            String(init.method || '').toUpperCase() === 'POST') {
          var u = typeof input === 'string' ? input : (input && input.url) || '';
          if (u.indexOf('/api/contact') !== -1) {
            var trap = '';
            var traps = document.querySelectorAll('.hp-field');
            for (var j = 0; j < traps.length; j++) { if (traps[j].value) trap = traps[j].value; }
            var data = JSON.parse(init.body);
            data._hp = trap;
            init = Object.assign({}, init, { body: JSON.stringify(data) });
          }
        }
      } catch (e) { /* leave the request unchanged */ }
      return _fetch.call(this, input, init);
    };
  }

  function exempt(target) {
    return target && target.closest && target.closest(EXEMPT);
  }

  // Block right-click (context menu) outside exempt elements.
  document.addEventListener('contextmenu', function (e) {
    if (!exempt(e.target)) e.preventDefault();
  });

  // Block copy/cut outside exempt elements.
  ['copy', 'cut'].forEach(function (evt) {
    document.addEventListener(evt, function (e) {
      if (!exempt(e.target)) e.preventDefault();
    });
  });

  // Prevent image dragging (a common save shortcut).
  document.addEventListener('dragstart', function (e) {
    if (e.target && e.target.tagName === 'IMG') e.preventDefault();
  });

  // Discourage view-source / dev-tools keyboard shortcuts (cosmetic only).
  document.addEventListener('keydown', function (e) {
    var k = (e.key || '').toUpperCase();
    var devKeys = k === 'I' || k === 'J' || k === 'C';
    if (
      e.key === 'F12' ||
      ((e.ctrlKey || e.metaKey) && e.shiftKey && devKeys) ||
      (e.metaKey && e.altKey && devKeys) ||      // macOS dev tools
      ((e.ctrlKey || e.metaKey) && k === 'U')    // view source
    ) {
      e.preventDefault();
    }
  });
})();
