# Process

This document describes the development workflow and planning model used across
driftsys repositories. For the full process specification, see [fast-track].

## Development workflow

```text
Story/Task → ATDD → TDD → Implement → Update SPEC/USAGE → PR → Review → Merge
```

1. **Start from acceptance criteria.** Read the issue and write acceptance tests
   first (ATDD).
2. **TDD the implementation.** Write unit tests, then make them pass.
3. **Update SPEC and USAGE.** Keep specification and usage documentation in sync
   with the implementation.
4. **One PR per story or task.** Each PR ships implementation, tests, and
   documentation together.
5. **Single conventional commit per PR.** Squash cleanup commits before pushing.
6. **Review before merge.** Classify findings by severity (K0/K1/K2). Fix K0
   immediately in the PR. Open debt issues for K1/K2.
7. **Merge commit.** Merge with `--merge`, not `--squash` — preserves the PR
   reference in `git log`.

## Issue hierarchy

```text
Initiative (label only — initiative:<name>)
  └── Epic (issue + epic + epic:<name> labels)
        ├── Story  — user-facing requirement
        ├── Task   — technical requirement
        └── Debt   — refactoring / review findings
```

## Issue types

| Type  | Label   | Purpose                                    |
| ----- | ------- | ------------------------------------------ |
| Epic  | `epic`  | Tracking issue grouping stories/tasks/debt |
| Story | `story` | User-facing requirement                    |
| Task  | `task`  | Technical requirement (not user-visible)   |
| Debt  | `debt`  | Refactoring or review finding              |
| Bug   | `bug`   | Defect                                     |

## Severity

| Label | Meaning      |
| ----- | ------------ |
| `K0`  | Must-have    |
| `K1`  | Should-fix   |
| `K2`  | Nice-to-have |

## Effort

| Label | Size                             |
| ----- | -------------------------------- |
| `XS`  | Trivial — typo, one-liner        |
| `S`   | Small — single file, < 1 hour    |
| `M`   | Medium — a few files, half a day |
| `L`   | Large — cross-cutting, full day  |
| `XL`  | Extra large — multi-day          |

## Priority

|    | XS | S  | M  | L    | XL   |
| -- | -- | -- | -- | ---- | ---- |
| K0 | P0 | P0 | P0 | P1   | P1   |
| K1 | P0 | P1 | P1 | P2   | drop |
| K2 | P1 | P2 | P2 | drop | drop |

- **P0:** do now. **P1:** do next. **P2:** do when convenient. **Drop:** close
  as won't-fix.
- K0 never drops — must-haves always get done.

## Issue rules

1. Every story/task/debt has `Epic:` as first non-blank body line (`Epic: #N` or
   `Epic: org/repo#N`).
2. One `epic:<name>` label plus type label per issue.
3. When creating an issue, update the parent epic's task list.
4. Epics live at org level (`driftsys/.github`) for cross-repo concerns or at
   repo level for repo-specific work.
5. Epics are created by humans. Agents create stories, tasks, and debt.

## Review findings

- **K0** — fix in the PR, or open a bug issue.
- **K1 / K2** — open a debt issue with severity, effort, and priority labels.

[fast-track]: https://github.com/driftsys/fast-track
