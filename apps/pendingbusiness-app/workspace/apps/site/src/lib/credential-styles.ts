/**
 * Adopted-stylesheet micro-component CSS for the passkey credential list
 * on /account. Demonstrates the BaseNative-house pattern:
 * `CSSStyleSheet` + `document.adoptedStyleSheets` keep this component's
 * rules out of the global cascade. Selectors target semantic elements
 * (`ul > li`, `header`, `footer`) inside `[data-bn="credential-list"]` —
 * no class names, no global leakage.
 *
 * Falls back gracefully if the runtime is older than Safari 16.4 / FF 101
 * (the @scope rule in styles.css supplies the bare-minimum reset so the
 * list isn't unstyled).
 */

let attached = false;

export function attachCredentialStyles(): void {
  if (attached) return;
  if (typeof CSSStyleSheet === 'undefined' || !('adoptedStyleSheets' in document)) return;

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    [data-bn='credential-list'] {
      list-style: none;
      padding: 0;
      margin: var(--space-4) 0 0;
      display: grid;
      gap: var(--space-2);
    }
    /*
     * One record, one boundary — the same card treatment the ledgers use at
     * narrow widths (see styles.css "mobile record cards"). A flat list of
     * hairline-separated rows made three passkeys read as six lines.
     */
    [data-bn='credential-list'] > li {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: var(--space-2) var(--space-4);
      padding: var(--space-3) var(--space-4);
      background: var(--surface-2);
      border: 1px solid var(--rule);
      border-radius: var(--radius-sm);
      align-items: center;
    }
    [data-bn='credential-list'] > li > header {
      grid-column: 1;
      display: grid;
      gap: 2px;
      min-inline-size: 0;
    }
    [data-bn='credential-list'] > li > header > strong {
      font-weight: var(--weight-strong);
      color: var(--ink);
      overflow-wrap: anywhere;
    }
    [data-bn='credential-list'] > li > header > small {
      font-size: var(--type-xs);
      color: var(--ink-dim);
    }
    [data-bn='credential-list'] > li > footer {
      grid-column: 2;
      display: flex;
      gap: var(--space-2);
    }

    [data-bn='credential-list'] form {
      display: flex;
      flex-wrap: wrap;
      gap: var(--space-2);
      align-items: center;
      min-inline-size: 0;
      margin: 0;
    }
    [data-bn='credential-list'] form input {
      flex: 1 1 10rem;
      inline-size: auto;
      min-inline-size: 0;
      min-block-size: 36px;
      padding: var(--space-2) var(--space-3);
      background: var(--surface);
      border: 1px solid var(--rule);
      border-radius: var(--radius-sm);
      color: var(--ink);
    }
    /* Rename / Revoke / Save / Cancel are renderButton output now, so they
       carry the package's own [data-bn="button"] rules. Only the row's
       compact sizing is set here: a full-height 48px control would push the
       credential rows apart, and these sit inside a record card rather than
       at the end of a form. */
    [data-bn='credential-list'] [data-bn='button'] {
      block-size: auto;
      min-block-size: 36px;
      padding-inline: var(--space-3);
      font-size: var(--type-xs);
    }
    /* Narrow cards (the <section> is the container): actions drop below the
       name instead of sharing a row, so an open rename form cannot push
       Rename/Revoke past the viewport edge. */
    @container (max-width: 32rem) {
      [data-bn='credential-list'] > li {
        grid-template-columns: 1fr;
      }
      [data-bn='credential-list'] > li > footer {
        grid-column: 1;
        grid-row: auto;
        flex-wrap: wrap;
      }
    }
  `);

  document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
  attached = true;
}
