use serde::Serialize;
use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::{Path, PathBuf},
    time::SystemTime,
};
use tauri::{AppHandle, Manager, Runtime};

/// Session rollouts can reach tens of megabytes, so the reader only ever walks
/// backwards from the end of the file and gives up after this many bytes.
const MAX_TAIL_SCAN_BYTES: u64 = 8 * 1024 * 1024;
const TAIL_CHUNK_BYTES: u64 = 256 * 1024;
const MAX_SESSION_CANDIDATES: usize = 6;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub id: String,
    pub label: String,
    pub used_percent: f64,
    pub resets_at_iso: Option<String>,
    pub resets_at_epoch_seconds: Option<i64>,
    pub window_minutes: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaudeUsageSnapshot {
    pub source: String,
    pub fetched_at_ms: Option<i64>,
    pub plan: Option<String>,
    pub windows: Vec<UsageWindow>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsageSnapshot {
    pub source: String,
    pub observed_at_iso: Option<String>,
    pub plan: Option<String>,
    pub credit_balance: Option<String>,
    pub has_credits: Option<bool>,
    pub windows: Vec<UsageWindow>,
}

fn home_dir<R: Runtime>(app: &AppHandle<R>) -> Result<PathBuf, String> {
    app.path()
        .home_dir()
        .map_err(|error| format!("Could not resolve the home directory: {error}"))
}

/// Reads the last line of `path` that contains `needle` *and* satisfies
/// `accept`, scanning backwards in chunks so a multi-megabyte rollout never has
/// to be loaded into memory.
///
/// The predicate matters: Codex keeps writing rate-limit events after a session
/// stops reporting numbers, so the final mention of the needle is often empty.
/// Without `accept` that empty tail hides the real reading earlier in the same
/// file, and the reader falls back to an older session with stale percentages.
fn last_line_matching(path: &Path, needle: &str, accept: impl Fn(&str) -> bool) -> Option<String> {
    let mut file = File::open(path).ok()?;
    let length = file.metadata().ok()?.len();
    if length == 0 {
        return None;
    }

    let floor = length.saturating_sub(MAX_TAIL_SCAN_BYTES);
    let mut suffix: Vec<u8> = Vec::new();
    let mut end = length;

    while end > floor {
        let start = end.saturating_sub(TAIL_CHUNK_BYTES).max(floor);
        let mut chunk = vec![0u8; (end - start) as usize];
        file.seek(SeekFrom::Start(start)).ok()?;
        file.read_exact(&mut chunk).ok()?;
        chunk.extend_from_slice(&suffix);
        suffix = chunk;
        end = start;

        let text = String::from_utf8_lossy(&suffix);
        // The first line of the buffer is only whole once the scan reaches the
        // start of the file (or the scan floor), so skip it until then.
        let searchable = if start == 0 {
            text.as_ref()
        } else {
            match text.find('\n') {
                Some(index) => &text[index + 1..],
                None => continue,
            }
        };

        if let Some(line) = searchable
            .lines()
            .rev()
            .find(|line| line.contains(needle) && accept(line))
        {
            return Some(line.to_string());
        }
    }

    None
}

fn collect_session_files(dir: &Path, files: &mut Vec<(SystemTime, PathBuf)>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        if metadata.is_dir() {
            collect_session_files(&path, files);
        } else if path.extension().is_some_and(|extension| extension == "jsonl") {
            if let Ok(modified) = metadata.modified() {
                files.push((modified, path));
            }
        }
    }
}

/// True when a rate-limit event actually carries a window percentage. Codex
/// writes `"primary":null,"secondary":null` events when a session winds down,
/// and those say nothing about the account's usage.
fn carries_rate_limit_windows(line: &str) -> bool {
    let Ok(event) = serde_json::from_str::<serde_json::Value>(line) else {
        return false;
    };
    let Some(rate_limits) = event.pointer("/payload/rate_limits") else {
        return false;
    };
    ["primary", "secondary"]
        .into_iter()
        .any(|key| rate_limits.get(key).and_then(used_percent).is_some())
}

fn used_percent(entry: &serde_json::Value) -> Option<f64> {
    entry
        .get("utilization")
        .or_else(|| entry.get("used_percent"))
        .and_then(|value| value.as_f64())
}

fn claude_window(key: &str, label: &str, utilization: &serde_json::Value) -> Option<UsageWindow> {
    let entry = utilization.get(key)?;
    Some(UsageWindow {
        id: key.replace('_', "-"),
        label: label.to_string(),
        used_percent: used_percent(entry)?,
        resets_at_iso: entry
            .get("resets_at")
            .and_then(|value| value.as_str())
            .map(str::to_string),
        resets_at_epoch_seconds: None,
        window_minutes: None,
    })
}

#[tauri::command]
pub fn read_claude_usage<R: Runtime>(app: AppHandle<R>) -> Result<ClaudeUsageSnapshot, String> {
    claude_usage_at(&home_dir(&app)?.join(".claude.json"))
}

fn claude_usage_at(path: &Path) -> Result<ClaudeUsageSnapshot, String> {
    if !path.exists() {
        return Err("Claude Code state file was not found in the home directory.".into());
    }

    let contents = fs::read_to_string(path)
        .map_err(|error| format!("Could not read the Claude Code state file: {error}"))?;
    let root: serde_json::Value = serde_json::from_str(&contents)
        .map_err(|error| format!("Could not parse the Claude Code state file: {error}"))?;

    let cached = root
        .get("cachedUsageUtilization")
        .ok_or("Claude Code has not cached any usage utilization yet.")?;
    let utilization = cached
        .get("utilization")
        .ok_or("The cached Claude usage entry has no utilization block.")?;

    // Only surface windows with a documented meaning. Unrecognised internal
    // codenames are ignored rather than shown under a made-up label.
    let windows: Vec<UsageWindow> = [
        ("five_hour", "Session (5h)"),
        ("seven_day", "Weekly"),
        ("seven_day_fable", "Fable"),
        ("seven_day_opus", "Weekly Opus"),
        ("seven_day_sonnet", "Weekly Sonnet"),
    ]
    .into_iter()
    .filter_map(|(key, label)| claude_window(key, label, utilization))
    .collect();

    if windows.is_empty() {
        return Err("The cached Claude usage entry has no readable limit windows.".into());
    }

    let plan = root
        .get("oauthAccount")
        .and_then(|account| account.get("organizationRateLimitTier"))
        .and_then(|value| value.as_str())
        .map(str::to_string);

    Ok(ClaudeUsageSnapshot {
        source: "~/.claude.json".into(),
        fetched_at_ms: cached.get("fetchedAtMs").and_then(|value| value.as_i64()),
        plan,
        windows,
    })
}

fn codex_window(
    key: &str,
    id: &str,
    label: &str,
    rate_limits: &serde_json::Value,
) -> Option<UsageWindow> {
    let entry = rate_limits.get(key)?;
    Some(UsageWindow {
        id: id.to_string(),
        label: label.to_string(),
        used_percent: used_percent(entry)?,
        resets_at_iso: None,
        resets_at_epoch_seconds: entry.get("resets_at").and_then(|value| value.as_i64()),
        window_minutes: entry.get("window_minutes").and_then(|value| value.as_u64()),
    })
}

#[tauri::command]
pub fn read_codex_usage<R: Runtime>(app: AppHandle<R>) -> Result<CodexUsageSnapshot, String> {
    codex_usage_in(&home_dir(&app)?.join(".codex").join("sessions"))
}

fn codex_usage_in(sessions_dir: &Path) -> Result<CodexUsageSnapshot, String> {
    if !sessions_dir.exists() {
        return Err("No Codex CLI session directory was found in the home directory.".into());
    }

    let mut files = Vec::new();
    collect_session_files(sessions_dir, &mut files);
    if files.is_empty() {
        return Err("The Codex CLI session directory contains no rollout files.".into());
    }
    files.sort_by_key(|(modified, _)| std::cmp::Reverse(*modified));

    // A freshly started session has no usage event yet, so fall back through the
    // next most recent rollouts until one reports rate limits.
    for (_, path) in files.into_iter().take(MAX_SESSION_CANDIDATES) {
        let Some(line) = last_line_matching(&path, "\"rate_limits\"", carries_rate_limit_windows)
        else {
            continue;
        };
        let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) else {
            continue;
        };
        let Some(rate_limits) = event.pointer("/payload/rate_limits") else {
            continue;
        };

        let windows: Vec<UsageWindow> = [
            ("primary", "five-hour", "5-hour"),
            ("secondary", "weekly", "Weekly"),
        ]
        .into_iter()
        .filter_map(|(key, id, label)| codex_window(key, id, label, rate_limits))
        .collect();

        if windows.is_empty() {
            continue;
        }

        let credits = rate_limits.get("credits");
        return Ok(CodexUsageSnapshot {
            source: path
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| "codex session".into()),
            observed_at_iso: event
                .get("timestamp")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            plan: rate_limits
                .get("plan_type")
                .and_then(|value| value.as_str())
                .map(str::to_string),
            credit_balance: credits
                .and_then(|credits| credits.get("balance"))
                .and_then(|value| value.as_str())
                .map(str::to_string),
            has_credits: credits
                .and_then(|credits| credits.get("has_credits"))
                .and_then(|value| value.as_bool()),
            windows,
        });
    }

    Err("No recent Codex CLI session reported any rate limit data.".into())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("ai-usage-test-{name}"));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    const CLAUDE_STATE: &str = r#"{
        "oauthAccount": { "organizationRateLimitTier": "default_claude_max_5x" },
        "cachedUsageUtilization": {
            "fetchedAtMs": 1789009104497,
            "utilization": {
                "five_hour": { "utilization": 30, "resets_at": "2026-09-10T04:00:00.421986+00:00" },
                "seven_day": { "utilization": 20, "resets_at": "2026-09-16T08:00:00.422006+00:00" },
                "seven_day_opus": null,
                "nimbus_quill": { "utilization": 0, "resets_at": null }
            }
        }
    }"#;

    fn codex_event(primary: f64, secondary: f64) -> String {
        format!(
            r#"{{"timestamp":"2026-09-09T13:58:17.271Z","type":"event_msg","payload":{{"type":"token_count","rate_limits":{{"limit_id":"codex","primary":{{"used_percent":{primary},"window_minutes":300,"resets_at":1788977819}},"secondary":{{"used_percent":{secondary},"window_minutes":10080,"resets_at":1789527560}},"credits":{{"has_credits":false,"balance":"0"}},"plan_type":"plus"}}}}}}"#
        )
    }

    #[test]
    fn claude_reader_extracts_documented_windows_only() {
        let dir = temp_dir("claude");
        let path = dir.join(".claude.json");
        fs::write(&path, CLAUDE_STATE).expect("write state");

        let snapshot = claude_usage_at(&path).expect("snapshot");
        assert_eq!(snapshot.plan.as_deref(), Some("default_claude_max_5x"));
        assert_eq!(snapshot.fetched_at_ms, Some(1789009104497));

        // The null window and the internal codename are both dropped.
        let ids: Vec<&str> = snapshot.windows.iter().map(|w| w.id.as_str()).collect();
        assert_eq!(ids, vec!["five-hour", "seven-day"]);

        let session = &snapshot.windows[0];
        assert_eq!(session.used_percent, 30.0);
        assert_eq!(
            session.resets_at_iso.as_deref(),
            Some("2026-09-10T04:00:00.421986+00:00")
        );
    }

    #[test]
    fn claude_reader_reports_a_missing_file() {
        let dir = temp_dir("claude-missing");
        let error = claude_usage_at(&dir.join(".claude.json")).unwrap_err();
        assert!(error.contains("not found"), "unexpected error: {error}");
    }

    #[test]
    fn claude_reader_reports_a_state_file_without_a_usage_cache() {
        let dir = temp_dir("claude-empty");
        let path = dir.join(".claude.json");
        fs::write(&path, r#"{"oauthAccount":{}}"#).expect("write state");
        let error = claude_usage_at(&path).unwrap_err();
        assert!(error.contains("not cached"), "unexpected error: {error}");
    }

    #[test]
    fn codex_reader_takes_the_last_reading_of_the_newest_session() {
        let dir = temp_dir("codex");
        let sessions = dir.join("2026").join("09").join("09");
        fs::create_dir_all(&sessions).expect("create sessions");

        let path = sessions.join("rollout-a.jsonl");
        let mut file = File::create(&path).expect("create rollout");
        writeln!(file, "{}", codex_event(11.0, 22.0)).expect("write");
        writeln!(file, r#"{{"type":"event_msg","payload":{{"type":"agent_message"}}}}"#)
            .expect("write");
        writeln!(file, "{}", codex_event(57.0, 35.0)).expect("write");
        drop(file);

        let snapshot = codex_usage_in(&dir).expect("snapshot");
        assert_eq!(snapshot.plan.as_deref(), Some("plus"));
        assert_eq!(snapshot.has_credits, Some(false));
        assert_eq!(snapshot.credit_balance.as_deref(), Some("0"));
        assert_eq!(snapshot.observed_at_iso.as_deref(), Some("2026-09-09T13:58:17.271Z"));

        assert_eq!(snapshot.windows.len(), 2);
        assert_eq!(snapshot.windows[0].id, "five-hour");
        assert_eq!(snapshot.windows[0].used_percent, 57.0);
        assert_eq!(snapshot.windows[0].window_minutes, Some(300));
        assert_eq!(snapshot.windows[0].resets_at_epoch_seconds, Some(1788977819));
        assert_eq!(snapshot.windows[1].id, "weekly");
        assert_eq!(snapshot.windows[1].used_percent, 35.0);
    }

    /// Codex keeps writing rate-limit events after a session stops reporting
    /// numbers. Taking the file's last mention of `rate_limits` therefore lands
    /// on an empty event and throws away the whole session, so the reader falls
    /// back to an older rollout and reports percentages that are hours stale.
    #[test]
    fn codex_reader_ignores_an_empty_trailing_rate_limit_event() {
        let dir = temp_dir("codex-empty-tail");
        let sessions = dir.join("2026").join("09").join("10");
        fs::create_dir_all(&sessions).expect("create sessions");

        let older = sessions.join("rollout-old.jsonl");
        let mut file = File::create(&older).expect("create older rollout");
        writeln!(file, "{}", codex_event(92.0, 49.0)).expect("write");
        drop(file);

        let newest = sessions.join("rollout-new.jsonl");
        let mut file = File::create(&newest).expect("create newest rollout");
        writeln!(file, "{}", codex_event(100.0, 51.0)).expect("write");
        writeln!(
            file,
            r#"{{"timestamp":"2026-09-10T15:20:00.000Z","type":"event_msg","payload":{{"type":"token_count","rate_limits":{{"limit_id":"premium","primary":null,"secondary":null,"credits":{{"has_credits":false,"balance":"0"}},"plan_type":"plus"}}}}}}"#
        )
        .expect("write empty tail");
        drop(file);

        let snapshot = codex_usage_in(&dir).expect("snapshot");
        assert_eq!(snapshot.windows.len(), 2);
        assert_eq!(snapshot.windows[0].used_percent, 100.0);
        assert_eq!(snapshot.windows[1].used_percent, 51.0);
    }

    #[test]
    fn codex_reader_finds_a_reading_buried_behind_megabytes_of_padding() {
        let dir = temp_dir("codex-large");
        fs::create_dir_all(&dir).expect("create sessions");

        let path = dir.join("rollout-large.jsonl");
        let mut file = File::create(&path).expect("create rollout");
        writeln!(file, "{}", codex_event(57.0, 35.0)).expect("write");
        // Push the reading well past the backward chunk size so the scan has to
        // stitch several chunks together before it matches.
        let filler = "x".repeat(4096);
        for _ in 0..512 {
            writeln!(file, r#"{{"type":"event_msg","filler":"{filler}"}}"#).expect("write");
        }
        drop(file);

        assert!(path.metadata().unwrap().len() > 2 * TAIL_CHUNK_BYTES);
        let snapshot = codex_usage_in(&dir).expect("snapshot");
        assert_eq!(snapshot.windows[0].used_percent, 57.0);
    }

    #[test]
    fn codex_reader_skips_a_session_that_never_reported_usage() {
        let dir = temp_dir("codex-skip");
        fs::create_dir_all(&dir).expect("create sessions");
        fs::write(
            dir.join("rollout-quiet.jsonl"),
            "{\"type\":\"event_msg\",\"payload\":{\"type\":\"agent_message\"}}\n",
        )
        .expect("write");

        let error = codex_usage_in(&dir).unwrap_err();
        assert!(error.contains("No recent Codex"), "unexpected error: {error}");
    }

    /// Manual smoke test against the real CLI files on the current machine.
    /// Ignored by default because it depends on local state.
    /// Run with: cargo test --lib -- --ignored --nocapture
    #[test]
    #[ignore]
    fn reads_the_real_local_sources() {
        let home = PathBuf::from(std::env::var("USERPROFILE").or_else(|_| std::env::var("HOME")).expect("home"));
        println!("claude -> {:#?}", claude_usage_at(&home.join(".claude.json")));
        println!("codex  -> {:#?}", codex_usage_in(&home.join(".codex").join("sessions")));
    }

    #[test]
    fn codex_reader_reports_a_missing_session_directory() {
        let dir = temp_dir("codex-missing");
        let error = codex_usage_in(&dir.join("sessions")).unwrap_err();
        assert!(error.contains("No Codex CLI session directory"), "got: {error}");
    }
}
