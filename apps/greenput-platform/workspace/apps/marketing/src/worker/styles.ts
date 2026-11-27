/**
 * Served as /css/styles.css.
 *
 * No marketing page links this sheet anymore. Every HTML route loads
 * /css/gp4.css, which has no prefers-color-scheme rules. The route stays
 * so a cached URL still resolves, and the design-contract tests still
 * read the sheet. It is the published platform kit, the shared GreenPut
 * tokens, the shared reset, and the shared surface — including the dark
 * overrides that used to restyle /pricing, /technology, /ai, /guides,
 * /investors, /privacy, and /terms.
 */
import {
  GP_BASE_CSS,
  GP_PLATFORM_CSS,
  GP_TOKENS_CSS,
  SURFACE_CSS,
  minifyCss,
  stylesheetVersion,
} from '@greenput/shared/design';

const siteStylesSource = `
@layer tokens, reset, base, components, states;

${GP_PLATFORM_CSS}

${GP_TOKENS_CSS}

@layer base {
${GP_BASE_CSS}
}

${SURFACE_CSS}
`;

export const siteStyles = minifyCss(siteStylesSource);

/** Bumps whenever the sheet changes, so a deploy is not stuck on a cached copy. */
export const siteStylesHref = `/css/styles.css?v=${stylesheetVersion(siteStyles)}`;

export const siteScript = `
(function () {
  'use strict';

  var form = document.getElementById('contact-form');
  if (form) {
    form.addEventListener('submit', async function (e) {
      e.preventDefault();
      var btn = form.querySelector('[type=submit]');
      var originalText = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Sending...';

      try {
        var fd = new FormData(form);
        var res = await fetch('/contact', {
          method: 'POST',
          body: fd,
          headers: { Accept: 'application/json', 'X-Requested-With': 'fetch' },
        });
        var data = null;
        try { data = await res.json(); } catch (parseErr) { data = null; }
        if (data && data.ok) {
          var note = document.createElement('p');
          note.setAttribute('data-bn', 'bn-note');
          note.setAttribute('role', 'status');
          note.setAttribute('aria-live', 'polite');
          note.innerHTML =
            '<strong>Message sent!</strong> ' +
            'Thanks for reaching out. We’ll get back to you within 1 business day.';
          form.replaceWith(note);
        } else {
          var serverError = data && data.error && typeof data.error === 'object' ? data.error : null;
          var failure = new Error(
            (serverError && serverError.message) ||
              (typeof (data && data.error) === 'string' ? data.error : '') ||
              "We couldn't send your message just now."
          );
          failure.field = serverError && serverError.field ? serverError.field : null;
          throw failure;
        }
      } catch (err) {
        form.querySelectorAll('[aria-invalid="true"]').forEach(function (el) {
          el.removeAttribute('aria-invalid');
        });
        var errBanner = document.querySelector('[data-bn="bn-note"][role="alert"]');
        if (!errBanner) {
          errBanner = document.createElement('p');
          errBanner.setAttribute('data-bn', 'bn-note');
          errBanner.setAttribute('role', 'alert');
          form.insertAdjacentElement('beforebegin', errBanner);
        }
        errBanner.textContent = err.message || "We couldn't send your message just now.";
        errBanner.scrollIntoView({ block: 'center', behavior: 'smooth' });
        var invalidField = err.field && form.querySelector('[name="' + err.field + '"]');
        if (invalidField) {
          invalidField.setAttribute('aria-invalid', 'true');
          invalidField.focus();
        } else {
          errBanner.setAttribute('tabindex', '-1');
          errBanner.focus();
        }
        btn.disabled = false;
        btn.textContent = originalText;
      }
    });
  }

  var host = window.location.hostname;
  var appBase = null;
  if (host.endsWith('.greenput.site')) {
    appBase = 'https://app.greenput.site';
  } else if (host.match(/^[a-z0-9-]+\\.greenput\\.pages\\.dev$/)) {
    appBase = 'https://' + host.replace('greenput', 'greenput-app');
  }
  if (appBase) {
    document.querySelectorAll('a[href*="app.greenput.com"]').forEach(function (a) {
      a.href = a.href.replace('https://app.greenput.com', appBase);
    });
  }
})();
`;
