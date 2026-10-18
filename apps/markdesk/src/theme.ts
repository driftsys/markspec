/**
 * Set `data-theme` on `<html>` from the system colour scheme and keep it in
 * step when the scheme changes. Returns a function that stops following.
 */
export function followColorScheme(
  match: (query: string) => MediaQueryList = (query) =>
    window.matchMedia(query),
): () => void {
  const query = match("(prefers-color-scheme: dark)");
  const apply = (dark: boolean) => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  };
  apply(query.matches);
  const onChange = (event: { matches: boolean }) => apply(event.matches);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}
