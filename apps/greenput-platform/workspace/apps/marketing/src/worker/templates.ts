/**
 * The marketing document shell. Every HTML route is a v4 page: gp4.css,
 * Inter, and the light palette. Page bodies live in gp4-pages.ts and
 * gp4-content.ts. The document does not follow the operating-system color scheme.
 */

export const layoutTemplate = `<!doctype html>
<html lang="en" data-bn-platform="ios" data-gp4="{{ gp4Flag }}" data-density="{{ gp4DensityAttr }}">
  <head>
    <meta charset="utf-8" />
    <title>{{ pageTitle }} — Greenput</title>
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="description" content="{{ pageDescription }}" />
    <template @if="noindex">
      <meta name="robots" content="noindex, nofollow" />
    </template>
    <meta name="theme-color" content="#07231a" />
    <meta name="color-scheme" content="light" />
    <meta name="mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-title" content="Greenput" />
    <template @if="hasCanonical">
      <link rel="canonical" href="{{ canonicalUrl }}" />
    </template>

    <!-- Open Graph -->
    <meta property="og:site_name" content="Greenput" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="{{ pageTitle }} — Greenput" />
    <meta property="og:description" content="{{ pageDescription }}" />
    <template @if="hasCanonical">
      <meta property="og:url" content="{{ canonicalUrl }}" />
    </template>
    <meta property="og:image" content="{{ ogImageUrl }}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="{{ ogImageAlt }}" />
    <meta property="og:locale" content="en_US" />

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="{{ pageTitle }} — Greenput" />
    <meta name="twitter:description" content="{{ pageDescription }}" />
    <meta name="twitter:image" content="{{ ogImageUrl }}" />

    <link rel="alternate" type="text/plain" href="https://greenput.com/llms.txt" title="Plain-language summary for AI assistants" />
    <link rel="alternate" type="text/plain" href="https://greenput.com/llms-full.txt" title="Full homeowner guides for AI assistants" />
    <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
    <link rel="mask-icon" href="/favicon.svg" color="#0F0E0C" />
    <link rel="preload" href="/fonts/Inter.ttf" as="font" type="font/ttf" crossorigin />
    <link rel="stylesheet" href="/css/gp4.css" />
    <!--__STRUCTURED_DATA__-->
    </head>
  <body>
    {{ shellHtml }}
    <script src="/js/app.js" defer></script>
  </body>
</html>`;

export {
  homeTemplate,
  featuresTemplate,
  contactTemplate,
  aboutTemplate,
} from './gp4-pages.js';

export {
  pricingTemplate,
  privacyTemplate,
  termsTemplate,
  technologyTemplate,
  aiTemplate,
  investorsTemplate,
  notFoundTemplate,
} from './gp4-content.js';
