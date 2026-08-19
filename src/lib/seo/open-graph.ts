import type { Metadata } from "next";

/**
 * Build a route-level `openGraph` block without losing the site-wide defaults.
 *
 * Next merges metadata per top-level field, so a route that declares its own
 * `openGraph` object REPLACES the root layout's entirely — silently dropping
 * `siteName`, `locale`, and the `opengraph-image` file-convention injection.
 * Verified: `/support` (no own openGraph) renders og:image, og:locale and
 * og:site_name; `/` and `/telegram` rendered none of them until they went
 * through this helper.
 *
 * The image is referenced by plain path and resolved against `metadataBase`.
 * That loses the content-hash query Next adds to the inherited version, which
 * only costs cache-busting precision on the social scrapers' side.
 */
export const OG_IMAGE = "/opengraph-image.png";

export const OG_IMAGE_ALT =
  "VoltFlow — трекер зарядки электромобиля: живые кВт·ч, стоимость сессии и история зарядок.";

type OpenGraph = NonNullable<Metadata["openGraph"]>;

export function openGraph(overrides: OpenGraph): OpenGraph {
  return {
    siteName: "VoltFlow",
    locale: "ru_RU",
    images: [{ url: OG_IMAGE, width: 1200, height: 630, alt: OG_IMAGE_ALT }],
    ...overrides,
  } as OpenGraph;
}
