export type ColorScheme = "light" | "dark";

const KEY = "dbmanager-theme";

export function storedTheme(): ColorScheme {
  try {
    return localStorage.getItem(KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: ColorScheme) {
  if (theme === "dark") document.documentElement.dataset.theme = "dark";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* private mode */
  }
}

export function sqlEditorTheme(theme: ColorScheme): string {
  return theme === "dark" ? "ssms-dark" : "ssms";
}

export function dbmlEditorTheme(theme: ColorScheme): string {
  return theme === "dark" ? "dbml-dark" : "dbml";
}
