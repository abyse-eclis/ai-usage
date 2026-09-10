//! Runs a user-configured CLI command so a provider writes a fresh usage
//! reading to disk.
//!
//! Both providers only record their rate limits as a side effect of a real
//! request, so running one of these commands spends the user's quota. Nothing
//! here is invoked on a timer: the command is configured by hand in Settings
//! and only fires when the reload button is pressed.

use serde::Serialize;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

/// Long enough for a small CLI round trip, short enough that a hung command
/// does not leave the reload spinner turning forever.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(90);
const POLL_INTERVAL: Duration = Duration::from_millis(150);
/// Only the tail of the output is kept -- it is for diagnosis, not logging.
const MAX_OUTPUT_CHARS: usize = 600;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CliRefreshResult {
    pub ok: bool,
    pub exit_code: Option<i32>,
    pub output: String,
}

fn tail(text: &str) -> String {
    let trimmed = text.trim();
    if trimmed.chars().count() <= MAX_OUTPUT_CHARS {
        return trimmed.to_string();
    }
    let skip = trimmed.chars().count() - MAX_OUTPUT_CHARS;
    trimmed.chars().skip(skip).collect()
}

#[cfg(windows)]
fn spawn(command: &str) -> std::io::Result<std::process::Child> {
    use std::os::windows::process::CommandExt;
    // The app is a windowed binary; without this flag every refresh flashes a
    // console window over whatever the user is doing.
    const CREATE_NO_WINDOW: u32 = 0x0800_0000;

    // These commands routinely point at an executable under a path with
    // spaces, so the command itself is quoted. `/S` makes cmd strip exactly
    // that one outer pair and run the rest verbatim, and `raw_arg` keeps Rust
    // from re-quoting the string and breaking the inner quotes.
    Command::new("cmd")
        .arg("/S")
        .arg("/C")
        .raw_arg(format!("\"{command}\""))
        .creation_flags(CREATE_NO_WINDOW)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
}

#[cfg(not(windows))]
fn spawn(command: &str) -> std::io::Result<std::process::Child> {
    Command::new("sh")
        .args(["-c", command])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .stdin(Stdio::null())
        .spawn()
}

/// Runs `command` through the platform shell and waits for it to finish.
///
/// The command comes from the user's own settings and is run as the user, the
/// same as typing it in a terminal. It is never assembled from provider data.
#[tauri::command]
pub fn run_cli_refresh(command: String) -> Result<CliRefreshResult, String> {
    let trimmed = command.trim().to_string();
    if trimmed.is_empty() {
        return Err("No refresh command is configured.".into());
    }

    let mut child = spawn(&trimmed).map_err(|error| format!("Could not start the command: {error}"))?;

    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(status)) => {
                let output = child
                    .wait_with_output()
                    .map(|out| {
                        let mut text = String::from_utf8_lossy(&out.stdout).to_string();
                        text.push_str(&String::from_utf8_lossy(&out.stderr));
                        tail(&text)
                    })
                    .unwrap_or_default();
                return Ok(CliRefreshResult {
                    ok: status.success(),
                    exit_code: status.code(),
                    output,
                });
            }
            Ok(None) => {
                if started.elapsed() >= COMMAND_TIMEOUT {
                    let _ = child.kill();
                    return Err(format!(
                        "The refresh command did not finish within {} seconds.",
                        COMMAND_TIMEOUT.as_secs()
                    ));
                }
                std::thread::sleep(POLL_INTERVAL);
            }
            Err(error) => return Err(format!("Could not wait for the command: {error}")),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_commands_are_refused_rather_than_run() {
        let error = run_cli_refresh("   ".into()).unwrap_err();
        assert!(error.contains("No refresh command"), "got: {error}");
    }

    #[test]
    fn a_failing_command_reports_its_exit_code_instead_of_erroring() {
        let result = run_cli_refresh("exit 3".into()).expect("command ran");
        assert!(!result.ok);
        assert_eq!(result.exit_code, Some(3));
    }

    #[test]
    fn a_successful_command_reports_its_output() {
        let result = run_cli_refresh("echo companion".into()).expect("command ran");
        assert!(result.ok, "output: {}", result.output);
        assert!(result.output.contains("companion"), "output: {}", result.output);
    }
}
