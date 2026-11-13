/**
 * @module core/gherkin/load
 *
 * Lazy loader for the `@cucumber/gherkin` parser. The parser is imported
 * dynamically, so commands that never read Gherkin blocks do not load it.
 */

import type { Dialect } from "@cucumber/gherkin";
import type { GherkinDocument } from "@cucumber/messages";

/** The parts of the Gherkin parser that MarkSpec uses. */
export interface GherkinApi {
  /**
   * Parse Gherkin source text. Builds a new parser for each call, because
   * the parser keeps state. Throws the library's composite error when the
   * text is not valid Gherkin.
   */
  parse(text: string): GherkinDocument;
  /** Language dialects, keyed by language code (for example `fr`). */
  readonly dialects: Record<string, Dialect>;
}

let loaded: GherkinApi | undefined;
let pending: Promise<GherkinApi> | undefined;

/** The two parser modules, as the importer returns them. */
type ParserModules = [
  typeof import("@cucumber/gherkin"),
  typeof import("@cucumber/messages"),
];

/** Imports the two parser modules. */
const importModules = (): Promise<ParserModules> =>
  Promise.all([
    import("@cucumber/gherkin"),
    import("@cucumber/messages"),
  ]);

/**
 * Load the Gherkin parser. The result is cached; a failed load is not
 * cached, so a later call tries again.
 *
 * @param importer - Replaces the module import. Internal, for tests.
 */
export function loadGherkin(
  importer: () => Promise<ParserModules> = importModules,
): Promise<GherkinApi> {
  if (loaded) return Promise.resolve(loaded);
  pending ??= importer().then(
    ([
      { AstBuilder, GherkinClassicTokenMatcher, Parser, dialects },
      { IdGenerator },
    ]) => {
      const api: GherkinApi = {
        parse: (text) =>
          new Parser(
            new AstBuilder(IdGenerator.incrementing()),
            new GherkinClassicTokenMatcher(),
          ).parse(text),
        dialects,
      };
      loaded = api;
      return api;
    },
  ).catch((err) => {
    pending = undefined;
    throw err;
  });
  return pending;
}

/** The parser when it is already loaded, otherwise `undefined`. */
export function loadedGherkin(): GherkinApi | undefined {
  return loaded;
}
