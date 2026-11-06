// One safe file name stem for every download (Bunya file, ZIP, images):
// lowercase letters, digits and hyphens, so any name
// works on Windows, macOS and Linux and never carries path characters.
export const FILENAME_STEM_MAX = 80;

export function fileStem(name: string, fallback = "bunya-diagram"): string {
  const stem = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, FILENAME_STEM_MAX)
    .replace(/^-+|-+$/g, "");
  return stem || fallback;
}
