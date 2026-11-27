/**
 * `@greenput/shared/design` — the one visual language behind app.greenput.com,
 * greenput.com and every `<slug>.greenput.com` contractor micro-site.
 *
 * Rationale and usage: `duganlabs-survey/greenput-visual-language.md`.
 */

export {
  GP_BRAND_INK,
  GP_BRAND_LEAF,
  GP_FONT_HREF,
  GP_FONT_STACK,
  GP_FONT_HEAD_HTML,
  GP_TOKENS_CSS,
  GP_BASE_CSS,
} from './tokens.js';

export {
  greenputMark,
  initialsFor,
  HOUSE_LINE_SVG,
  BOLT_SVG,
  type MarkOptions,
} from './mark.js';

export {
  GP_MARK_PALETTE,
  GP_MARK_RESERVED_HEXES,
  GP_MARK_SHAPES,
  GP_MARK_TREATMENTS,
  generatedIdentityFor,
  generatedMarkSvg,
  markTreatmentSvg,
  type GpBusinessRef,
  type GpGeneratedIdentity,
  type GpMarkOrientation,
  type GpMarkShape,
  type GpMarkSvgOptions,
  type GpMarkTreatment,
  type GpMarkVariant,
} from './brand-identity.js';

export {
  GP_BRAND_ASSET_REVISION,
  GP_GENERIC_SHARE_IMAGE,
  GP_MARK_ASSET_SIZE,
  GP_SHARE_CARD_SIZE,
  SHARE_CARD_FACT_KEYS,
  brandAssetUrls,
  brandAssetVersion,
  normaliseBrandOrigin,
  shareCardFactsFor,
  tenantHostFor,
  type BrandAssetUrls,
  type GpBrandAssetSource,
  type ShareCardFacts,
} from './brand-assets.js';

export {
  GP_ICONS,
  type GpIconName,
  GP_ICON_MENU,
  GP_ICON_CLOSE,
  GP_ICON_PLUS,
  GP_ICON_CHEVRON_LEFT,
  GP_ICON_CHEVRON_RIGHT,
  GP_ICON_SEARCH,
  GP_ICON_PHONE,
  GP_ICON_MAIL,
  GP_ICON_CHECK,
  GP_ICON_SHIELD,
  GP_ICON_CLOCK,
  GP_ICON_PIN,
  GP_ICON_STAR,
} from './icons.js';

export { minifyCss, stylesheetVersion } from './css.js';

export {
  GP_PLATFORM_ACCENT_CSS,
  GP_PLATFORM_CSS,
  GP_PLATFORM_ROOT_ATTR,
  GP_PLAT_MUTED_DARK,
  GP_PLAT_TINT,
  GP_PLAT_TINT_CONTRAST,
  GP_PLAT_TINT_TEXT,
  GP_PLAT_TINT_TEXT_DARK,
} from './platform.js';

export {
  contrastRatio,
  parseCustomProperties,
  parseFirstCustomProperties,
  relativeLuminance,
  resolveColor,
} from './contrast.js';

export {
  SURFACE_CSS,
  renderFaqList,
  renderFloatingTabs,
  renderInfoCard,
  renderInsetRow,
  renderMetric,
  renderPageHero,
  renderPlanCards,
} from './surface/surface.js';
