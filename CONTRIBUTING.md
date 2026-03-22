# Contributing to driftsys

## Reporting issues

Open bugs and feature requests in the relevant repository's issue tracker. For
security vulnerabilities, see [SECURITY.md](SECURITY.md).

## Code of conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md).

## AI policy

We use AI and accept AI-assisted contributions, in the spirit of the
[Linux Foundation Generative AI Policy][lf-ai]. We prefer providers that are
[Frontier AI Safety Commitments][faisc] signatories. Humans decide, AI assists.
Same review and quality bar for all code.

- AI assists execution — humans own direction, architecture, and design.
- If you submit it, you own it — regardless of origin.
- Do not merge code you do not fully understand.
- Include a `Co-Authored-By` trailer for AI contributions.
- Contributors ensure AI-generated content complies with the project license.

## Commit messages

Follow [Conventional Commits][cc]. Write the description in imperative mood —
e.g., "add support for X" instead of "added support for X".

Types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `ci`, `build`,
`perf`, `style`.

Squash work into one conventional commit per task.

## Pull requests

1. Create a branch from `main` with a short, descriptive name — e.g.,
   `42-fix-tag-detection`.
2. Implement the change with tests.
3. One conventional commit per PR. Squash cleanup commits before pushing.
4. Make sure all checks pass before opening the PR.
5. Reference the related issue in the PR description.
6. Every PR ships implementation, tests, and documentation together.
7. Merge with `--merge`, not `--squash`.

For the planning model, issue types, and severity/priority matrix, see
[PROCESS.md](PROCESS.md).

## Code review

Reviews check for functionality, complexity, naming, tests, and documentation.
Use intention-revealing names — nouns for types, verbs for functions, one word
per concept. Be respectful — assume competence and goodwill.

## Coding style

Coding standards and style are enforced through linters and formatters.
Configurations follow community best practices.

| Lang       | Style                           | Format               | Lint           |
| ---------- | ------------------------------- | -------------------- | -------------- |
| Markdown   | [CommonMark Specification]      | [dprint]             | [markdownlint] |
| Shell      | [Google Shell style guide]      | [shfmt]              | [shellcheck]   |
| C          | [Google C++ style guide]        | [clang-format]       | [clang-tidy]   |
| C++        | [Google C++ style guide]        | [clang-format]       | [clang-tidy]   |
| Java       | [Google Java Style Guide]       | [google-java-format] | [errorprone]   |
| Rust       | [Rust Style Guide]              | [rustfmt]            | [clippy]       |
| Kotlin     | [Kotlin Coding Convention]      | [ktfmt]              | [detekt]       |
| TypeScript | [Google TypeScript style guide] | [dprint]             | [biome]        |

<!-- markdownlint-disable MD028 -->

> For security-hardened code, follow [SEI CERT C].

> For safety-critical targets, C and C++ code follows the [C++ Core Guidelines]
> instead of Google's, and must also comply with [MISRA C] / [MISRA C++].

> For Android targets, also follow the [Android Open Source Code Style], the
> [Android Kotlin style guide], the [Android Kotlin common patterns], and the
> [Android Kotlin interop guide].

<!-- markdownlint-enable MD028 -->

## Documentation style

Write documentation in Markdown following the
[Google documentation style guide][gdsg]:

- Use second person ("you") and active voice.
- Use sentence case for headings.
- Use numbered lists for sequences, bulleted lists for everything else.
- Put code-related text in code blocks.

<!-- ref links -->

[cc]: https://www.conventionalcommits.org/
[CommonMark Specification]: https://commonmark.org/
[dprint]: https://dprint.dev/
[markdownlint]: https://github.com/DavidAnson/markdownlint
[Google Shell style guide]: https://google.github.io/styleguide/shellguide.html
[shfmt]: https://github.com/mvdan/sh
[shellcheck]: https://github.com/koalaman/shellcheck
[Google C++ style guide]: https://google.github.io/styleguide/cppguide.html
[clang-format]: https://clang.llvm.org/docs/ClangFormat.html
[clang-tidy]: https://clang.llvm.org/extra/clang-tidy/
[Google Java Style Guide]: https://google.github.io/styleguide/javaguide.html
[google-java-format]: https://github.com/google/google-java-format
[errorprone]: https://errorprone.info/
[Rust Style Guide]: https://doc.rust-lang.org/nightly/style-guide/
[rustfmt]: https://github.com/rust-lang/rustfmt
[clippy]: https://github.com/rust-lang/rust-clippy
[Kotlin Coding Convention]: https://kotlinlang.org/docs/reference/coding-conventions.html
[ktfmt]: https://github.com/facebook/ktfmt
[detekt]: https://github.com/detekt/detekt
[Google TypeScript style guide]: https://google.github.io/styleguide/tsguide.html
[biome]: https://biomejs.dev/
[SEI CERT C]: https://wiki.sei.cmu.edu/confluence/display/c/SEI+CERT+C+Coding+Standard
[C++ Core Guidelines]: https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines
[MISRA C]: https://www.misra.org.uk/misra-c/
[MISRA C++]: https://www.misra.org.uk/misra-c-plus-plus/
[Android Open Source Code Style]: https://source.android.com/setup/contribute/code-style
[Android Kotlin style guide]: https://developer.android.com/kotlin/style-guide
[Android Kotlin common patterns]: https://developer.android.com/kotlin/common-patterns
[Android Kotlin interop guide]: https://developer.android.com/kotlin/interop
[gdsg]: https://developers.google.com/style
[faisc]: https://www.gov.uk/government/publications/frontier-ai-safety-commitments-ai-seoul-summit-2024
[lf-ai]: https://www.linuxfoundation.org/blog/linux-foundation-generative-ai-policy
