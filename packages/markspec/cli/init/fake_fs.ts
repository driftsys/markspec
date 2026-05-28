/**
 * @module cli/init/fake_fs
 *
 * Minimal filesystem abstraction every init module consumes. Production
 * code passes a Deno-backed implementation; unit tests use {@linkcode createMemFs}
 * to avoid touching disk.
 */

import { dirname } from "@std/path";

/** Filesystem operations init needs. */
export interface MemFs {
  read(path: string): Promise<string | undefined>;
  write(path: string, content: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  remove(path: string): Promise<void>;
  listEntries(path: string): Promise<readonly string[]>;
}

export interface MemFsOptions {
  /** Auto-create parent dirs on write (default true). */
  readonly autoMkdir?: boolean;
}

/** In-memory MemFs for unit tests. */
export function createMemFs(options: MemFsOptions = {}): MemFs {
  const autoMkdir = options.autoMkdir ?? true;
  const files = new Map<string, string>();
  const dirs = new Set<string>(["/"]);

  function ensureParents(path: string): void {
    let dir = dirname(path);
    while (dir !== "/" && dir !== "." && !dirs.has(dir)) {
      dirs.add(dir);
      dir = dirname(dir);
    }
  }

  return {
    read: (path) => Promise.resolve(files.get(path)),
    write: (path, content) => {
      const parent = dirname(path);
      if (!dirs.has(parent) && parent !== "/" && parent !== ".") {
        if (autoMkdir) {
          ensureParents(path);
        } else {
          return Promise.reject(
            new Error(`MemFs: parent dir missing for ${path}`),
          );
        }
      }
      files.set(path, content);
      return Promise.resolve();
    },
    exists: (path) => Promise.resolve(files.has(path) || dirs.has(path)),
    mkdir: (path) => {
      dirs.add(path);
      ensureParents(path + "/.");
      return Promise.resolve();
    },
    remove: (path) => {
      files.delete(path);
      dirs.delete(path);
      return Promise.resolve();
    },
    listEntries: (path) => {
      const prefix = path.endsWith("/") ? path : path + "/";
      const seen = new Set<string>();
      for (const f of files.keys()) {
        if (f.startsWith(prefix)) {
          const rest = f.slice(prefix.length);
          const head = rest.split("/")[0];
          if (head.length > 0) seen.add(head);
        }
      }
      for (const d of dirs) {
        if (d.startsWith(prefix) && d !== path) {
          const rest = d.slice(prefix.length);
          const head = rest.split("/")[0];
          if (head.length > 0) seen.add(head);
        }
      }
      return Promise.resolve([...seen]);
    },
  };
}

/** Deno-backed MemFs for production. */
export function createDenoFs(): MemFs {
  return {
    read: async (path) => {
      try {
        return await Deno.readTextFile(path);
      } catch {
        return undefined;
      }
    },
    write: async (path, content) => {
      await Deno.mkdir(dirname(path), { recursive: true });
      await Deno.writeTextFile(path, content);
    },
    exists: async (path) => {
      try {
        await Deno.stat(path);
        return true;
      } catch {
        return false;
      }
    },
    mkdir: async (path) => {
      await Deno.mkdir(path, { recursive: true });
    },
    remove: async (path) => {
      try {
        await Deno.remove(path);
      } catch { /* ignore missing */ }
    },
    listEntries: async (path) => {
      const out: string[] = [];
      try {
        for await (const e of Deno.readDir(path)) out.push(e.name);
      } catch { /* missing dir → empty */ }
      return out;
    },
  };
}
