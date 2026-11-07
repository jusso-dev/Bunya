// String literals for each export language. Validation keeps document values
// to a plain literal grammar, except email addresses, which Azure allows to
// contain characters such as an apostrophe.
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
