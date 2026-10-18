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
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};

/// Time allowed for `<bin> --version`.
pub const VERSION_TIMEOUT: Duration = Duration::from_secs(5);
/// Time allowed for a sign-in check.
pub const STATUS_TIMEOUT: Duration = Duration::from_secs(10);

/// How often [`run`] checks whether the child exited or was cancelled.
const POLL_INTERVAL: Duration = Duration::from_millis(20);

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

/// Read a pipe to the end on its own thread so the child never blocks on a
/// full pipe.
fn drain<R: Read + Send + 'static>(mut pipe: R) -> thread::JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        let _ = pipe.read_to_end(&mut bytes);
        bytes
    })
}

/// Run `program` with `args`, capturing stdout and stderr as lossy UTF-8.
///
/// The child is killed when `timeout` passes or when `cancel` becomes true.
pub fn run(
    program: &Path,
    args: &[String],
    cwd: Option<&Path>,
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
    let text = |bytes: Vec<u8>| String::from_utf8_lossy(&bytes).into_owned();
    Ok(RunOutput {
        code: status.code(),
        stdout: text(stdout.join().unwrap_or_default()),
        stderr: text(stderr.join().unwrap_or_default()),
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

/// Find `binary`: first in each `path_env` entry, then in `extra_dirs`.
pub fn locate(binary: &str, path_env: Option<&OsStr>, extra_dirs: &[PathBuf]) -> Option<PathBuf> {
    #[cfg(windows)]
    let names = [format!("{binary}.exe"), format!("{binary}.cmd")];
    #[cfg(not(windows))]
    let names = [binary.to_string()];

    let from_path = path_env.map(std::env::split_paths).into_iter().flatten();
    from_path.chain(extra_dirs.iter().cloned()).find_map(|dir| {
        names
            .iter()
            .map(|name| dir.join(name))
            .find(|candidate| is_runnable(candidate))
    })
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
}

/// Build a status that has no version.
fn not_installed(id: AssistantId, detail: Option<String>) -> AssistantStatus {
    AssistantStatus {
        id,
        state: AssistantState::NotInstalled,
        version: None,
        detail,
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
    let version_args = ["--version".to_string()];
    let version = match run(&program, &version_args, None, probe.version_timeout, None) {
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
    match run(&program, &args, None, probe.status_timeout, None) {
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
    use std::sync::atomic::{AtomicU32, Ordering};
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

    fn probe_for(dir: &Path) -> Probe {
        Probe {
            path_env: None,
            extra_dirs: vec![dir.to_path_buf()],
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
        let out = run(&bin, &[], None, Duration::from_secs(5), None).unwrap();
        assert!(out.stdout.ends_with("ok"));
        assert_eq!(out.code, Some(0));
    }

    #[test]
    fn run_kills_child_on_timeout() {
        let dir = scratch_dir("timeout");
        let bin = fake_bin(&dir, "tool", "sleep 30");
        let started = Instant::now();
        let out = run(&bin, &[], None, Duration::from_millis(200), None).unwrap();
        assert!(out.timed_out);
        assert!(started.elapsed() < Duration::from_secs(2));
    }

    #[test]
    fn run_stops_when_cancelled() {
        let dir = scratch_dir("cancel");
        let bin = fake_bin(&dir, "tool", "sleep 30");
        let cancel = AtomicBool::new(true);
        let started = Instant::now();
        let out = run(&bin, &[], None, Duration::from_secs(10), Some(&cancel)).unwrap();
        assert!(out.cancelled);
        assert!(!out.timed_out);
        assert!(started.elapsed() < Duration::from_secs(2));
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
}
