export const VALID_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

export function isValidSlug(slug: string): boolean {
  return VALID_SLUG.test(slug)
}
