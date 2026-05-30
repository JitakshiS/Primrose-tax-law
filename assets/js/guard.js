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
    'img{-webkit-user-drag:none;}';
  (document.head || document.documentElement).appendChild(style);

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
