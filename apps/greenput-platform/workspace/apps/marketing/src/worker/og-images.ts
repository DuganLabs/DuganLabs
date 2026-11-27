/**
 * Per-route Open Graph images, generated — do not edit the base64 by hand.
 *
 * One 1200×630 card per marketing route: ink background, the leaf mark,
 * the route's headline in Archivo. The PNGs ride inside these modules as
 * base64 because the change pipeline for this app is text-only; the
 * worker decodes them and serves the bytes at /og/<slug>.png (see
 * index.ts). The cards live in og-images-1..6.ts (split for transport)
 * and are merged here. Regenerate with
 * apps/marketing/scripts/generate-og-images.mjs.
 */
import { OG_IMAGES_PART_1 } from './og-images-1';
import { OG_IMAGES_PART_2 } from './og-images-2';
import { OG_IMAGES_PART_3 } from './og-images-3';
import { OG_IMAGES_PART_4 } from './og-images-4';
import { OG_IMAGES_PART_5 } from './og-images-5';
import { OG_IMAGES_PART_6 } from './og-images-6';

export interface OgImage {
  /** Base64-encoded PNG, 1200×630. */
  base64: string;
  /** og:image:alt for the route — what the card says, in words. */
  alt: string;
}

/** Route name → card. 'home' is the '/' route. */
export const OG_IMAGES: Record<string, OgImage> = {
  ...OG_IMAGES_PART_1,
  ...OG_IMAGES_PART_2,
  ...OG_IMAGES_PART_3,
  ...OG_IMAGES_PART_4,
  ...OG_IMAGES_PART_5,
  ...OG_IMAGES_PART_6,
};
