// #48 — turns a title into a URL segment: "TikTok Automation!" -> "tiktok-automation"
function slugify(text) {
  return String(text || "")
    .toLowerCase()
    .normalize("NFKD") // split accents off their base letters
    .replace(/[̀-ͯ]/g, "") // drop the accents
    .replace(/[^a-z0-9]+/g, "-") // anything else becomes a separator
    .replace(/^-+|-+$/g, "") // trim separators
    .slice(0, 80);
}

/**
 * A slug that is not already taken.
 *
 * Slugs are unique-indexed, so a second "TikTok Automation" course would throw
 * on save. Appending -2, -3 ... keeps creation working instead of failing with
 * a duplicate-key error the admin can't act on.
 *
 * @param {import('mongoose').Model} Model  collection to check against
 * @param {string} text                     title to derive the slug from
 * @param {string|null} ignoreId            document to exclude (for updates)
 */
async function uniqueSlug(Model, text, ignoreId = null) {
  const base = slugify(text) || "course";
  let candidate = base;
  for (let i = 2; i < 200; i++) {
    const clash = await Model.findOne({
      slug: candidate,
      ...(ignoreId ? { _id: { $ne: ignoreId } } : {}),
    }).select("_id");
    if (!clash) return candidate;
    candidate = `${base}-${i}`;
  }
  // Pathological case only — guarantees uniqueness without an infinite loop.
  return `${base}-${Date.now()}`;
}

module.exports = { slugify, uniqueSlug };
