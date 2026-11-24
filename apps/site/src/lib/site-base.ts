import {
  normalizeBasePath,
  withBasePath as withBasePathImpl,
} from "../../../../packages/shared/src/site-base.js";

export { normalizeBasePath };

/**
 * Site-side wrapper: default to Astro's BASE_URL (which Astro derives from the
 * `base` config) while sharing the implementation with data-core href
 * generation.
 */
export function withBasePath(pathname: string, basePath: string | undefined = import.meta.env.BASE_URL) {
  return withBasePathImpl(pathname, basePath);
}
