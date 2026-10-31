/**
 * @module tests/e2e/nested_fixtures
 *
 * Shared fixture data for the nested-project e2e tests of `lint` and `fmt`
 * (#856). Not a test module: importing it registers no tests.
 */

/** Profile of the parent project: a `requirement` type only. */
export const PARENT_PROFILE = `id: "@acme/parent"
version: 0.1.0
profile:
  types:
    requirement:
      extends: Requirement
      display-id-pattern: "REQ-{n:04d}"
`;

/** Profile of the nested project: a `widget` type the parent does not know. */
export const SUB_PROFILE = `id: "@acme/widget"
version: 0.1.0
profile:
  types:
    widget:
      extends: Requirement
      display-id-pattern: "WID-{n:04d}"
`;

/** Parent project configuration files. */
export const PARENT_FILES: Record<string, string> = {
  "project.yaml": "name: nested-parent\nversion: 0.1.0\n",
  ".markspec.yaml": "profiles:\n  - ./profiles/p\n",
  "profiles/p/markspec.yaml": PARENT_PROFILE,
};

/** Nested project (`sub/`) configuration files. */
export const SUB_FILES: Record<string, string> = {
  "sub/project.yaml": "name: nested-sub\nversion: 0.1.0\n",
  "sub/.markspec.yaml": "profiles:\n  - ./profiles/w\n",
  "sub/profiles/w/markspec.yaml": SUB_PROFILE,
};

/** A requirement body with a vague term (INCOSE finding, a warning). */
export const VAGUE_REQ = `# Requirements

- [REQ-0001] A requirement

  The system shall respond as appropriate.

      Id: 01REQ000000000000000000001
      Type: requirement
`;

/** A `widget` entry with a vague term; unknown to the parent profile. */
export const VAGUE_WIDGET = `# Widgets

- [WID-0001] A widget

  The widget shall respond as appropriate.

      Id: 01WDG000000000000000000001
      Type: widget
`;

/** A `requirement` entry without findings. */
export const CLEAN_REQ_DOC = `# Requirements

- [REQ-0001] Response time

  The system shall respond within 200 ms.

      Id: 01REQ000000000000000000001
      Type: requirement
`;
