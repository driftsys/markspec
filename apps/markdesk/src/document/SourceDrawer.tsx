import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { DeskError } from "../api/client";
import { useOpenProduct } from "../app/useProduct";

/**
 * Read-only source text of a project file, with line numbers, scrolled to
 * `line` (1-based). Light paper with Plex Mono, never a dark editor theme.
 */
export function SourceDrawer({ path, line }: { path: string; line: number }) {
  const { client } = useOpenProduct();
  const [text, setText] = useState<string>();
  const [failed, setFailed] = useState(false);
  const target = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let current = true;
    setText(undefined);
    setFailed(false);
    client.file(path).then((source) => {
      if (current) setText(source.text);
    }, (error: unknown) => {
      // Network failures are handled by the connection watcher.
      if (error instanceof DeskError && error.code === "network") return;
      if (current) setFailed(true);
    });
    return () => {
      current = false;
    };
  }, [client, path]);

  useLayoutEffect(() => {
    target.current?.scrollIntoView?.({ block: "center" });
  }, [text, line]);

  return (
    <aside className="source-drawer" aria-label="Source text">
      {failed && <p role="alert">MarkDesk could not load the source.</p>}
      {text !== undefined && (
        <pre className="source-text">
          {text.split("\n").map((content, index) => {
            const isTarget = index + 1 === line;
            return (
              <div
                key={index}
                ref={isTarget ? target : undefined}
                className={isTarget ? "source-line is-target" : "source-line"}
              >
                <span className="source-gutter" aria-hidden="true">
                  {index + 1}
                </span>
                <span className="source-code">{content}</span>
              </div>
            );
          })}
        </pre>
      )}
    </aside>
  );
}
