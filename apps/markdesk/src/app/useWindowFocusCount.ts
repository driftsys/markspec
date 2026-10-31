import { useEffect, useState } from "react";

/**
 * Number of times the window has received focus since mount. Panes add it to
 * their effect dependencies to read the product again: the author may have
 * edited the product's files in another application.
 */
export function useWindowFocusCount(): number {
  const [focusCount, setFocusCount] = useState(0);
  useEffect(() => {
    const onFocus = () => setFocusCount((count) => count + 1);
    globalThis.addEventListener("focus", onFocus);
    return () => globalThis.removeEventListener("focus", onFocus);
  }, []);
  return focusCount;
}
