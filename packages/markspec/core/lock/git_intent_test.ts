import { assertEquals } from "@std/assert";
import { parseLsRemote, resolveIntent } from "./git_intent.ts";

// `git ls-remote --symref <url>` sample. Annotated tag v2.0.0 has a peeled
// `^{}` line whose sha is the underlying commit — that is the sha we pin.
const LS_REMOTE = [
  "ref: refs/heads/main\tHEAD",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tHEAD",
  "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/heads/main",
  "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\trefs/heads/dev",
  "1111111111111111111111111111111111111111\trefs/tags/v1.0.0",
  "cccccccccccccccccccccccccccccccccccccccc\trefs/tags/v2.0.0",
  "2222222222222222222222222222222222222222\trefs/tags/v2.0.0^{}",
  "dddddddddddddddddddddddddddddddddddddddd\trefs/tags/nightly",
].join("\n");

Deno.test("parseLsRemote: extracts branches, tags (peeled), and HEAD", () => {
  const rl = parseLsRemote(LS_REMOTE);
  assertEquals(rl.headSha, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assertEquals(rl.defaultBranch, "main");
  // Peeled annotated tag resolves to the commit (2222…), not the tag object.
  assertEquals(
    rl.refs.find((r) => r.name === "v2.0.0")?.sha,
    "2222222222222222222222222222222222222222",
  );
  assertEquals(rl.refs.find((r) => r.name === "main")?.kind, "branch");
});

Deno.test("resolveIntent auto: highest semver tag wins", () => {
  const rl = parseLsRemote(LS_REMOTE);
  assertEquals(resolveIntent("auto", rl), {
    sha: "2222222222222222222222222222222222222222",
    resolved: "tag:v2.0.0",
  });
});

Deno.test("resolveIntent auto: no semver tags → default branch head", () => {
  const rl = parseLsRemote(
    "ref: refs/heads/main\tHEAD\n" +
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\tHEAD\n" +
      "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\trefs/heads/main",
  );
  assertEquals(resolveIntent("auto", rl), {
    sha: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    resolved: "branch:main",
  });
});

Deno.test("resolveIntent: explicit tag name", () => {
  const rl = parseLsRemote(LS_REMOTE);
  assertEquals(resolveIntent("v1.0.0", rl), {
    sha: "1111111111111111111111111111111111111111",
    resolved: "tag:v1.0.0",
  });
});

Deno.test("resolveIntent: explicit branch name", () => {
  const rl = parseLsRemote(LS_REMOTE);
  assertEquals(resolveIntent("dev", rl), {
    sha: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    resolved: "branch:dev",
  });
});

Deno.test("resolveIntent: bare sha passthrough", () => {
  const rl = parseLsRemote(LS_REMOTE);
  assertEquals(
    resolveIntent("2222222222222222222222222222222222222222", rl),
    {
      sha: "2222222222222222222222222222222222222222",
      resolved: "sha:2222222222222222222222222222222222222222",
    },
  );
});

Deno.test("resolveIntent: uppercase 40-hex sha is accepted and lowercased", () => {
  const rl = parseLsRemote(LS_REMOTE);
  // A mixed-case sha that matches no tag/branch must resolve as a bare-sha
  // pin, normalized to lowercase so the lockfile is byte-identical whatever
  // case the author typed.
  const r = resolveIntent("ABCDEF0123456789ABCDEF0123456789ABCDEF01", rl);
  assertEquals(r, {
    sha: "abcdef0123456789abcdef0123456789abcdef01",
    resolved: "sha:abcdef0123456789abcdef0123456789abcdef01",
  });
});

Deno.test("resolveIntent: unknown ref errors", () => {
  const rl = parseLsRemote(LS_REMOTE);
  const r = resolveIntent("v9.9.9", rl);
  assertEquals("error" in r, true);
});
