import { afterEach, expect, it } from "vitest";
import { followColorScheme } from "./theme";

afterEach(() => {
  delete document.documentElement.dataset.theme;
});

function fakeQuery(initial: boolean) {
  const listeners = new Set<(event: { matches: boolean }) => void>();
  const query = {
    matches: initial,
    addEventListener: (_: string, l: (event: { matches: boolean }) => void) =>
      listeners.add(l),
    removeEventListener: (
      _: string,
      l: (event: { matches: boolean }) => void,
    ) => listeners.delete(l),
    change(matches: boolean) {
      query.matches = matches;
      for (const l of listeners) l({ matches });
    },
    listeners,
  };
  return query;
}

it("sets data-theme from the colour scheme and follows changes", () => {
  const query = fakeQuery(true);
  const stop = followColorScheme(() => query as unknown as MediaQueryList);
  expect(document.documentElement.dataset.theme).toBe("dark");
  query.change(false);
  expect(document.documentElement.dataset.theme).toBe("light");
  stop();
  expect(query.listeners.size).toBe(0);
});
