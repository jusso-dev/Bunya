// String literals for each export language. Used for values Azure accepts
// that the general literal grammar does not, such as an apostrophe in an
// email address. Callers validate the value first (see isEmailAddress).
export const quote = {
  // HCL double-quoted string: escape backslash, quote and interpolation.
  hcl: (value: string) => `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\$\{/g, "$${").replace(/%\{/g, "%%{")}"`,
  // Bicep single-quoted string: escape backslash, quote and interpolation.
  bicep: (value: string) => `'${value.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\$\{/g, "\\${")}'`,
  // Bash single-quoted string: close, add an escaped quote, reopen.
  bash: (value: string) => `'${value.replace(/'/g, `'\\''`)}'`,
  // PowerShell single-quoted string: double the quote.
  powershell: (value: string) => `'${value.replace(/'/g, "''")}'`,
};

// A practical email check: one @, no spaces or control characters, a dot in
// the domain. Apostrophes and plus signs are allowed, as Azure allows them.
export function isEmailAddress(value: string): boolean {
  return value.length <= 254 && /^[^\s@"\\<>()[\],;:]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(value);
}
