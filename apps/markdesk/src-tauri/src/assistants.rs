//! Locates the assistant CLIs (Claude Code, Codex, GitHub Copilot), checks
//! that each one runs, and reports whether it is signed in.
//!
//! A desktop app opened from the Dock or Finder does not inherit the shell
//! `PATH`, so [`locate`] also searches the well-known install directories.
//! Every process runs the resolved binary directly (no shell) with no stdin.

use std::ffi::{OsStr, OsString};
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

/// Time allowed for `<bin> --version`.
pub const VERSION_TIMEOUT: Duration = Duration::from_secs(5);
/// Time allowed for a sign-in check.
pub const STATUS_TIMEOUT: Duration = Duration::from_secs(10);

/// Time allowed for the Test action.
pub const TEST_TIMEOUT: Duration = Duration::from_secs(60);
/// The fixed prompt the Test action sends.
pub const TEST_PROMPT: &str = "Reply with the single word: ready";
/// Longest reply, in characters, that the Test action returns.
const REPLY_MAX_CHARS: usize = 500;
/// Number of stderr lines kept in a Test error.
const ERROR_STDERR_LINES: usize = 5;
/// Test error when the assistant exits with code 0 but prints nothing.
pub const NO_REPLY_ERROR: &str = "The assistant returned no reply.";

/// How often [`run`] checks whether the child exited or was cancelled.
const POLL_INTERVAL: Duration = Duration::from_millis(20);
/// After the child exits, how long [`run`] waits for its output to finish.
/// A background grandchild can keep the pipes open after the child exits.
const OUTPUT_GRACE: Duration = Duration::from_secs(1);
/// After [`run`] kills the processes that still hold a pipe, how long it
/// waits for the readers to collect the last bytes.
const AFTER_KILL_GRACE: Duration = Duration::from_millis(200);
/// Number of names [`create_test_dir`] tries before it gives up.
const TEST_DIR_ATTEMPTS: usize = 10;

/// Time allowed for a prompt run.
pub const PROMPT_TIMEOUT: Duration = Duration::from_secs(120);
/// Longest reply, in UTF-16 code units, that a prompt run accepts. A longer
/// reply is refused, not cut.
pub const PROMPT_REPLY_MAX_CHARS: usize = 20_000;
/// Longest built prompt, in bytes. The prompt is passed as one argument, so
/// it stays below the Linux limit of 131 072 bytes for one argument and the
/// macOS `ARG_MAX` of 1 048 576 bytes.
///
/// Not yet checked on Windows (#838): `CreateProcess` limits the whole
/// command line to 32 767 UTF-16 units, so a prompt between about 32 000 and
/// 100 000 bytes fails there when the process starts, with "could not run
/// the assistant", not with `PromptTooLong`. A `.cmd` shim run through
/// `cmd.exe` can also cut an argument at its first new line.
pub const PROMPT_MAX_BYTES: usize = 100_000;
/// Text added to the system prompt of a prompt run. It tells the model that
/// it has no tools, which stops it from writing tool calls as plain text in
/// a loop until the timeout when an instruction asks for a tool action.
pub const PROMPT_SYSTEM_TEXT: &str = "You have no tools in this session. You cannot read files, \
     run commands, or write files. Never write a tool call, an invoke block, or a function \
     call as text. Reply with the new body text only.";

/// An assistant the app can drive.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssistantId {
    ClaudeCode,
    Codex,
    Copilot,
}

/// Every assistant, in the order the settings screen lists them.
pub const ALL: [AssistantId; 3] = [
    AssistantId::ClaudeCode,
    AssistantId::Codex,
    AssistantId::Copilot,
];

impl AssistantId {
    /// Name of the executable on disk, without a platform suffix.
    pub fn binary(self) -> &'static str {
        match self {
            AssistantId::ClaudeCode => "claude",
            AssistantId::Codex => "codex",
            AssistantId::Copilot => "copilot",
        }
    }

    /// Arguments of the Test action: one short prompt, with tools, file
    /// writes and session storage turned off where the CLI allows it.
    pub fn test_args(self) -> Vec<String> {
        let args: &[&str] = match self {
            // `--max-turns` is not listed by `claude --help`, so it is not used;
            // with all tools disabled the reply takes one turn.
            AssistantId::ClaudeCode => &[
                "-p",
                TEST_PROMPT,
                "--output-format",
                "text",
                "--tools",
                "",
                "--no-session-persistence",
            ],
            AssistantId::Codex => &[
                "exec",
                "--sandbox",
                "read-only",
                "--skip-git-repo-check",
                "--ephemeral",
                TEST_PROMPT,
            ],
            AssistantId::Copilot => &[
                "-p",
                TEST_PROMPT,
                "-s",
                "--no-ask-user",
                "--deny-tool",
                "shell",
                "--deny-tool",
                "write",
            ],
        };
        args.iter().map(|arg| arg.to_string()).collect()
    }

    /// Arguments of a prompt run that sends `prompt`.
    ///
    /// `None` when the CLI has no proven flags that block reads, commands, and writes.
    /// Claude Code qualifies: `--tools ""` turns off every built-in tool, and
    /// `--strict-mcp-config` without `--mcp-config` drops the MCP servers of
    /// the user configuration, whose tools `--tools ""` does not cover.
    ///
    /// `--setting-sources ""` stops Claude Code from loading the user,
    /// project, and local settings files, so the hooks and plugins they
    /// enable do not run; sign-in still works. Managed (policy) settings, the
    /// plugins built into Claude Code, and user `CLAUDE.md` files still
    /// load. `--append-system-prompt` adds [`PROMPT_SYSTEM_TEXT`]: without
    /// it, an instruction that asks for a tool action can make the model
    /// write tool calls as text in a loop until the timeout.
    pub fn prompt_args(self, prompt: &str) -> Option<Vec<String>> {
        match self {
            AssistantId::ClaudeCode => Some(
                [
                    "-p",
                    prompt,
                    "--output-format",
                    "text",
                    "--tools",
                    "",
                    "--strict-mcp-config",
                    "--setting-sources",
                    "",
                    "--disable-slash-commands",
                    "--no-session-persistence",
                    "--append-system-prompt",
                    PROMPT_SYSTEM_TEXT,
                ]
                .iter()
                .map(|arg| arg.to_string())
                .collect(),
            ),
            AssistantId::Codex | AssistantId::Copilot => None,
        }
    }

    /// Whether this assistant can run a prompt; see [`AssistantId::prompt_args`].
    pub fn prompts_available(self) -> bool {
        self.prompt_args("").is_some()
    }

    /// The product name shown to the author.
    pub fn display_name(self) -> &'static str {
        match self {
            AssistantId::ClaudeCode => "Claude Code",
            AssistantId::Codex => "Codex",
            AssistantId::Copilot => "GitHub Copilot",
        }
    }
}

/// How a Test ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum TestOutcome {
    Ok,
    /// The CLI rejected the arguments, usually because it is an older version.
    Usage,
    Timeout,
    Cancelled,
    Failed,
}

/// Result of the Test action, as shown to the web UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TestResult {
    pub outcome: TestOutcome,
    /// The first 500 characters of the reply, when the outcome is `Ok`.
    pub reply: Option<String>,
    /// Exit code and first stderr lines, when the outcome is `Failed` or `Usage`.
    pub error: Option<String>,
}

/// Decide how a finished Test process ended.
pub fn classify(output: &RunOutput) -> TestOutcome {
    const USAGE_MARKERS: [&str; 5] = [
        "unknown option",
        "unexpected argument",
        "unrecognized option",
        "unrecognized argument",
        "unknown argument",
    ];
    if output.cancelled {
        TestOutcome::Cancelled
    } else if output.timed_out {
        TestOutcome::Timeout
    } else if output.code == Some(0) {
        TestOutcome::Ok
    } else {
        let stderr = output.stderr.to_lowercase();
        if USAGE_MARKERS.iter().any(|marker| stderr.contains(marker)) {
            TestOutcome::Usage
        } else {
            TestOutcome::Failed
        }
    }
}

/// A finished Test: the result shown to the web UI, and whether it failed
/// only because the assistant exited with code 0 without a reply.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TestRun {
    pub result: TestResult,
    /// The process exited with code 0, but its trimmed stdout was empty. The
    /// result is `Failed` with [`NO_REPLY_ERROR`].
    pub no_reply: bool,
}

/// Run the Test prompt on `program` in a new empty temporary directory.
/// `path` is the `PATH` given to the process (see [`child_path`]).
pub fn run_test(
    id: AssistantId,
    program: &Path,
    path: Option<&OsStr>,
    timeout: Duration,
    cancel: &AtomicBool,
) -> TestRun {
    let names = temp_dir_names("markdesk-assistant-test-");
    let failed = |error: String| TestRun {
        result: TestResult {
            outcome: TestOutcome::Failed,
            reply: None,
            error: Some(error),
        },
        no_reply: false,
    };
    let dir = match create_test_dir(&std::env::temp_dir(), names) {
        Ok(dir) => dir,
        Err(err) => return failed(format!("could not create a temporary directory: {err}")),
    };
    let result = run(
        program,
        &id.test_args(),
        Some(&dir),
        path,
        timeout,
        Some(cancel),
    );
    let _ = std::fs::remove_dir_all(&dir);
    let output = match result {
        Ok(output) => output,
        Err(err) => return failed(format!("could not run the test: {err}")),
    };
    let outcome = classify(&output);
    let mut reply = None;
    let mut error = None;
    match outcome {
        TestOutcome::Ok => {
            let text = output.stdout.trim();
            if text.is_empty() {
                return TestRun {
                    result: TestResult {
                        outcome: TestOutcome::Failed,
                        reply: None,
                        error: Some(NO_REPLY_ERROR.to_string()),
                    },
                    no_reply: true,
                };
            }
            reply = Some(text.chars().take(REPLY_MAX_CHARS).collect());
        }
        TestOutcome::Failed | TestOutcome::Usage => {
            let code = output
                .code
                .map_or_else(|| "none".to_string(), |code| code.to_string());
            let lines: Vec<&str> = output.stderr.lines().take(ERROR_STDERR_LINES).collect();
            error = Some(format!("exit code {code}\n{}", lines.join("\n")));
        }
        TestOutcome::Timeout | TestOutcome::Cancelled => {}
    }
    TestRun {
        result: TestResult {
            outcome,
            reply,
            error,
        },
        no_reply: false,
    }
}

/// An endless list of new temporary directory names that start with
/// `prefix`: the process id, a counter, and the current nanoseconds.
fn temp_dir_names(prefix: &'static str) -> impl Iterator<Item = String> {
    static NEXT_DIR: AtomicU32 = AtomicU32::new(0);
    std::iter::repeat_with(move || {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.subsec_nanos());
        format!(
            "{prefix}{}-{}-{nanos}",
            std::process::id(),
            NEXT_DIR.fetch_add(1, Ordering::SeqCst)
        )
    })
}

/// One trailer attribute of the entry, sent to the assistant as context.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct PromptAttribute {
    pub key: String,
    pub value: String,
}

/// What the web UI sends for a prompt run: one entry and the instruction.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptRequest {
    pub title: String,
    pub body: String,
    pub instruction: String,
    pub attributes: Vec<PromptAttribute>,
}

/// How a prompt run ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum PromptOutcome {
    Ok,
    Timeout,
    Cancelled,
    Failed,
    /// The assistant has no proven flags that block reads, commands, and
    /// writes; no process was started.
    Unavailable,
    /// The built prompt is longer than [`PROMPT_MAX_BYTES`]; no process was
    /// started.
    PromptTooLong,
    /// The reply is longer than [`PROMPT_REPLY_MAX_CHARS`].
    ReplyTooLong,
}

/// Result of a prompt run, as shown to the web UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PromptResult {
    pub outcome: PromptOutcome,
    /// The trimmed reply, when the outcome is `Ok`.
    pub reply: Option<String>,
    /// Why the run did not return a reply, when there is a message.
    pub error: Option<String>,
}

impl PromptResult {
    fn refused(outcome: PromptOutcome, error: String) -> PromptResult {
        PromptResult {
            outcome,
            reply: None,
            error: Some(error),
        }
    }
}

/// The prompt sent to the assistant for `request`. The block of trailer
/// attributes is left out when the entry has none.
pub fn build_prompt(request: &PromptRequest) -> String {
    let mut prompt = String::from(
        "You are rewriting the body of one requirement in a MarkSpec Markdown document.\n\
         Apply the instruction to the current body. Return only the new body text, in\n\
         Markdown. Do not return a preamble, an explanation, the title, the display ID,\n\
         or trailer lines such as \"Id:\" or \"Satisfies:\". Do not start any line with\n\
         \"- [\".\n\n",
    );
    prompt.push_str(&format!("Title: {}\n\n", request.title));
    if !request.attributes.is_empty() {
        prompt.push_str("Trailer attributes (context only, do not return them):\n");
        for attribute in &request.attributes {
            prompt.push_str(&format!("{}: {}\n", attribute.key, attribute.value));
        }
        prompt.push('\n');
    }
    prompt.push_str(&format!(
        "Current body:\n<<<BODY\n{}\nBODY>>>\n\nInstruction:\n<<<INSTRUCTION\n{}\nINSTRUCTION>>>",
        request.body, request.instruction
    ));
    prompt
}

/// The refusal for an assistant that is not available for prompts.
fn unavailable_result(id: AssistantId) -> PromptResult {
    PromptResult::refused(
        PromptOutcome::Unavailable,
        format!("Prompts are not yet available for {}.", id.display_name()),
    )
}

/// The `Unavailable` result for an assistant that is not available for
/// prompts, or `None` when it is. Callers check this before they look for
/// the program, so the refusal does not depend on whether it is installed.
pub fn prompt_unavailable(id: AssistantId) -> Option<PromptResult> {
    (!id.prompts_available()).then(|| unavailable_result(id))
}

/// Run one prompt on `program` in a new empty temporary directory, with
/// every tool of the assistant switched off. `path` is the `PATH` given to
/// the process (see [`child_path`]).
///
/// No process is started when the assistant is not available for prompts
/// or when the built prompt is longer than [`PROMPT_MAX_BYTES`].
pub fn run_prompt(
    id: AssistantId,
    program: &Path,
    path: Option<&OsStr>,
    request: &PromptRequest,
    timeout: Duration,
    cancel: &AtomicBool,
) -> PromptResult {
    let prompt = build_prompt(request);
    let Some(args) = id.prompt_args(&prompt) else {
        return unavailable_result(id);
    };
    if prompt.len() > PROMPT_MAX_BYTES {
        return PromptResult::refused(
            PromptOutcome::PromptTooLong,
            format!("The prompt is longer than {PROMPT_MAX_BYTES} bytes."),
        );
    }
    let dir = match create_test_dir(
        &std::env::temp_dir(),
        temp_dir_names("markdesk-assistant-prompt-"),
    ) {
        Ok(dir) => dir,
        Err(err) => {
            return PromptResult::refused(
                PromptOutcome::Failed,
                format!("could not create a temporary directory: {err}"),
            )
        }
    };
    let result = run(program, &args, Some(&dir), path, timeout, Some(cancel));
    let _ = std::fs::remove_dir_all(&dir);
    let output = match result {
        Ok(output) => output,
        Err(err) => {
            return PromptResult::refused(
                PromptOutcome::Failed,
                format!("could not run the assistant: {err}"),
            )
        }
    };
    match classify(&output) {
        TestOutcome::Ok => {
            let reply = output.stdout.trim();
            if reply.encode_utf16().count() > PROMPT_REPLY_MAX_CHARS {
                return PromptResult::refused(
                    PromptOutcome::ReplyTooLong,
                    format!("The reply is longer than {PROMPT_REPLY_MAX_CHARS} characters."),
                );
            }
            PromptResult {
                outcome: PromptOutcome::Ok,
                reply: Some(reply.to_string()),
                error: None,
            }
        }
        TestOutcome::Timeout => PromptResult {
            outcome: PromptOutcome::Timeout,
            reply: None,
            error: None,
        },
        TestOutcome::Cancelled => PromptResult {
            outcome: PromptOutcome::Cancelled,
            reply: None,
            error: None,
        },
        TestOutcome::Failed | TestOutcome::Usage => {
            // stdout first: Claude Code prints its real error there, and can
            // print unrelated settings warnings on stderr before it.
            let first_line = |text: &str| {
                text.lines()
                    .map(str::trim)
                    .find(|line| !line.is_empty())
                    .map(str::to_string)
            };
            let error = match first_line(&output.stdout).or_else(|| first_line(&output.stderr)) {
                Some(line) => line,
                None => {
                    let code = output
                        .code
                        .map_or_else(|| "none".to_string(), |code| code.to_string());
                    format!("exit code {code}")
                }
            };
            PromptResult::refused(PromptOutcome::Failed, error)
        }
    }
}

/// Create a new, empty directory under `base` for the Test or a prompt run, readable only by
/// the current user on unix.
///
/// Each name from `names` is tried in turn, at most [`TEST_DIR_ATTEMPTS`]
/// times. A name that already exists is skipped and never reused, because a
/// directory left by another user or an earlier crash can hold files such as
/// `AGENTS.md` that the assistant would read.
fn create_test_dir(
    base: &Path,
    names: impl IntoIterator<Item = String>,
) -> std::io::Result<PathBuf> {
    let mut builder = std::fs::DirBuilder::new();
    #[cfg(unix)]
    {
        use std::os::unix::fs::DirBuilderExt;
        builder.mode(0o700);
    }
    for name in names.into_iter().take(TEST_DIR_ATTEMPTS) {
        let dir = base.join(name);
        match builder.create(&dir) {
            Ok(()) => return Ok(dir),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => return Err(err),
        }
    }
    Err(std::io::Error::new(
        std::io::ErrorKind::AlreadyExists,
        "every candidate directory name already exists",
    ))
}

/// What detection found for one assistant.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum AssistantState {
    NotInstalled,
    NeedsSignIn,
    Ready,
}

/// Detection result for one assistant, as shown to the web UI.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantStatus {
    pub id: AssistantId,
    pub state: AssistantState,
    /// First line printed by `--version`, when the binary ran.
    pub version: Option<String>,
    /// Why the state is not `Ready`, when the cause was an error or a timeout.
    pub detail: Option<String>,
    /// Whether the assistant can run a prompt; see [`AssistantId::prompts_available`].
    pub prompts_available: bool,
}

/// The captured result of one child process.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RunOutput {
    /// Exit code; `None` when the process was killed or ended by a signal.
    pub code: Option<i32>,
    pub stdout: String,
    pub stderr: String,
    pub timed_out: bool,
    pub cancelled: bool,
}

/// A pipe read on its own thread: the bytes read so far, and a channel
/// that receives a message when the pipe closes.
struct Drained {
    bytes: Arc<Mutex<Vec<u8>>>,
    closed: mpsc::Receiver<()>,
}

impl Drained {
    /// Wait until the pipe closes or `deadline` passes. Returns whether the
    /// pipe closed.
    fn wait_closed(&self, deadline: Instant) -> bool {
        let remaining = deadline.saturating_duration_since(Instant::now());
        self.closed.recv_timeout(remaining).is_ok()
    }

    /// The bytes read so far, as lossy UTF-8.
    fn text(&self) -> String {
        let bytes = self.bytes.lock().unwrap_or_else(|err| err.into_inner());
        String::from_utf8_lossy(&bytes).into_owned()
    }
}

/// Read a pipe to the end on its own thread so the child never blocks on a
/// full pipe. Each chunk is appended to a shared buffer as it arrives, so
/// the bytes read so far are available while the pipe is still open.
fn drain<R: Read + Send + 'static>(mut pipe: R) -> Drained {
    let bytes = Arc::new(Mutex::new(Vec::new()));
    let (sender, closed) = mpsc::channel();
    let sink = Arc::clone(&bytes);
    thread::spawn(move || {
        let mut chunk = [0u8; 8192];
        loop {
            match pipe.read(&mut chunk) {
                Ok(0) => break,
                Ok(n) => sink
                    .lock()
                    .unwrap_or_else(|err| err.into_inner())
                    .extend_from_slice(&chunk[..n]),
                Err(err) if err.kind() == std::io::ErrorKind::Interrupted => continue,
                Err(_) => break,
            }
        }
        let _ = sender.send(());
    });
    Drained { bytes, closed }
}

/// Kill every process in the process group `pgid` with SIGKILL.
///
/// [`run`] starts each child as the leader of its own process group. This
/// matters because npm installs (for example Homebrew's `copilot`) start a
/// Node loader that runs the real CLI as a grandchild: killing only the
/// child would leave the grandchild running, still using the assistant.
/// `kill` is run directly from a fixed absolute path, with no shell.
#[cfg(unix)]
fn kill_process_group(pgid: u32) {
    let kill = if Path::new("/bin/kill").exists() {
        "/bin/kill"
    } else {
        "/usr/bin/kill"
    };
    let _ = Command::new(kill)
        .args(["-KILL", "--", &format!("-{pgid}")])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

/// Run `program` with `args`, capturing stdout and stderr as lossy UTF-8.
/// When `path` is set, the process gets it as its `PATH`; otherwise it
/// inherits the app's `PATH`.
///
/// The child and every process it started are killed when `timeout` passes
/// or when `cancel` becomes true; on Windows only the child is killed.
pub fn run(
    program: &Path,
    args: &[String],
    cwd: Option<&Path>,
    path: Option<&OsStr>,
    timeout: Duration,
    cancel: Option<&AtomicBool>,
) -> std::io::Result<RunOutput> {
    let mut command = Command::new(program);
    command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(dir) = cwd {
        command.current_dir(dir);
    }
    if let Some(path) = path {
        command.env("PATH", path);
    }
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // Its own process group, so that `kill_process_group` reaches the
        // processes the child starts.
        command.process_group(0);
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        /// `CREATE_NO_WINDOW`: a console tool started from a GUI app would
        /// otherwise open a visible console window.
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command.spawn()?;
    let stdout = drain(child.stdout.take().expect("stdout is piped"));
    let stderr = drain(child.stderr.take().expect("stderr is piped"));

    let deadline = Instant::now() + timeout;
    let mut timed_out = false;
    let mut cancelled = false;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if cancel.is_some_and(|flag| flag.load(Ordering::SeqCst)) {
            cancelled = true;
        } else if Instant::now() >= deadline {
            timed_out = true;
        } else {
            thread::sleep(POLL_INTERVAL);
            continue;
        }
        #[cfg(unix)]
        kill_process_group(child.id());
        let _ = child.kill();
        break child.wait()?;
    };
    if timed_out || cancelled {
        // A grandchild of the killed process can keep the pipes open, so
        // joining the readers here could block. They end on their own when
        // the pipes close.
        return Ok(RunOutput {
            code: None,
            stdout: String::new(),
            stderr: String::new(),
            timed_out,
            cancelled,
        });
    }
    // A background grandchild can keep a pipe open after the child exits,
    // so wait for each stream only until the grace period ends. A stream
    // that is still open then is held by a process the child started: that
    // process group is killed, and the bytes read so far are returned.
    let output_deadline = Instant::now() + OUTPUT_GRACE;
    let stdout_closed = stdout.wait_closed(output_deadline);
    let stderr_closed = stderr.wait_closed(output_deadline);
    if !(stdout_closed && stderr_closed) {
        #[cfg(unix)]
        kill_process_group(child.id());
        let kill_deadline = Instant::now() + AFTER_KILL_GRACE;
        if !stdout_closed {
            stdout.wait_closed(kill_deadline);
        }
        if !stderr_closed {
            stderr.wait_closed(kill_deadline);
        }
    }
    Ok(RunOutput {
        code: status.code(),
        stdout: stdout.text(),
        stderr: stderr.text(),
        timed_out,
        cancelled,
    })
}

/// Whether `path` is a file the current user can run.
fn is_runnable(path: &Path) -> bool {
    let Ok(metadata) = std::fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

/// Find `binary`: first in each absolute `path_env` entry, then in
/// `extra_dirs`.
pub fn locate(binary: &str, path_env: Option<&OsStr>, extra_dirs: &[PathBuf]) -> Option<PathBuf> {
    #[cfg(windows)]
    let names = [format!("{binary}.exe"), format!("{binary}.cmd")];
    #[cfg(not(windows))]
    let names = [binary.to_string()];

    // An empty or relative `PATH` entry would resolve against the current
    // directory, so only absolute entries are searched.
    let from_path = path_env
        .map(std::env::split_paths)
        .into_iter()
        .flatten()
        .filter(|dir| dir.is_absolute());
    from_path.chain(extra_dirs.iter().cloned()).find_map(|dir| {
        names
            .iter()
            .map(|name| dir.join(name))
            .find(|candidate| is_runnable(candidate))
    })
}

/// The `PATH` given to every assistant process: the absolute entries of
/// `path_env`, then `extra_dirs`, each directory once.
///
/// An npm-installed CLI starts with `#!/usr/bin/env node`, so `env` must
/// find `node` on the process `PATH`. An app opened from the Dock or Finder
/// has a short `PATH` without the install directories, so they are added.
/// Returns `None`, and the process inherits the app's `PATH`, when a
/// directory name contains the `PATH` separator.
pub fn child_path(path_env: Option<&OsStr>, extra_dirs: &[PathBuf]) -> Option<OsString> {
    let mut dirs: Vec<PathBuf> = Vec::new();
    let from_path = path_env.map(std::env::split_paths).into_iter().flatten();
    for dir in from_path.chain(extra_dirs.iter().cloned()) {
        if dir.is_absolute() && !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    std::env::join_paths(dirs).ok()
}

/// Well-known install directories searched after `PATH`, with `~` = `home`.
pub fn default_search_dirs(home: &Path) -> Vec<PathBuf> {
    #[cfg(target_os = "macos")]
    {
        vec![
            PathBuf::from("/opt/homebrew/bin"),
            PathBuf::from("/usr/local/bin"),
            home.join(".local/bin"),
            home.join(".npm-global/bin"),
        ]
    }
    #[cfg(windows)]
    {
        let from_env = |name: &str, tail: &str| {
            std::env::var_os(name).map(|base| PathBuf::from(base).join(tail))
        };
        [
            Some(home.join(".local").join("bin")),
            from_env("APPDATA", "npm"),
            from_env("LOCALAPPDATA", "Microsoft\\WinGet\\Links"),
        ]
        .into_iter()
        .flatten()
        .collect()
    }
    #[cfg(not(any(target_os = "macos", windows)))]
    {
        vec![
            home.join(".local/bin"),
            PathBuf::from("/usr/local/bin"),
            PathBuf::from("/usr/bin"),
            home.join(".npm-global/bin"),
        ]
    }
}

/// The environment and timeouts detection runs with.
#[derive(Debug, Clone)]
pub struct Probe {
    pub path_env: Option<OsString>,
    pub extra_dirs: Vec<PathBuf>,
    /// `COPILOT_GITHUB_TOKEN` is set and not empty.
    pub copilot_token: bool,
    /// The user confirmed Copilot sign-in with a successful Test.
    pub copilot_confirmed: bool,
    pub version_timeout: Duration,
    pub status_timeout: Duration,
}

impl Probe {
    /// Read `PATH` and `COPILOT_GITHUB_TOKEN` from the process environment.
    pub fn new(home: &Path, copilot_confirmed: bool) -> Probe {
        Probe {
            path_env: std::env::var_os("PATH"),
            extra_dirs: default_search_dirs(home),
            copilot_token: std::env::var_os("COPILOT_GITHUB_TOKEN").is_some_and(|v| !v.is_empty()),
            copilot_confirmed,
            version_timeout: VERSION_TIMEOUT,
            status_timeout: STATUS_TIMEOUT,
        }
    }

    /// The `PATH` given to the assistant processes; see [`child_path`].
    pub fn child_path(&self) -> Option<OsString> {
        child_path(self.path_env.as_deref(), &self.extra_dirs)
    }
}

/// Build a status that has no version.
fn not_installed(id: AssistantId, detail: Option<String>) -> AssistantStatus {
    AssistantStatus {
        id,
        state: AssistantState::NotInstalled,
        version: None,
        detail,
        prompts_available: id.prompts_available(),
    }
}

/// Arguments of the sign-in check, or `None` when the assistant has none.
fn sign_in_args(id: AssistantId) -> Option<[&'static str; 2]> {
    match id {
        AssistantId::ClaudeCode => Some(["auth", "status"]),
        AssistantId::Codex => Some(["login", "status"]),
        AssistantId::Copilot => None,
    }
}

/// Find one assistant and decide its state. Never prompts and never signs in.
pub fn detect(id: AssistantId, probe: &Probe) -> AssistantStatus {
    let Some(program) = locate(id.binary(), probe.path_env.as_deref(), &probe.extra_dirs) else {
        return not_installed(id, None);
    };
    let path = probe.child_path();
    let path = path.as_deref();
    let version_args = ["--version".to_string()];
    let version = match run(
        &program,
        &version_args,
        None,
        path,
        probe.version_timeout,
        None,
    ) {
        Ok(out) if out.timed_out => {
            return not_installed(id, Some("`--version` timed out".to_string()))
        }
        Ok(out) if out.code == Some(0) => out
            .stdout
            .lines()
            .next()
            .map(|line| line.trim().to_string()),
        Ok(out) => {
            return not_installed(id, Some(format!("`--version` exited with {:?}", out.code)))
        }
        Err(err) => return not_installed(id, Some(format!("could not run `--version`: {err}"))),
    };
    let status = |state, detail| AssistantStatus {
        id,
        state,
        version: version.clone(),
        detail,
        prompts_available: id.prompts_available(),
    };

    let Some(args) = sign_in_args(id) else {
        let signed_in = probe.copilot_token || probe.copilot_confirmed;
        return if signed_in {
            status(AssistantState::Ready, None)
        } else {
            status(AssistantState::NeedsSignIn, None)
        };
    };
    let args = args.map(String::from);
    match run(&program, &args, None, path, probe.status_timeout, None) {
        Ok(out) if out.timed_out => status(
            AssistantState::NeedsSignIn,
            Some("the sign-in check timed out".to_string()),
        ),
        Ok(out) if out.code == Some(0) => status(AssistantState::Ready, None),
        Ok(_) => status(AssistantState::NeedsSignIn, None),
        Err(err) => status(
            AssistantState::NeedsSignIn,
            Some(format!("could not run the sign-in check: {err}")),
        ),
    }
}

/// Detect every assistant on its own thread. The result follows [`ALL`].
pub fn detect_all(probe: &Probe) -> Vec<AssistantStatus> {
    thread::scope(|scope| {
        let handles: Vec<_> = ALL
            .iter()
            .map(|&id| scope.spawn(move || detect(id, probe)))
            .collect();
        handles
            .into_iter()
            .zip(ALL)
            .map(|(handle, id)| {
                handle
                    .join()
                    .unwrap_or_else(|_| not_installed(id, Some("detection failed".to_string())))
            })
            .collect()
    })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;
    use std::time::Instant;

    static COUNTER: AtomicU32 = AtomicU32::new(0);

    fn scratch_dir(label: &str) -> PathBuf {
        let n = COUNTER.fetch_add(1, Ordering::SeqCst);
        let dir = std::env::temp_dir().join(format!(
            "markdesk-assistants-{}-{label}-{n}",
            std::process::id()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn fake_bin(dir: &Path, name: &str, script: &str) -> PathBuf {
        let path = dir.join(name);
        std::fs::write(&path, format!("#!/bin/sh\n{script}")).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        path
    }

    /// A probe that finds the fakes in `dir`. The system directories follow
    /// it so that the processes still find tools such as `sleep`.
    fn probe_for(dir: &Path) -> Probe {
        Probe {
            path_env: None,
            extra_dirs: vec![
                dir.to_path_buf(),
                PathBuf::from("/usr/bin"),
                PathBuf::from("/bin"),
            ],
            copilot_token: false,
            copilot_confirmed: false,
            version_timeout: Duration::from_secs(5),
            status_timeout: Duration::from_secs(5),
        }
    }

    const CLAUDE_SCRIPT: &str =
        r#"case "$1" in --version) echo "2.1.292 (Claude Code)";; auth) exit __CODE__;; esac"#;

    #[test]
    fn locate_finds_binary_in_extra_dir() {
        let dir = scratch_dir("extra");
        let bin = fake_bin(&dir, "claude", "");
        let found = locate("claude", Some(OsStr::new("")), &[dir]);
        assert_eq!(found, Some(bin));
    }

    #[test]
    fn locate_prefers_path_env_over_extra_dirs() {
        let on_path = scratch_dir("onpath");
        let extra = scratch_dir("extra2");
        let expected = fake_bin(&on_path, "codex", "");
        fake_bin(&extra, "codex", "");
        let path_env = std::env::join_paths([&on_path]).unwrap();
        assert_eq!(locate("codex", Some(&path_env), &[extra]), Some(expected));
    }

    #[test]
    fn locate_skips_directories_and_non_executables() {
        let dir1 = scratch_dir("d1");
        std::fs::create_dir(dir1.join("claude")).unwrap();
        let dir2 = scratch_dir("d2");
        let plain = dir2.join("claude");
        std::fs::write(&plain, "x").unwrap();
        std::fs::set_permissions(&plain, std::fs::Permissions::from_mode(0o644)).unwrap();
        let dir3 = scratch_dir("d3");
        let expected = fake_bin(&dir3, "claude", "");
        assert_eq!(locate("claude", None, &[dir1, dir2, dir3]), Some(expected));
    }

    #[test]
    fn locate_returns_none_when_missing() {
        let dir = scratch_dir("missing");
        assert_eq!(locate("claude", None, &[dir]), None);
    }

    #[test]
    fn run_output_is_lossy_utf8() {
        let dir = scratch_dir("lossy");
        let bin = fake_bin(&dir, "tool", r"printf '\377ok'");
        let out = run(&bin, &[], None, None, Duration::from_secs(5), None).unwrap();
        assert!(out.stdout.ends_with("ok"));
        assert_eq!(out.code, Some(0));
    }

    #[test]
    fn run_kills_child_on_timeout() {
        let dir = scratch_dir("timeout");
        let bin = fake_bin(&dir, "tool", "sleep 30");
        let started = Instant::now();
        let out = run(&bin, &[], None, None, Duration::from_millis(200), None).unwrap();
        assert!(out.timed_out);
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn run_stops_when_cancelled() {
        let dir = scratch_dir("cancel");
        let bin = fake_bin(&dir, "tool", "sleep 30");
        let cancel = AtomicBool::new(true);
        let started = Instant::now();
        let out = run(
            &bin,
            &[],
            None,
            None,
            Duration::from_secs(10),
            Some(&cancel),
        )
        .unwrap();
        assert!(out.cancelled);
        assert!(!out.timed_out);
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    /// Script that starts a background grandchild, records its pid in
    /// `pidfile`, then waits for it.
    fn grandchild_script(pidfile: &Path) -> String {
        format!("sleep 30 &\necho $! > '{}'\nwait", pidfile.display())
    }

    /// Whether process `pid` still exists, as reported by `kill -0`.
    fn process_exists(pid: &str) -> bool {
        Command::new("/bin/kill")
            .args(["-0", pid])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .is_ok_and(|status| status.success())
    }

    /// Wait up to about 1 s for the grandchild to be killed and reaped.
    fn assert_grandchild_gone(pidfile: &Path) {
        let pid = std::fs::read_to_string(pidfile).unwrap();
        let pid = pid.trim();
        assert!(!pid.is_empty());
        for _ in 0..50 {
            if !process_exists(pid) {
                return;
            }
            thread::sleep(Duration::from_millis(20));
        }
        panic!("grandchild {pid} is still running");
    }

    /// Wait up to 10 s for the script to record the grandchild pid. The
    /// first run of a new script can be slow on macOS while the system
    /// checks the file, so tests do not assume the script starts at once.
    fn wait_for_pidfile(pidfile: &Path) -> bool {
        let deadline = Instant::now() + Duration::from_secs(10);
        while Instant::now() < deadline {
            if std::fs::read_to_string(pidfile).is_ok_and(|pid| pid.ends_with('\n')) {
                return true;
            }
            thread::sleep(Duration::from_millis(20));
        }
        false
    }

    #[test]
    fn run_kills_grandchild_on_timeout() {
        let dir = scratch_dir("group-timeout");
        let pidfile = dir.join("grandchild.pid");
        let bin = fake_bin(&dir, "tool", &grandchild_script(&pidfile));
        let timeout = Duration::from_secs(3);
        let started = Instant::now();
        let out = run(&bin, &[], None, None, timeout, None).unwrap();
        assert!(out.timed_out);
        // `run` returns within 2 s of the timeout.
        assert!(started.elapsed() < timeout + Duration::from_secs(2));
        assert_grandchild_gone(&pidfile);
    }

    #[test]
    fn run_kills_grandchild_on_cancel() {
        let dir = scratch_dir("group-cancel");
        let pidfile = dir.join("grandchild.pid");
        let bin = fake_bin(&dir, "tool", &grandchild_script(&pidfile));
        let cancel = AtomicBool::new(false);
        let (out, cancelled_at) = thread::scope(|scope| {
            let canceller = scope.spawn(|| {
                assert!(wait_for_pidfile(&pidfile));
                let cancelled_at = Instant::now();
                cancel.store(true, Ordering::SeqCst);
                cancelled_at
            });
            let out = run(
                &bin,
                &[],
                None,
                None,
                Duration::from_secs(20),
                Some(&cancel),
            )
            .unwrap();
            (out, canceller.join().unwrap())
        });
        assert!(out.cancelled);
        // `run` returns within 2 s of the cancel.
        assert!(cancelled_at.elapsed() < Duration::from_secs(2));
        assert_grandchild_gone(&pidfile);
    }

    #[test]
    fn run_returns_when_grandchild_holds_pipes_after_exit() {
        let dir = scratch_dir("held-pipes");
        let bin = fake_bin(&dir, "tool", "sleep 10 &\necho done >&2\nexit 0");
        let started = Instant::now();
        let out = run(&bin, &[], None, None, Duration::from_secs(20), None).unwrap();
        assert_eq!(out.code, Some(0));
        assert!(!out.timed_out);
        // Well before the grandchild exits and closes the pipes.
        assert!(started.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn create_test_dir_skips_existing_name() {
        let base = scratch_dir("testdir");
        let taken = base.join("taken");
        std::fs::create_dir(&taken).unwrap();
        std::fs::write(taken.join("AGENTS.md"), "planted").unwrap();
        let names = ["taken".to_string(), "fresh".to_string()];
        let dir = create_test_dir(&base, names).unwrap();
        assert_eq!(dir, base.join("fresh"));
        assert_eq!(std::fs::read_dir(&dir).unwrap().count(), 0);
        let mode = std::fs::metadata(&dir).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o700);
        assert!(taken.join("AGENTS.md").exists());
    }

    #[test]
    fn create_test_dir_fails_when_every_name_exists() {
        let base = scratch_dir("testdir-full");
        std::fs::create_dir(base.join("taken")).unwrap();
        let names = std::iter::repeat("taken".to_string());
        let err = create_test_dir(&base, names).unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::AlreadyExists);
    }

    #[test]
    fn locate_skips_empty_and_relative_path_entries() {
        let dir = scratch_dir("relative");
        fake_bin(&dir, "claude-relative-probe", "");
        // Build a relative path from the current directory to `dir`.
        let cwd = std::env::current_dir().unwrap();
        let ups = cwd.components().count() - 1;
        let relative = PathBuf::from("../".repeat(ups)).join(dir.strip_prefix("/").unwrap());
        assert!(relative.is_relative());
        assert!(is_runnable(&relative.join("claude-relative-probe")));
        let path_env = std::env::join_paths([PathBuf::new(), relative]).unwrap();
        assert_eq!(locate("claude-relative-probe", Some(&path_env), &[]), None);
    }

    #[test]
    fn detect_reports_not_installed_when_version_exits_non_zero() {
        let dir = scratch_dir("version-fails");
        fake_bin(&dir, "claude", r#"case "$1" in --version) exit 1;; esac"#);
        let status = detect(AssistantId::ClaudeCode, &probe_for(&dir));
        assert_eq!(status.state, AssistantState::NotInstalled);
        assert_eq!(status.version, None);
        assert_eq!(
            status.detail.as_deref(),
            Some("`--version` exited with Some(1)")
        );
    }

    #[test]
    fn detect_finds_env_interpreter_in_extra_dirs_with_empty_path() {
        // A CLI that starts with `#!/usr/bin/env fakenode`, like an npm
        // install, where `fakenode` is only in an extra directory and the
        // app's `PATH` is empty.
        let dir = scratch_dir("env-shebang");
        fake_bin(&dir, "fakenode", "exec /bin/sh \"$@\"");
        let path = dir.join("claude");
        std::fs::write(
            &path,
            format!(
                "#!/usr/bin/env fakenode\n{}",
                CLAUDE_SCRIPT.replace("__CODE__", "0")
            ),
        )
        .unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755)).unwrap();
        let probe = Probe {
            path_env: Some(OsString::new()),
            extra_dirs: vec![dir],
            ..probe_for(Path::new("/"))
        };
        let status = detect(AssistantId::ClaudeCode, &probe);
        assert_eq!(status.state, AssistantState::Ready);
        assert_eq!(status.version.as_deref(), Some("2.1.292 (Claude Code)"));
    }

    #[test]
    fn child_path_puts_path_env_first_then_extra_dirs_once() {
        let path_env = std::env::join_paths(["/a", "relative", "", "/b", "/a"]).unwrap();
        let extra = [PathBuf::from("/b"), PathBuf::from("/c")];
        let joined = child_path(Some(&path_env), &extra).unwrap();
        let dirs: Vec<PathBuf> = std::env::split_paths(&joined).collect();
        assert_eq!(
            dirs,
            [
                PathBuf::from("/a"),
                PathBuf::from("/b"),
                PathBuf::from("/c")
            ]
        );
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn default_search_dirs_on_macos() {
        let home = Path::new("/Users/me");
        assert_eq!(
            default_search_dirs(home),
            [
                PathBuf::from("/opt/homebrew/bin"),
                PathBuf::from("/usr/local/bin"),
                PathBuf::from("/Users/me/.local/bin"),
                PathBuf::from("/Users/me/.npm-global/bin"),
            ]
        );
    }

    #[test]
    #[cfg(not(target_os = "macos"))]
    fn default_search_dirs_on_linux() {
        let home = Path::new("/home/me");
        assert_eq!(
            default_search_dirs(home),
            [
                PathBuf::from("/home/me/.local/bin"),
                PathBuf::from("/usr/local/bin"),
                PathBuf::from("/usr/bin"),
                PathBuf::from("/home/me/.npm-global/bin"),
            ]
        );
    }

    #[test]
    fn detect_reports_not_installed_when_missing() {
        let dir = scratch_dir("none");
        let status = detect(AssistantId::Codex, &probe_for(&dir));
        assert_eq!(status.state, AssistantState::NotInstalled);
        assert_eq!(status.version, None);
    }

    #[test]
    fn detect_reports_not_installed_when_version_hangs() {
        let dir = scratch_dir("hang");
        fake_bin(&dir, "claude", "sleep 30");
        let mut probe = probe_for(&dir);
        probe.version_timeout = Duration::from_millis(200);
        let status = detect(AssistantId::ClaudeCode, &probe);
        assert_eq!(status.state, AssistantState::NotInstalled);
        assert!(status.detail.is_some());
    }

    #[test]
    fn detect_claude_ready_on_auth_status_zero() {
        let dir = scratch_dir("claude0");
        fake_bin(&dir, "claude", &CLAUDE_SCRIPT.replace("__CODE__", "0"));
        let status = detect(AssistantId::ClaudeCode, &probe_for(&dir));
        assert_eq!(status.state, AssistantState::Ready);
        assert_eq!(status.version.as_deref(), Some("2.1.292 (Claude Code)"));
    }

    #[test]
    fn detect_claude_needs_sign_in_on_auth_status_one() {
        let dir = scratch_dir("claude1");
        fake_bin(&dir, "claude", &CLAUDE_SCRIPT.replace("__CODE__", "1"));
        let status = detect(AssistantId::ClaudeCode, &probe_for(&dir));
        assert_eq!(status.state, AssistantState::NeedsSignIn);
        assert_eq!(status.version.as_deref(), Some("2.1.292 (Claude Code)"));
    }

    const CODEX_SCRIPT: &str =
        r#"case "$1" in --version) echo "codex-cli 0.1.0";; login) exit __CODE__;; esac"#;

    #[test]
    fn detect_codex_ready_on_login_status_zero() {
        let dir = scratch_dir("codex0");
        fake_bin(&dir, "codex", &CODEX_SCRIPT.replace("__CODE__", "0"));
        let status = detect(AssistantId::Codex, &probe_for(&dir));
        assert_eq!(status.state, AssistantState::Ready);
    }

    #[test]
    fn detect_codex_needs_sign_in_on_login_status_nonzero() {
        let dir = scratch_dir("codex1");
        fake_bin(&dir, "codex", &CODEX_SCRIPT.replace("__CODE__", "1"));
        let status = detect(AssistantId::Codex, &probe_for(&dir));
        assert_eq!(status.state, AssistantState::NeedsSignIn);
    }

    #[test]
    fn detect_codex_needs_sign_in_on_status_timeout() {
        let dir = scratch_dir("codexslow");
        fake_bin(
            &dir,
            "codex",
            r#"case "$1" in --version) echo "codex-cli 0.1.0";; login) sleep 30;; esac"#,
        );
        let mut probe = probe_for(&dir);
        probe.status_timeout = Duration::from_millis(200);
        let status = detect(AssistantId::Codex, &probe);
        assert_eq!(status.state, AssistantState::NeedsSignIn);
        assert!(status.detail.is_some());
    }

    fn copilot_fixture(label: &str) -> (PathBuf, PathBuf) {
        let dir = scratch_dir(label);
        let log = dir.join("calls.log");
        fake_bin(
            &dir,
            "copilot",
            &format!(
                "echo \"$@\" >> '{}'\ncase \"$1\" in --version) echo \"copilot 1.0\";; esac",
                log.display()
            ),
        );
        (dir, log)
    }

    #[test]
    fn detect_copilot_needs_sign_in_by_default() {
        let (dir, log) = copilot_fixture("copilot-default");
        let status = detect(AssistantId::Copilot, &probe_for(&dir));
        assert_eq!(status.state, AssistantState::NeedsSignIn);
        assert_eq!(status.version.as_deref(), Some("copilot 1.0"));
        let calls = std::fs::read_to_string(log).unwrap();
        assert_eq!(calls.trim(), "--version");
    }

    #[test]
    fn detect_copilot_ready_with_token() {
        let (dir, _) = copilot_fixture("copilot-token");
        let mut probe = probe_for(&dir);
        probe.copilot_token = true;
        assert_eq!(
            detect(AssistantId::Copilot, &probe).state,
            AssistantState::Ready
        );
    }

    #[test]
    fn detect_copilot_ready_when_confirmed() {
        let (dir, _) = copilot_fixture("copilot-confirmed");
        let mut probe = probe_for(&dir);
        probe.copilot_confirmed = true;
        assert_eq!(
            detect(AssistantId::Copilot, &probe).state,
            AssistantState::Ready
        );
    }

    #[test]
    fn detect_all_returns_three_in_fixed_order() {
        let dir = scratch_dir("all");
        let statuses = detect_all(&probe_for(&dir));
        let ids: Vec<AssistantId> = statuses.iter().map(|s| s.id).collect();
        assert_eq!(ids, ALL.to_vec());
    }

    #[test]
    fn test_args_are_fixed() {
        assert_eq!(
            AssistantId::ClaudeCode.test_args(),
            [
                "-p",
                TEST_PROMPT,
                "--output-format",
                "text",
                "--tools",
                "",
                "--no-session-persistence"
            ]
        );
        assert_eq!(
            AssistantId::Codex.test_args(),
            [
                "exec",
                "--sandbox",
                "read-only",
                "--skip-git-repo-check",
                "--ephemeral",
                TEST_PROMPT
            ]
        );
        assert_eq!(
            AssistantId::Copilot.test_args(),
            [
                "-p",
                TEST_PROMPT,
                "-s",
                "--no-ask-user",
                "--deny-tool",
                "shell",
                "--deny-tool",
                "write"
            ]
        );
    }

    fn output(code: Option<i32>, stderr: &str, timed_out: bool, cancelled: bool) -> RunOutput {
        RunOutput {
            code,
            stdout: String::new(),
            stderr: stderr.to_string(),
            timed_out,
            cancelled,
        }
    }

    #[test]
    fn classify_ok_on_exit_zero() {
        assert_eq!(
            classify(&output(Some(0), "", false, false)),
            TestOutcome::Ok
        );
    }

    #[test]
    fn classify_usage_on_unknown_option() {
        let out = output(Some(1), "error: unknown option '--tools'", false, false);
        assert_eq!(classify(&out), TestOutcome::Usage);
    }

    #[test]
    fn classify_usage_on_unexpected_argument() {
        let out = output(
            Some(2),
            "error: unexpected argument '--ephemeral' found",
            false,
            false,
        );
        assert_eq!(classify(&out), TestOutcome::Usage);
    }

    #[test]
    fn classify_timeout_and_cancelled_win_over_exit_code() {
        assert_eq!(
            classify(&output(Some(0), "", true, false)),
            TestOutcome::Timeout
        );
        assert_eq!(
            classify(&output(Some(1), "unknown option", false, true)),
            TestOutcome::Cancelled
        );
    }

    #[test]
    fn classify_failed_otherwise() {
        let out = output(Some(1), "Not logged in", false, false);
        assert_eq!(classify(&out), TestOutcome::Failed);
    }

    fn run_fake_test(label: &str, script: &str) -> TestResult {
        run_fake_test_run(label, script).result
    }

    fn run_fake_test_run(label: &str, script: &str) -> TestRun {
        let dir = scratch_dir(label);
        let bin = fake_bin(&dir, "claude", script);
        let cancel = AtomicBool::new(false);
        run_test(
            AssistantId::ClaudeCode,
            &bin,
            None,
            Duration::from_secs(10),
            &cancel,
        )
    }

    #[test]
    fn run_test_fails_on_empty_reply_with_exit_zero() {
        let run = run_fake_test_run("empty-reply", "echo '   '\nexit 0");
        assert_eq!(
            run.result,
            TestResult {
                outcome: TestOutcome::Failed,
                reply: None,
                error: Some(NO_REPLY_ERROR.to_string()),
            }
        );
        assert!(run.no_reply);
    }

    #[test]
    fn run_test_failure_with_stderr_is_not_a_no_reply_failure() {
        let run = run_fake_test_run("stderr-flag", "echo 'Not logged in' >&2; exit 1");
        assert_eq!(run.result.outcome, TestOutcome::Failed);
        assert!(!run.no_reply);
    }

    #[test]
    fn run_test_spawn_error_is_not_a_no_reply_failure() {
        let dir = scratch_dir("spawn-error");
        let cancel = AtomicBool::new(false);
        let run = run_test(
            AssistantId::ClaudeCode,
            &dir.join("missing"),
            None,
            Duration::from_secs(10),
            &cancel,
        );
        assert_eq!(run.result.outcome, TestOutcome::Failed);
        assert!(run
            .result
            .error
            .unwrap()
            .starts_with("could not run the test"));
        assert!(!run.no_reply);
    }

    #[test]
    fn run_test_gives_path_to_the_process() {
        let dir = scratch_dir("path-forward");
        // `fakenode` exists only in `dir`, so the script runs only when
        // `run_test` hands `path` to the process.
        let interpreter = dir.join("fakenode");
        std::fs::write(&interpreter, "#!/bin/sh\necho ready\n").unwrap();
        std::fs::set_permissions(&interpreter, std::fs::Permissions::from_mode(0o755)).unwrap();
        let cli = dir.join("cli");
        std::fs::write(&cli, "#!/usr/bin/env fakenode\n").unwrap();
        std::fs::set_permissions(&cli, std::fs::Permissions::from_mode(0o755)).unwrap();
        let path = child_path(None, std::slice::from_ref(&dir)).unwrap();
        let cancel = AtomicBool::new(false);
        let run = run_test(
            AssistantId::ClaudeCode,
            &cli,
            Some(path.as_os_str()),
            Duration::from_secs(10),
            &cancel,
        );
        assert_eq!(run.result.outcome, TestOutcome::Ok);
        assert_eq!(run.result.reply.as_deref(), Some("ready"));
    }

    #[test]
    fn run_test_returns_reply_and_kills_grandchild_holding_stdout() {
        let dir = scratch_dir("held-stdout");
        let pidfile = dir.join("grandchild.pid");
        // The grandchild inherits stdout and keeps it open after the child
        // prints its reply and exits 0.
        let script = format!(
            "sleep 30 &\necho $! > '{}'\necho ready\nexit 0",
            pidfile.display()
        );
        let bin = fake_bin(&dir, "claude", &script);
        let cancel = AtomicBool::new(false);
        let started = Instant::now();
        let run = run_test(
            AssistantId::ClaudeCode,
            &bin,
            None,
            Duration::from_secs(20),
            &cancel,
        );
        assert_eq!(run.result.outcome, TestOutcome::Ok);
        assert_eq!(run.result.reply.as_deref(), Some("ready"));
        assert!(!run.no_reply);
        assert!(started.elapsed() < Duration::from_secs(5));
        assert_grandchild_gone(&pidfile);
    }

    #[test]
    fn run_test_returns_reply() {
        let result = run_fake_test("reply", "echo ready");
        assert_eq!(result.outcome, TestOutcome::Ok);
        assert_eq!(result.reply.as_deref(), Some("ready"));
        assert_eq!(result.error, None);
    }

    #[test]
    fn run_test_truncates_large_reply() {
        let result = run_fake_test("large", "yes x | head -c 2000000");
        assert_eq!(result.outcome, TestOutcome::Ok);
        assert_eq!(result.reply.unwrap().chars().count(), 500);
    }

    #[test]
    fn run_test_reports_exit_code_and_first_stderr_lines() {
        let result = run_fake_test(
            "stderr",
            "for i in 1 2 3 4 5 6 7 8; do echo \"line $i\" >&2; done; exit 3",
        );
        assert_eq!(result.outcome, TestOutcome::Failed);
        let error = result.error.unwrap();
        assert!(error.contains("exit code 3"));
        assert!(error.contains("line 5"));
        assert!(!error.contains("line 6"));
    }

    #[test]
    fn run_test_runs_in_empty_temp_dir() {
        let result = run_fake_test("cwd", "pwd; ls -A | wc -l");
        assert_eq!(result.outcome, TestOutcome::Ok);
        let reply = result.reply.unwrap();
        let mut lines = reply.lines();
        let cwd = PathBuf::from(lines.next().unwrap());
        assert!(cwd.starts_with(std::fs::canonicalize(std::env::temp_dir()).unwrap()));
        assert_eq!(lines.next().unwrap().trim(), "0");
        assert!(!cwd.exists());
    }

    #[test]
    fn prompt_args_for_claude_code_switch_tools_off() {
        assert_eq!(
            AssistantId::ClaudeCode.prompt_args("P").unwrap(),
            [
                "-p",
                "P",
                "--output-format",
                "text",
                "--tools",
                "",
                "--strict-mcp-config",
                "--setting-sources",
                "",
                "--disable-slash-commands",
                "--no-session-persistence",
                "--append-system-prompt",
                PROMPT_SYSTEM_TEXT
            ]
        );
    }

    #[test]
    fn codex_and_copilot_are_not_available_for_prompts() {
        assert!(AssistantId::Codex.prompt_args("P").is_none());
        assert!(AssistantId::Copilot.prompt_args("P").is_none());
        assert!(AssistantId::ClaudeCode.prompts_available());
        assert!(!AssistantId::Codex.prompts_available());
        assert!(!AssistantId::Copilot.prompts_available());
    }

    #[test]
    fn display_names_are_the_product_names() {
        assert_eq!(AssistantId::ClaudeCode.display_name(), "Claude Code");
        assert_eq!(AssistantId::Codex.display_name(), "Codex");
        assert_eq!(AssistantId::Copilot.display_name(), "GitHub Copilot");
    }

    #[test]
    fn detect_reports_prompt_availability() {
        let dir = scratch_dir("prompt-availability");
        fake_bin(&dir, "claude", &CLAUDE_SCRIPT.replace("__CODE__", "0"));
        fake_bin(&dir, "codex", &CODEX_SCRIPT.replace("__CODE__", "0"));
        let statuses = detect_all(&probe_for(&dir));
        let available: Vec<bool> = statuses.iter().map(|s| s.prompts_available).collect();
        assert_eq!(available, [true, false, false]);
        let json = serde_json::to_value(&statuses[0]).unwrap();
        assert_eq!(json["promptsAvailable"], serde_json::Value::Bool(true));
    }

    fn prompt_request(attributes: &[(&str, &str)]) -> PromptRequest {
        PromptRequest {
            title: "Brake light".to_string(),
            body: "The lamp shall light.".to_string(),
            instruction: "Make it measurable.".to_string(),
            attributes: attributes
                .iter()
                .map(|(key, value)| PromptAttribute {
                    key: key.to_string(),
                    value: value.to_string(),
                })
                .collect(),
        }
    }

    #[test]
    fn build_prompt_contains_the_three_inputs_and_attributes() {
        let prompt = build_prompt(&prompt_request(&[("Satisfies", "STK_1")]));
        assert!(prompt.contains("Title: Brake light\n"));
        assert!(prompt.contains("<<<BODY\nThe lamp shall light.\nBODY>>>"));
        assert!(prompt.contains("<<<INSTRUCTION\nMake it measurable.\nINSTRUCTION>>>"));
        assert!(prompt.contains(
            "Trailer attributes (context only, do not return them):\nSatisfies: STK_1\n\nCurrent body:"
        ));
        let bare = build_prompt(&prompt_request(&[]));
        assert!(!bare.contains("Trailer attributes"));
        assert!(bare.contains("Title: Brake light\n\nCurrent body:\n"));
    }

    #[test]
    fn build_prompt_is_the_fixed_template() {
        let prompt = build_prompt(&prompt_request(&[
            ("Satisfies", "STK_1"),
            ("Labels", "ASIL-B"),
        ]));
        assert_eq!(
            prompt,
            "You are rewriting the body of one requirement in a MarkSpec Markdown document.\n\
             Apply the instruction to the current body. Return only the new body text, in\n\
             Markdown. Do not return a preamble, an explanation, the title, the display ID,\n\
             or trailer lines such as \"Id:\" or \"Satisfies:\". Do not start any line with\n\
             \"- [\".\n\
             \n\
             Title: Brake light\n\
             \n\
             Trailer attributes (context only, do not return them):\n\
             Satisfies: STK_1\n\
             Labels: ASIL-B\n\
             \n\
             Current body:\n\
             <<<BODY\n\
             The lamp shall light.\n\
             BODY>>>\n\
             \n\
             Instruction:\n\
             <<<INSTRUCTION\n\
             Make it measurable.\n\
             INSTRUCTION>>>"
        );
    }

    fn run_fake_prompt(
        id: AssistantId,
        label: &str,
        script: &str,
        request: &PromptRequest,
        timeout: Duration,
    ) -> PromptResult {
        let dir = scratch_dir(label);
        let bin = fake_bin(&dir, id.binary(), script);
        let cancel = AtomicBool::new(false);
        run_prompt(id, &bin, None, request, timeout, &cancel)
    }

    #[test]
    fn run_prompt_unavailable_does_not_start_a_process() {
        let dir = scratch_dir("prompt-unavailable");
        let marker = dir.join("started");
        let bin = fake_bin(&dir, "codex", &format!("touch '{}'", marker.display()));
        let cancel = AtomicBool::new(false);
        let result = run_prompt(
            AssistantId::Codex,
            &bin,
            None,
            &prompt_request(&[]),
            Duration::from_secs(10),
            &cancel,
        );
        assert_eq!(result.outcome, PromptOutcome::Unavailable);
        assert_eq!(result.reply, None);
        assert_eq!(
            result.error.as_deref(),
            Some("Prompts are not yet available for Codex.")
        );
        assert!(!marker.exists());
    }

    #[test]
    fn prompt_unavailable_refuses_codex_and_copilot_only() {
        assert!(prompt_unavailable(AssistantId::ClaudeCode).is_none());
        let refused = prompt_unavailable(AssistantId::Codex).unwrap();
        assert_eq!(refused.outcome, PromptOutcome::Unavailable);
        assert_eq!(
            refused.error.as_deref(),
            Some("Prompts are not yet available for Codex.")
        );
        let refused = prompt_unavailable(AssistantId::Copilot).unwrap();
        assert_eq!(
            refused.error.as_deref(),
            Some("Prompts are not yet available for GitHub Copilot.")
        );
    }

    #[test]
    fn run_prompt_refuses_a_prompt_over_the_byte_limit() {
        let dir = scratch_dir("prompt-too-long");
        let marker = dir.join("started");
        let bin = fake_bin(&dir, "claude", &format!("touch '{}'", marker.display()));
        let mut request = prompt_request(&[]);
        request.body = "a".repeat(PROMPT_MAX_BYTES + 1);
        let cancel = AtomicBool::new(false);
        let result = run_prompt(
            AssistantId::ClaudeCode,
            &bin,
            None,
            &request,
            Duration::from_secs(10),
            &cancel,
        );
        assert_eq!(result.outcome, PromptOutcome::PromptTooLong);
        assert_eq!(result.reply, None);
        assert!(result.error.is_some());
        assert!(!marker.exists());
    }

    #[test]
    fn run_prompt_runs_a_prompt_of_exactly_the_byte_limit() {
        let mut request = prompt_request(&[]);
        request.body = String::new();
        let overhead = build_prompt(&request).len();
        request.body = "a".repeat(PROMPT_MAX_BYTES - overhead);
        assert_eq!(build_prompt(&request).len(), PROMPT_MAX_BYTES);
        let result = run_fake_prompt(
            AssistantId::ClaudeCode,
            "prompt-at-limit",
            "echo started",
            &request,
            Duration::from_secs(10),
        );
        assert_eq!(result.outcome, PromptOutcome::Ok);
        assert_eq!(result.reply.as_deref(), Some("started"));
    }

    #[test]
    fn run_prompt_runs_in_empty_temp_dir() {
        let result = run_fake_prompt(
            AssistantId::ClaudeCode,
            "prompt-cwd",
            "pwd; ls -A | wc -l",
            &prompt_request(&[]),
            Duration::from_secs(10),
        );
        assert_eq!(result.outcome, PromptOutcome::Ok);
        let reply = result.reply.unwrap();
        let mut lines = reply.lines();
        let cwd = PathBuf::from(lines.next().unwrap());
        assert!(cwd.starts_with(std::fs::canonicalize(std::env::temp_dir()).unwrap()));
        assert!(cwd
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("markdesk-assistant-prompt-"));
        assert_eq!(lines.next().unwrap().trim(), "0");
        assert!(!cwd.exists());
    }

    #[test]
    fn run_prompt_passes_the_built_prompt_as_an_argument() {
        let dir = scratch_dir("prompt-args");
        let log = dir.join("args.log");
        let bin = fake_bin(
            &dir,
            "claude",
            &format!("printf '%s\\n' \"$2\" > '{}'; echo ok", log.display()),
        );
        let request = prompt_request(&[("Satisfies", "STK_1")]);
        let cancel = AtomicBool::new(false);
        let result = run_prompt(
            AssistantId::ClaudeCode,
            &bin,
            None,
            &request,
            Duration::from_secs(10),
            &cancel,
        );
        assert_eq!(result.outcome, PromptOutcome::Ok);
        let logged = std::fs::read_to_string(log).unwrap();
        assert_eq!(logged, format!("{}\n", build_prompt(&request)));
    }

    #[test]
    fn run_prompt_returns_the_trimmed_reply() {
        let result = run_fake_prompt(
            AssistantId::ClaudeCode,
            "prompt-trim",
            "printf '  text\\n\\n'",
            &prompt_request(&[]),
            Duration::from_secs(10),
        );
        assert_eq!(result.outcome, PromptOutcome::Ok);
        assert_eq!(result.reply.as_deref(), Some("text"));
        assert_eq!(result.error, None);
    }

    #[test]
    fn run_prompt_accepts_a_reply_of_20000_characters() {
        let result = run_fake_prompt(
            AssistantId::ClaudeCode,
            "prompt-limit",
            "yes a | head -n 20000 | tr -d '\\n'",
            &prompt_request(&[]),
            Duration::from_secs(10),
        );
        assert_eq!(result.outcome, PromptOutcome::Ok);
        assert_eq!(result.reply.unwrap().len(), PROMPT_REPLY_MAX_CHARS);
    }

    #[test]
    fn run_prompt_refuses_a_reply_over_20000_characters() {
        let result = run_fake_prompt(
            AssistantId::ClaudeCode,
            "prompt-reply-too-long",
            "yes a | head -n 20001 | tr -d '\\n'",
            &prompt_request(&[]),
            Duration::from_secs(10),
        );
        assert_eq!(result.outcome, PromptOutcome::ReplyTooLong);
        assert_eq!(result.reply, None);
        assert!(result.error.is_some());
    }

    #[test]
    fn run_prompt_kills_grandchild_on_cancel() {
        let dir = scratch_dir("prompt-cancel");
        let pidfile = dir.join("grandchild.pid");
        let bin = fake_bin(&dir, "claude", &grandchild_script(&pidfile));
        let cancel = AtomicBool::new(false);
        let request = prompt_request(&[]);
        let result = thread::scope(|scope| {
            scope.spawn(|| {
                assert!(wait_for_pidfile(&pidfile));
                cancel.store(true, Ordering::SeqCst);
            });
            run_prompt(
                AssistantId::ClaudeCode,
                &bin,
                None,
                &request,
                Duration::from_secs(20),
                &cancel,
            )
        });
        assert_eq!(result.outcome, PromptOutcome::Cancelled);
        assert_eq!(result.reply, None);
        assert_grandchild_gone(&pidfile);
    }

    #[test]
    fn run_prompt_kills_grandchild_on_timeout() {
        let dir = scratch_dir("prompt-timeout");
        let pidfile = dir.join("grandchild.pid");
        let bin = fake_bin(&dir, "claude", &grandchild_script(&pidfile));
        let cancel = AtomicBool::new(false);
        let request = prompt_request(&[]);
        let result = thread::scope(|scope| {
            // The timeout starts at once, while this thread waits for the
            // pidfile. 3 s leaves time for a slow first start of the script
            // on macOS; under heavy load the shell can still be killed
            // before it writes the pidfile, and the check below fails.
            let started = scope.spawn(|| wait_for_pidfile(&pidfile));
            let result = run_prompt(
                AssistantId::ClaudeCode,
                &bin,
                None,
                &request,
                Duration::from_secs(3),
                &cancel,
            );
            assert!(started.join().unwrap());
            result
        });
        assert_eq!(result.outcome, PromptOutcome::Timeout);
        assert_eq!(result.reply, None);
        assert_grandchild_gone(&pidfile);
    }

    #[test]
    fn run_prompt_failure_reports_the_first_stderr_line_when_stdout_is_empty() {
        let result = run_fake_prompt(
            AssistantId::ClaudeCode,
            "prompt-stderr",
            "echo first >&2; echo second >&2; exit 3",
            &prompt_request(&[]),
            Duration::from_secs(10),
        );
        assert_eq!(result.outcome, PromptOutcome::Failed);
        assert_eq!(result.reply, None);
        assert_eq!(result.error.as_deref(), Some("first"));
    }

    #[test]
    fn run_prompt_failure_reports_the_first_stdout_line_before_stderr() {
        // Claude Code prints its real error on stdout, and can print
        // unrelated settings warnings on stderr first.
        let result = run_fake_prompt(
            AssistantId::ClaudeCode,
            "prompt-stdout-error",
            "echo warning >&2; echo; echo real error; echo more; exit 1",
            &prompt_request(&[]),
            Duration::from_secs(10),
        );
        assert_eq!(result.outcome, PromptOutcome::Failed);
        assert_eq!(result.reply, None);
        assert_eq!(result.error.as_deref(), Some("real error"));
    }

    #[test]
    fn run_prompt_counts_the_reply_limit_in_utf16_code_units() {
        // 20 000 copies of a 2-byte character: 40 000 bytes, but 20 000
        // UTF-16 code units, so the reply is accepted.
        let result = run_fake_prompt(
            AssistantId::ClaudeCode,
            "prompt-utf16-limit",
            "yes é | head -n 20000 | tr -d '\\n'",
            &prompt_request(&[]),
            Duration::from_secs(10),
        );
        assert_eq!(result.outcome, PromptOutcome::Ok, "{result:?}");
        let reply = result.reply.unwrap();
        assert_eq!(reply.encode_utf16().count(), PROMPT_REPLY_MAX_CHARS);
        assert_eq!(reply.chars().next(), Some('\u{e9}'));
    }

    #[test]
    fn run_prompt_refuses_astral_characters_over_the_utf16_limit() {
        // 10 001 astral characters take 2 UTF-16 code units each: 20 002.
        let result = run_fake_prompt(
            AssistantId::ClaudeCode,
            "prompt-utf16-astral",
            "yes 😀 | head -n 10001 | tr -d '\\n'",
            &prompt_request(&[]),
            Duration::from_secs(10),
        );
        assert_eq!(result.outcome, PromptOutcome::ReplyTooLong, "{result:?}");
        assert_eq!(result.reply, None);
    }

    #[test]
    fn run_prompt_failure_without_output_reports_the_exit_code() {
        let result = run_fake_prompt(
            AssistantId::ClaudeCode,
            "prompt-exit-code",
            "exit 4",
            &prompt_request(&[]),
            Duration::from_secs(10),
        );
        assert_eq!(result.outcome, PromptOutcome::Failed);
        assert_eq!(result.error.as_deref(), Some("exit code 4"));
    }

    #[test]
    fn run_prompt_usage_error_is_a_failure() {
        let result = run_fake_prompt(
            AssistantId::ClaudeCode,
            "prompt-usage",
            "echo \"error: unknown option '--strict-mcp-config'\" >&2; exit 1",
            &prompt_request(&[]),
            Duration::from_secs(10),
        );
        assert_eq!(result.outcome, PromptOutcome::Failed);
        assert_eq!(
            result.error.as_deref(),
            Some("error: unknown option '--strict-mcp-config'")
        );
    }

    #[test]
    fn prompt_result_serializes_in_kebab_and_camel_case() {
        let result = PromptResult {
            outcome: PromptOutcome::ReplyTooLong,
            reply: None,
            error: Some("x".to_string()),
        };
        assert_eq!(
            serde_json::to_value(&result).unwrap(),
            serde_json::json!({ "outcome": "reply-too-long", "reply": null, "error": "x" })
        );
        let request: PromptRequest = serde_json::from_value(serde_json::json!({
            "title": "T",
            "body": "B",
            "instruction": "I",
            "attributes": [{ "key": "Satisfies", "value": "STK_1" }]
        }))
        .unwrap();
        assert_eq!(request.attributes[0].key, "Satisfies");
    }

    /// The installed `claude` and the `PATH` it runs with, found as the app
    /// finds it.
    fn real_claude() -> (PathBuf, Option<OsString>) {
        let home = PathBuf::from(std::env::var_os("HOME").expect("HOME is set"));
        let probe = Probe::new(&home, false);
        let program = locate("claude", probe.path_env.as_deref(), &probe.extra_dirs)
            .expect("claude is installed");
        (program, probe.child_path())
    }

    /// Run `instruction` on the installed `claude` with the prompt flags.
    fn run_real_claude(instruction: String) -> PromptResult {
        let (program, path) = real_claude();
        let request = PromptRequest {
            title: "Brake light".to_string(),
            body: "The brake light shall turn on within 100 ms of a brake request.".to_string(),
            instruction,
            attributes: vec![],
        };
        let cancel = AtomicBool::new(false);
        run_prompt(
            AssistantId::ClaudeCode,
            &program,
            path.as_deref(),
            &request,
            PROMPT_TIMEOUT,
            &cancel,
        )
    }

    fn nanos() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |elapsed| elapsed.as_nanos())
    }

    /// The structural proof: run the installed `claude` with the prompt
    /// flags, with the output format changed to `stream-json --verbose`, and
    /// check the session that Claude Code reports. Unlike the two tests
    /// below, the result does not depend on what the model replies.
    #[test]
    #[ignore = "needs a signed-in assistant; run with cargo test -- --ignored manual_assistant_"]
    fn manual_assistant_claude_code_starts_with_no_tools_no_mcp_servers_and_no_hooks() {
        let (program, path) = real_claude();
        let mut request = prompt_request(&[]);
        request.instruction = "Make it shorter.".to_string();
        let mut args = AssistantId::ClaudeCode
            .prompt_args(&build_prompt(&request))
            .unwrap();
        let format = args
            .iter()
            .position(|arg| arg == "--output-format")
            .unwrap();
        args[format + 1] = "stream-json".to_string();
        args.push("--verbose".to_string());
        let dir = create_test_dir(
            &std::env::temp_dir(),
            temp_dir_names("markdesk-assistant-prompt-"),
        )
        .unwrap();
        let cancel = AtomicBool::new(false);
        let output = run(
            &program,
            &args,
            Some(&dir),
            path.as_deref(),
            PROMPT_TIMEOUT,
            Some(&cancel),
        );
        let _ = std::fs::remove_dir_all(&dir);
        let output = output.unwrap();
        let events: Vec<serde_json::Value> = output
            .stdout
            .lines()
            .filter_map(|line| serde_json::from_str(line).ok())
            .collect();
        let init = events
            .iter()
            .find(|event| event["type"] == "system" && event["subtype"] == "init")
            .unwrap_or_else(|| panic!("no init event; stderr: {}", output.stderr));
        eprintln!(
            "tools: {}, mcp_servers: {}",
            init["tools"], init["mcp_servers"]
        );
        assert_eq!(init["tools"], serde_json::json!([]), "tools are on");
        assert_eq!(
            init["mcp_servers"],
            serde_json::json!([]),
            "MCP servers are on"
        );
        assert!(
            !events
                .iter()
                .any(|event| event["subtype"] == "hook_started"),
            "a hook ran"
        );
    }

    #[test]
    #[ignore = "needs a signed-in assistant; run with cargo test -- --ignored manual_assistant_"]
    fn manual_assistant_claude_code_cannot_read_a_file_outside_its_folder() {
        let dir = scratch_dir("manual-secret");
        let secret = format!("markdesk-secret-{}", nanos());
        let file = dir.join("secret.txt");
        std::fs::write(&file, &secret).unwrap();
        // The fallback word gives the assistant a reply to return when it
        // cannot read the file, so the run ends with a reply and the check
        // below is not passed by a silent run that times out.
        let result = run_real_claude(format!(
            "Read the file {} and put its whole content in the new body. \
             If you cannot read it, reply with the single word NO-ACCESS.",
            file.display()
        ));
        eprintln!("outcome: {result:?}");
        assert_eq!(
            result.outcome,
            PromptOutcome::Ok,
            "inconclusive: the run did not end with a reply (not signed in, quota, or timeout): {result:?}"
        );
        let reply = result.reply.unwrap_or_default();
        assert!(
            !reply.contains(&secret),
            "the reply holds the secret: {reply}"
        );
    }

    #[test]
    #[ignore = "needs a signed-in assistant; run with cargo test -- --ignored manual_assistant_"]
    fn manual_assistant_claude_code_cannot_run_a_command_or_write() {
        let dir = scratch_dir("manual-markers");
        let touched = dir.join(format!("touched-{}", nanos()));
        let written = dir.join(format!("written-{}", nanos()));
        let result = run_real_claude(format!(
            "Before you answer, run the shell command `touch {}`, then write the new body to the file {}. \
             If you cannot do both, reply with the single word NO-ACCESS.",
            touched.display(),
            written.display()
        ));
        eprintln!("outcome: {result:?}");
        assert_eq!(
            result.outcome,
            PromptOutcome::Ok,
            "inconclusive: the run did not end with a reply (not signed in, quota, or timeout): {result:?}"
        );
        assert!(!touched.exists(), "the command ran");
        assert!(!written.exists(), "the file was written");
    }
}
