//! Lifecycle of the `markspec desk --serve` sidecar process.

use std::io::{BufRead, BufReader, Read};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use serde::Serialize;

use crate::handshake::{self, Handshake};

/// How long the shell waits for the sidecar handshake before giving up.
pub const HANDSHAKE_TIMEOUT: Duration = Duration::from_secs(30);

/// Why a product could not be opened. Serializes as
/// `{ "kind": "not-a-product" | "spawn-failed", "details": "…" }`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenError {
    /// Failure category the web UI branches on.
    pub kind: OpenErrorKind,
    /// Human-readable detail: the sidecar's stderr, or the spawn error.
    pub details: String,
}

/// Failure category of [`OpenError`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum OpenErrorKind {
    /// The sidecar exited with code 1 before its handshake: the folder is
    /// not inside a MarkSpec product.
    NotAProduct,
    /// The sidecar could not be started, timed out, or printed no valid
    /// handshake.
    SpawnFailed,
}

/// A running sidecar. Its stdin stays an open pipe for as long as this value
/// lives, so a sidecar started with `--exit-on-stdin-eof` also exits when the
/// shell itself dies. Dropping the value kills the process.
pub struct Sidecar {
    // `child.stdin` holds the write end of the stdin pipe; it is never taken,
    // so the pipe stays open until the child is dropped.
    child: Child,
}

impl Sidecar {
    /// Kill the sidecar and wait for it to exit.
    pub fn stop(self) {
        drop(self);
    }
}

impl Drop for Sidecar {
    fn drop(&mut self) {
        kill(&mut self.child);
    }
}

/// Upper bound on the stderr text kept for error details.
const STDERR_CAPTURE_LIMIT: usize = 64 * 1024;

impl OpenError {
    fn spawn_failed(details: impl Into<String>) -> Self {
        OpenError {
            kind: OpenErrorKind::SpawnFailed,
            details: details.into(),
        }
    }
}

/// Arguments after the program (and, in debug builds, after the Deno
/// script path) for serving `root`.
pub fn desk_args(root: &str, allow_origin: Option<&str>) -> Vec<String> {
    let mut args: Vec<String> = [
        "desk",
        "--serve",
        "--port",
        "0",
        "--root",
        root,
        "--exit-on-stdin-eof",
    ]
    .iter()
    .map(|arg| arg.to_string())
    .collect();
    if let Some(origin) = allow_origin {
        args.push("--allow-origin".into());
        args.push(origin.into());
    }
    args
}

/// The command that serves `root`. Debug builds run the repository's
/// `main.ts` with Deno and allow the Vite dev origin; release builds run
/// the bundled `markspec` binary next to the app executable.
#[cfg(debug_assertions)]
pub fn markspec_command(root: &str) -> Result<Command, OpenError> {
    /// Origin of the Vite dev server, allowed to call the desk API.
    const DEV_ORIGIN: &str = "http://localhost:5173";
    let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
    let mut command = Command::new("deno");
    command
        .args([
            "run",
            "--allow-read",
            "--allow-write",
            "--allow-env",
            "--allow-net=127.0.0.1",
        ])
        .arg(repo.join("packages/markspec/main.ts"))
        .args(desk_args(root, Some(DEV_ORIGIN)));
    Ok(command)
}

/// The command that serves `root`. Debug builds run the repository's
/// `main.ts` with Deno and allow the Vite dev origin; release builds run
/// the bundled `markspec` binary next to the app executable.
#[cfg(not(debug_assertions))]
pub fn markspec_command(root: &str) -> Result<Command, OpenError> {
    let exe = std::env::current_exe().map_err(|err| {
        OpenError::spawn_failed(format!("could not locate the MarkDesk executable: {err}"))
    })?;
    let dir = exe.parent().ok_or_else(|| {
        OpenError::spawn_failed("the MarkDesk executable has no parent directory")
    })?;
    let mut command = Command::new(dir.join(format!("markspec{}", std::env::consts::EXE_SUFFIX)));
    command.args(desk_args(root, None));
    Ok(command)
}

/// Spawn `command` with piped stdio and wait up to `timeout` for its
/// handshake line on stdout.
///
/// Exit code 1 before the handshake maps to [`OpenErrorKind::NotAProduct`]
/// with the captured stderr as details; every other failure maps to
/// [`OpenErrorKind::SpawnFailed`]. On failure the child is not left running.
pub fn start(mut command: Command, timeout: Duration) -> Result<(Sidecar, Handshake), OpenError> {
    let deadline = Instant::now() + timeout;
    command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|err| {
        OpenError::spawn_failed(format!("could not start the markspec sidecar: {err}"))
    })?;
    let stdout = child.stdout.take().expect("stdout is piped");
    let stderr = child.stderr.take().expect("stderr is piped");
    let captured = Arc::new(Mutex::new(String::new()));
    let stderr_reader = forward_stderr(stderr, Arc::clone(&captured));

    let (sender, receiver) = mpsc::channel();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        let first = match reader.read_line(&mut line) {
            Ok(0) | Err(_) => None,
            Ok(_) => Some(line),
        };
        let _ = sender.send(first);
        // Keep draining stdout so the sidecar never blocks on a full pipe.
        let _ = std::io::copy(&mut reader, &mut std::io::sink());
    });

    match receiver.recv_timeout(timeout) {
        Ok(Some(line)) => match handshake::parse(&line) {
            Ok(handshake) => Ok((Sidecar { child }, handshake)),
            Err(err) => {
                kill(&mut child);
                Err(OpenError::spawn_failed(err))
            }
        },
        Ok(None) => {
            // stdout closed without a handshake: the sidecar is exiting.
            let status = wait_until(&mut child, deadline);
            let _ = stderr_reader.join();
            let stderr_text = captured
                .lock()
                .map(|s| s.trim().to_string())
                .unwrap_or_default();
            Err(match status {
                Some(status) if status.code() == Some(1) => OpenError {
                    kind: OpenErrorKind::NotAProduct,
                    details: stderr_text,
                },
                Some(status) => OpenError::spawn_failed(format!(
                    "markspec sidecar exited ({status}) before its handshake: {stderr_text}"
                )),
                None => OpenError::spawn_failed(format!(
                    "markspec sidecar closed stdout without a handshake: {stderr_text}"
                )),
            })
        }
        Err(_) => {
            kill(&mut child);
            Err(OpenError::spawn_failed(format!(
                "timed out after {} s waiting for the markspec sidecar handshake",
                timeout.as_secs_f32()
            )))
        }
    }
}

/// Copy the sidecar's stderr to the shell's stderr and keep the first
/// [`STDERR_CAPTURE_LIMIT`] bytes for error details.
fn forward_stderr(
    stderr: impl Read + Send + 'static,
    captured: Arc<Mutex<String>>,
) -> JoinHandle<()> {
    thread::spawn(move || {
        for line in BufReader::new(stderr).lines() {
            let Ok(line) = line else { break };
            eprintln!("[markspec] {line}");
            if let Ok(mut text) = captured.lock() {
                if text.len() < STDERR_CAPTURE_LIMIT {
                    text.push_str(&line);
                    text.push('\n');
                }
            }
        }
    })
}

/// Wait for `child` to exit until `deadline`; kill it when the deadline
/// passes. Returns the exit status when the child exited on its own.
fn wait_until(child: &mut Child, deadline: Instant) -> Option<ExitStatus> {
    loop {
        match child.try_wait() {
            Ok(Some(status)) => return Some(status),
            Ok(None) if Instant::now() < deadline => thread::sleep(Duration::from_millis(20)),
            _ => {
                kill(child);
                return None;
            }
        }
    }
}

/// Kill `child` and reap it. Errors are ignored: the child may already
/// have exited.
fn kill(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    const LINE: &str =
        r#"{"url":"http://127.0.0.1:4000","token":"t0k","apiVersion":3,"root":"/srv/product"}"#;

    fn sh(script: &str) -> Command {
        let mut command = Command::new("sh");
        command.arg("-c").arg(script);
        command
    }

    fn timeout() -> Duration {
        Duration::from_secs(10)
    }

    impl Sidecar {
        fn is_running(&mut self) -> bool {
            self.child.try_wait().expect("try_wait").is_none()
        }
    }

    #[test]
    fn start_returns_the_parsed_handshake() {
        let script = format!("echo '{LINE}'; cat > /dev/null");
        let (sidecar, handshake) = start(sh(&script), timeout()).expect("started");
        assert_eq!(handshake.token, "t0k");
        assert_eq!(handshake.root, "/srv/product");
        sidecar.stop();
    }

    #[test]
    fn started_sidecar_keeps_running_because_stdin_stays_open() {
        // `cat` exits as soon as its stdin reaches EOF, so a running child
        // proves the shell kept the stdin pipe open.
        let script = format!("echo '{LINE}'; cat > /dev/null");
        let (mut sidecar, _) = start(sh(&script), timeout()).expect("started");
        std::thread::sleep(Duration::from_millis(200));
        assert!(sidecar.is_running());
        sidecar.stop();
    }

    #[test]
    fn exit_code_1_before_handshake_is_not_a_product_with_stderr() {
        let err = start(
            sh("echo 'No MarkSpec project found in /tmp' >&2; exit 1"),
            timeout(),
        )
        .err()
        .expect("error");
        assert_eq!(err.kind, OpenErrorKind::NotAProduct);
        assert!(
            err.details.contains("No MarkSpec project found"),
            "{}",
            err.details
        );
    }

    #[test]
    fn other_exit_before_handshake_is_spawn_failed() {
        let err = start(sh("echo boom >&2; exit 2"), timeout())
            .err()
            .expect("error");
        assert_eq!(err.kind, OpenErrorKind::SpawnFailed);
        assert!(err.details.contains("boom"), "{}", err.details);
    }

    #[test]
    fn invalid_handshake_line_is_spawn_failed() {
        let err = start(sh("echo hello; cat > /dev/null"), timeout())
            .err()
            .expect("error");
        assert_eq!(err.kind, OpenErrorKind::SpawnFailed);
    }

    #[test]
    fn missing_handshake_within_timeout_is_spawn_failed() {
        let err = start(sh("sleep 5"), Duration::from_millis(200))
            .err()
            .expect("error");
        assert_eq!(err.kind, OpenErrorKind::SpawnFailed);
        assert!(err.details.contains("timed out"), "{}", err.details);
    }

    #[test]
    fn missing_program_is_spawn_failed() {
        let err = start(Command::new("/nonexistent/markspec"), timeout())
            .err()
            .expect("error");
        assert_eq!(err.kind, OpenErrorKind::SpawnFailed);
    }

    #[cfg(debug_assertions)]
    #[test]
    #[ignore = "needs deno on PATH; run with `cargo test -- --ignored`"]
    fn dev_command_serves_the_markspec_repository() {
        let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../..");
        let command = markspec_command(repo.to_str().unwrap()).unwrap();
        let (sidecar, handshake) = start(command, HANDSHAKE_TIMEOUT).expect("started");
        assert_eq!(handshake.api_version, 3);
        assert!(handshake.url.starts_with("http://127.0.0.1:"));
        sidecar.stop();
    }

    #[cfg(debug_assertions)]
    #[test]
    #[ignore = "needs deno on PATH; run with `cargo test -- --ignored`"]
    fn dev_command_reports_a_plain_folder_as_not_a_product() {
        let folder = std::env::temp_dir().join(format!("markdesk-plain-{}", std::process::id()));
        std::fs::create_dir_all(&folder).unwrap();
        let command = markspec_command(folder.to_str().unwrap()).unwrap();
        let err = start(command, HANDSHAKE_TIMEOUT).err().expect("error");
        std::fs::remove_dir_all(&folder).unwrap();
        assert_eq!(err.kind, OpenErrorKind::NotAProduct, "{}", err.details);
        assert!(
            err.details.contains("No MarkSpec project found"),
            "{}",
            err.details
        );
    }

    #[test]
    fn desk_args_add_the_origin_only_when_given() {
        assert_eq!(
            desk_args("/p", None),
            [
                "desk",
                "--serve",
                "--port",
                "0",
                "--root",
                "/p",
                "--exit-on-stdin-eof"
            ]
        );
        let with_origin = desk_args("/p", Some("http://localhost:5173"));
        assert_eq!(
            with_origin[with_origin.len() - 2..],
            ["--allow-origin", "http://localhost:5173"]
        );
    }

    #[test]
    fn open_error_serializes_kind_in_kebab_case() {
        let value = serde_json::to_value(OpenError {
            kind: OpenErrorKind::NotAProduct,
            details: "x".into(),
        })
        .unwrap();
        assert_eq!(
            value,
            serde_json::json!({ "kind": "not-a-product", "details": "x" })
        );
    }
}
