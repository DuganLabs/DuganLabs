/**
 * Apple 27 adoption.
 *
 * `@basenative/platform` is the iOS / iPadOS / macOS 27 kit (colour, type,
 * materials, light and dark, and a derived increased-contrast palette).
 * GreenPut loads that sheet and then writes its own brand onto the accent.
 *
 * The kit's accent is blue, and its controls paint
 * `--bn-plat-color-accents-blue` for both fills and text. The leaf
 * `#4EAF7C` is 2.7:1 as text on white and as white text on the leaf, so:
 *
 *   - `--bn-plat-color-accent` is the leaf. That is the tint token.
 *   - Prominent buttons fill with `--gp-button-fill` (green-600) and
 *     label in white. White on the leaf is 2.71:1; white on green-600
 *     is 5.32:1. The leaf stays the accent for icons, links and glow.
 *   - Text tint, focus, checkboxes and the switch use `#1F7A4D` in light
 *     and `#8FD9B0` in dark — the same green at a step that clears 4.5:1.
 *   - Increased contrast darkens the tint to `#17603C` and puts white on it.
 *
 * iOS metrics are pinned (`data-bn-platform="ios"`). The macOS control size
 * drops buttons to about 24px, under the 44px target this product already
 * promises. Desktop still gets the iOS 27 type, materials and controls.
 *
 * The kit's secondary label is a translucent gray under 4.5:1 on the
 * grouped ground, so muted body text stays on GreenPut's ink ramp. Job
 * status (idle / moving / good / dead) stays the four contractor families;
 * the kits have no equivalent pairing that already clears those badges.
 */
import { GP_BRAND_INK, GP_BRAND_LEAF } from './tokens.js';
import {
  PLATFORM_COMPONENTS_CSS,
  PLATFORM_TOKENS_CSS,
} from './platform-sheet.js';

/** Leaf. The value written onto `--bn-plat-color-accent`. */
export const GP_PLAT_TINT = GP_BRAND_LEAF;
/** AA text and control tint on the light materials. */
export const GP_PLAT_TINT_TEXT = '#1F7A4D';
/** AA text tint on the dark materials. */
export const GP_PLAT_TINT_TEXT_DARK = '#8FD9B0';
/** Increased-contrast tint. White on this clears 4.5:1. */
export const GP_PLAT_TINT_CONTRAST = '#17603C';
/** Muted ink that clears 4.5:1 on the dark grouped ground. */
export const GP_PLAT_MUTED_DARK = '#C8C2B8';

const ACCENT_DECLARATIONS = `
    --bn-plat-color-accent: ${GP_PLAT_TINT} !important;
    --bn-plat-color-accents-blue: ${GP_PLAT_TINT_TEXT} !important;
    --bn-plat-color-accent-blue: ${GP_PLAT_TINT_TEXT} !important;
    --bn-plat-color-accents-green: ${GP_PLAT_TINT_TEXT} !important;
    --bn-plat-color-miscellaneous-tab-bar-selection: ${GP_PLAT_TINT_TEXT} !important;
    --gp-plat-tint: ${GP_PLAT_TINT};
    --gp-plat-tint-text: ${GP_PLAT_TINT_TEXT};`;

const DARK_DECLARATIONS = `
    --bn-plat-color-accent: ${GP_PLAT_TINT} !important;
    --bn-plat-color-accents-blue: ${GP_PLAT_TINT_TEXT_DARK} !important;
    --bn-plat-color-accent-blue: ${GP_PLAT_TINT_TEXT_DARK} !important;
    --bn-plat-color-accents-green: ${GP_PLAT_TINT_TEXT} !important;
    --bn-plat-color-miscellaneous-tab-bar-selection: ${GP_PLAT_TINT_TEXT_DARK} !important;
    --gp-plat-tint: ${GP_PLAT_TINT};
    --gp-plat-tint-text: ${GP_PLAT_TINT_TEXT_DARK};
    --gp-text-muted: ${GP_PLAT_MUTED_DARK};
    --gp-text-subtle: ${GP_PLAT_MUTED_DARK};
    --gp-primary-text: ${GP_PLAT_TINT_TEXT_DARK};
    --gp-focus: ${GP_PLAT_TINT_TEXT_DARK};`;

const CONTRAST_DECLARATIONS = `
    --bn-plat-color-accent: ${GP_PLAT_TINT_CONTRAST} !important;
    --bn-plat-color-accents-blue: ${GP_PLAT_TINT_CONTRAST} !important;
    --bn-plat-color-accent-blue: ${GP_PLAT_TINT_CONTRAST} !important;
    --bn-plat-color-accents-green: ${GP_PLAT_TINT_CONTRAST} !important;
    --bn-plat-color-miscellaneous-tab-bar-selection: ${GP_PLAT_TINT_CONTRAST} !important;
    --gp-primary: ${GP_PLAT_TINT_CONTRAST};
    --gp-primary-hover: ${GP_BRAND_INK};
    --gp-primary-text: ${GP_PLAT_TINT_CONTRAST};
    --gp-primary-fg: #FFFFFF;
    --gp-button-fill: ${GP_PLAT_TINT_CONTRAST};
    --gp-button-fill-hover: ${GP_BRAND_INK};
    --gp-button-fg: #FFFFFF;
    --gp-focus: ${GP_PLAT_TINT_CONTRAST};
    --gp-plat-tint: ${GP_PLAT_TINT_CONTRAST};
    --gp-plat-tint-text: ${GP_PLAT_TINT_CONTRAST};`;

/**
 * Brand tint, dark scheme and increased contrast, after the kit sheet so
 * source order wins. `!important` is confined to the accent names the kit
 * redeclares inside heavier selectors (dark, contrast, macOS).
 */
export const GP_PLATFORM_ACCENT_CSS = `
:root {${ACCENT_DECLARATIONS}
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {${DARK_DECLARATIONS}
  }
}

[data-theme="dark"] {${DARK_DECLARATIONS}
}

@media (prefers-contrast: more) {
  :root:not([data-bn-contrast="default"]) {${CONTRAST_DECLARATIONS}
  }
}

[data-bn-contrast="more"] {${CONTRAST_DECLARATIONS}
}

[data-bn="bn-button"][data-variant="prominent"],
[data-bn="bn-button"][data-variant="glass-prominent"],
[data-bn-button][data-bn-variant="primary"] {
  background: var(--gp-button-fill);
  color: var(--gp-button-fg);
}

[data-bn="bn-button"][data-variant="prominent"]:hover,
[data-bn="bn-button"][data-variant="glass-prominent"]:hover,
[data-bn-button][data-bn-variant="primary"]:hover {
  background: var(--gp-button-fill-hover);
  color: var(--gp-button-fg);
}

[data-bn="bn-button"][data-variant="borderless"],
[data-bn="bn-button"][data-variant="bordered"],
[data-bn="bn-tab"][aria-current="page"],
[data-bn="bn-sidebar-item"][aria-current="page"] {
  color: var(--gp-primary-text);
}
`;

/** Kit tokens, kit controls, then the GreenPut tint. Load it before `--gp-*`. */
export const GP_PLATFORM_CSS = `${PLATFORM_TOKENS_CSS}\n${PLATFORM_COMPONENTS_CSS}\n${GP_PLATFORM_ACCENT_CSS}`;

/**
 * Attribute for the document element. iOS metrics, no forced theme, so
 * `prefers-color-scheme` and `prefers-contrast` select the kit palette.
 */
export const GP_PLATFORM_ROOT_ATTR = 'data-bn-platform="ios"';
