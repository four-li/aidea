use crate::config::{data_root, load_config, LogSettings, LogVerbosity};
use crate::error::{AppError, AppResult};
use chrono::{Local, Offset};
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

pub const DEFAULT_LOG_LINES: usize = 200;
const LOG_SEGMENT_BYTES: u64 = 10 * 1024 * 1024;

pub use crate::config::LogLevel;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LogOwner {
    Aidea,
    Builtin(String),
    Official(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LogChannel {
    Runtime,
    Install,
    Platform,
}

fn write_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn valid_app_id(app_id: &str) -> bool {
    !app_id.is_empty()
        && app_id != "."
        && app_id != ".."
        && !app_id
            .chars()
            .any(|value| value.is_control() || value == '/' || value == '\\')
}

fn owner_dir(owner: &LogOwner) -> AppResult<PathBuf> {
    let root = data_root()?.join("logs");
    match owner {
        LogOwner::Aidea => Ok(root.join("aidea/system")),
        LogOwner::Builtin(app_id) => {
            if !valid_app_id(app_id) {
                return Err(AppError::Config("应用 ID 无效".into()));
            }
            Ok(root.join("builtin").join(app_id))
        }
        LogOwner::Official(app_id) => {
            if !valid_app_id(app_id) {
                return Err(AppError::Config("应用 ID 无效".into()));
            }
            Ok(root.join("official").join(app_id))
        }
    }
}

fn channel_name(channel: LogChannel) -> &'static str {
    match channel {
        LogChannel::Runtime => "runtime",
        LogChannel::Install => "install",
        LogChannel::Platform => "platform",
    }
}

fn log_dir(owner: &LogOwner, channel: LogChannel) -> AppResult<PathBuf> {
    let base = owner_dir(owner)?;
    Ok(match owner {
        LogOwner::Aidea => base,
        LogOwner::Builtin(_) | LogOwner::Official(_) => base.join(channel_name(channel)),
    })
}

fn next_log_path(directory: &Path, date: &str) -> AppResult<PathBuf> {
    let mut next = 1;
    if directory.exists() {
        for entry in fs::read_dir(directory)? {
            let path = entry?.path();
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            let Some(sequence) = name
                .strip_prefix(&format!("{date}-"))
                .and_then(|value| value.strip_suffix(".log"))
                .and_then(|value| value.parse::<u32>().ok())
            else {
                continue;
            };
            next = next.max(sequence + 1);
        }
    }
    Ok(directory.join(format!("{date}-{next:04}.log")))
}

fn current_log_path(directory: &Path, date: &str, entry_size: u64) -> AppResult<PathBuf> {
    let mut latest: Option<(u32, PathBuf)> = None;
    if directory.exists() {
        for entry in fs::read_dir(directory)? {
            let path = entry?.path();
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            let Some(sequence) = name
                .strip_prefix(&format!("{date}-"))
                .and_then(|value| value.strip_suffix(".log"))
                .and_then(|value| value.parse::<u32>().ok())
            else {
                continue;
            };
            if latest
                .as_ref()
                .is_none_or(|(current, _)| sequence > *current)
            {
                latest = Some((sequence, path));
            }
        }
    }
    if let Some((_, path)) = latest {
        if fs::metadata(&path)?.len() + entry_size <= LOG_SEGMENT_BYTES {
            return Ok(path);
        }
    }
    next_log_path(directory, date)
}

fn current_verbosity() -> LogVerbosity {
    load_config()
        .map(|config| config.log_level)
        .unwrap_or_default()
}

fn normalized_message(message: &str) -> (LogLevel, String) {
    let tokens = message.split_whitespace().collect::<Vec<_>>();
    if let Some(level) = tokens.first().and_then(|value| LogLevel::parse(value)) {
        return (level, tokens[1..].join(" "));
    }
    if tokens.len() >= 3 && tokens[0].len() == 10 && tokens[1].len() == 8 {
        if let Some(level) = LogLevel::parse(tokens[2]) {
            return (level, tokens[3..].join(" "));
        }
    }
    (LogLevel::Info, message.to_string())
}

pub fn append_level(
    owner: &LogOwner,
    channel: LogChannel,
    level: LogLevel,
    source: &str,
    message: &str,
) -> AppResult<()> {
    if !current_verbosity().allows(level) {
        return Ok(());
    }
    let _guard = write_lock()
        .lock()
        .map_err(|_| AppError::Config("日志写入锁已损坏".into()))?;
    let now = Local::now();
    let date = now.format("%Y-%m-%d").to_string();
    let line = format!(
        "{}  {}  {}  {}\n",
        now.format("%Y-%m-%d %H:%M:%S"),
        level.as_str(),
        source,
        message.replace('\n', "\\n")
    );
    let directory = log_dir(owner, channel)?;
    fs::create_dir_all(&directory)?;
    let path = current_log_path(&directory, &date, line.len() as u64)?;
    let file_exists = path.exists();
    let mut file = OpenOptions::new().create(true).append(true).open(&path)?;
    if !file_exists {
        let offset = Local::now().offset().fix().local_minus_utc();
        let sign = if offset >= 0 { '+' } else { '-' };
        let absolute = offset.unsigned_abs();
        writeln!(
            file,
            "# timezone={sign}{:02}:{:02}",
            absolute / 3_600,
            absolute / 60 % 60
        )?;
    }
    file.write_all(line.as_bytes())?;
    if !file_exists {
        if let Ok(config) = load_config() {
            let _ = cleanup(&config.log_settings());
        }
    }
    Ok(())
}

pub fn append(owner: &LogOwner, channel: LogChannel, source: &str, message: &str) -> AppResult<()> {
    append_level(owner, channel, LogLevel::Info, source, message)
}

pub fn append_external(
    owner: &LogOwner,
    channel: LogChannel,
    source: &str,
    message: &str,
) -> AppResult<()> {
    let (level, message) = normalized_message(message);
    append_level(owner, channel, level, source, &message)
}

fn log_files(directory: &Path) -> AppResult<Vec<PathBuf>> {
    if !directory.exists() {
        return Ok(Vec::new());
    }
    let mut files = fs::read_dir(directory)?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("log"))
        .collect::<Vec<_>>();
    files.sort();
    Ok(files)
}

fn read_lines(path: &Path) -> AppResult<Vec<String>> {
    BufReader::new(File::open(path)?)
        .lines()
        .collect::<Result<Vec<_>, _>>()
        .map_err(AppError::from)
}

pub fn read_recent(owner: &LogOwner, channel: LogChannel, lines: usize) -> AppResult<String> {
    let directory = log_dir(owner, channel)?;
    let mut files = log_files(&directory)?;
    if files.is_empty() {
        if let LogOwner::Official(app_id) = owner {
            let legacy_name = match channel {
                LogChannel::Runtime => Some("app.log"),
                LogChannel::Install => Some("install.log"),
                LogChannel::Platform => None,
            };
            if let Some(name) = legacy_name {
                let legacy = data_root()?.join("logs").join(app_id).join(name);
                if legacy.exists() {
                    files.push(legacy);
                }
            }
        }
    }
    let mut output = Vec::new();
    for path in files.into_iter().rev() {
        output.extend(read_lines(&path)?.into_iter().rev());
        if output.len() >= lines {
            break;
        }
    }
    output.truncate(lines);
    output.reverse();
    if output.is_empty() {
        Ok(String::new())
    } else {
        Ok(format!("{}\n", output.join("\n")))
    }
}

fn owner_log_root(owner: &LogOwner) -> AppResult<PathBuf> {
    let root = data_root()?.join("logs");
    match owner {
        LogOwner::Aidea => Ok(root.join("aidea/system")),
        LogOwner::Builtin(app_id) => {
            if !valid_app_id(app_id) {
                return Err(AppError::Config("应用 ID 无效".into()));
            }
            Ok(root.join("builtin").join(app_id))
        }
        LogOwner::Official(app_id) => {
            if !valid_app_id(app_id) {
                return Err(AppError::Config("应用 ID 无效".into()));
            }
            Ok(root.join("official").join(app_id))
        }
    }
}

pub fn count_warn_plus(owner: &LogOwner) -> AppResult<usize> {
    let mut count = 0;
    for path in all_log_files(&owner_log_root(owner)?)? {
        for line in read_lines(&path)? {
            let trimmed = line.trim();
            if trimmed.is_empty() || trimmed.starts_with('#') {
                continue;
            }
            let (level, _) = normalized_message(trimmed);
            if matches!(level, LogLevel::Warn | LogLevel::Error) {
                count += 1;
            }
        }
    }
    Ok(count)
}

pub fn clear_all() -> AppResult<()> {
    let root = data_root()?.join("logs");
    if root.exists() {
        fs::remove_dir_all(root)?;
    }
    Ok(())
}

fn all_log_files(root: &Path) -> AppResult<Vec<PathBuf>> {
    let mut files = Vec::new();
    if !root.exists() {
        return Ok(files);
    }
    for entry in fs::read_dir(root)? {
        let path = entry?.path();
        if path.is_dir() {
            files.extend(all_log_files(&path)?);
        } else if path.extension().and_then(|value| value.to_str()) == Some("log") {
            files.push(path);
        }
    }
    Ok(files)
}

fn is_current_file(path: &Path) -> AppResult<bool> {
    let Some(parent) = path.parent() else {
        return Ok(false);
    };
    let Some(name) = path.file_name() else {
        return Ok(false);
    };
    let latest = log_files(parent)?.into_iter().max();
    Ok(latest.as_deref() == Some(path)
        || latest
            .as_ref()
            .is_some_and(|latest| latest.file_name() == Some(name)))
}

pub fn cleanup(settings: &LogSettings) -> AppResult<()> {
    settings.validate()?;
    let root = data_root()?.join("logs");
    let files = all_log_files(&root)?;
    let now = std::time::SystemTime::now();
    let max_age = std::time::Duration::from_secs(u64::from(settings.retention_days) * 86_400);
    let mut candidates = Vec::new();
    let mut total = 0u64;
    for path in files {
        let metadata = fs::metadata(&path)?;
        let modified = metadata.modified().unwrap_or(now);
        let current = is_current_file(&path)?;
        if !current && now.duration_since(modified).unwrap_or_default() >= max_age {
            fs::remove_file(&path)?;
            continue;
        }
        total += metadata.len();
        if !current {
            candidates.push((modified, path, metadata.len()));
        }
    }
    candidates.sort_by_key(|(modified, _, _)| *modified);
    let max_bytes = u64::from(settings.max_total_mb) * 1024 * 1024;
    for (_, path, size) in candidates {
        if total <= max_bytes {
            break;
        }
        fs::remove_file(path)?;
        total -= size;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        append_level, cleanup, clear_all, count_warn_plus, read_recent, LogChannel, LogLevel,
        LogOwner,
    };
    #[test]
    fn 日志按应用类型隔离并拒绝路径穿越() {
        let _guard = crate::config::TEST_DATA_DIR_LOCK.lock().unwrap();
        let root = std::env::temp_dir().join(format!("aidea-diagnostics-{}", uuid::Uuid::new_v4()));
        let previous = std::env::var_os("AIDEA_DATA_DIR");
        std::env::set_var("AIDEA_DATA_DIR", &root);

        append_level(
            &LogOwner::Official("demo".into()),
            LogChannel::Runtime,
            LogLevel::Error,
            "stderr",
            "boom",
        )
        .unwrap();

        assert!(root.join("logs/official/demo/runtime").is_dir());
        assert!(
            read_recent(&LogOwner::Official("demo".into()), LogChannel::Runtime, 200)
                .unwrap()
                .contains("stderr  boom")
        );
        assert!(append_level(
            &LogOwner::Builtin("../escape".into()),
            LogChannel::Platform,
            LogLevel::Error,
            "frontend",
            "bad",
        )
        .is_err());

        if let Some(value) = previous.as_ref() {
            std::env::set_var("AIDEA_DATA_DIR", value);
        } else {
            std::env::remove_var("AIDEA_DATA_DIR");
        }
        let _ = std::fs::remove_dir_all(root);
        assert_eq!(std::env::var_os("AIDEA_DATA_DIR"), previous);
    }

    #[test]
    fn 官方应用兼容旧日志并保留当前文件() {
        let _guard = crate::config::TEST_DATA_DIR_LOCK.lock().unwrap();
        let root = std::env::temp_dir().join(format!("aidea-legacy-log-{}", uuid::Uuid::new_v4()));
        let previous = std::env::var_os("AIDEA_DATA_DIR");
        std::env::set_var("AIDEA_DATA_DIR", &root);
        let legacy_dir = root.join("logs/demo");
        std::fs::create_dir_all(&legacy_dir).unwrap();
        std::fs::write(legacy_dir.join("app.log"), "历史错误\n").unwrap();
        assert_eq!(
            read_recent(&LogOwner::Official("demo".into()), LogChannel::Runtime, 200).unwrap(),
            "历史错误\n"
        );

        append_level(
            &LogOwner::Official("demo".into()),
            LogChannel::Runtime,
            LogLevel::Error,
            "stderr",
            &"x".repeat(2 * 1024 * 1024),
        )
        .unwrap();
        cleanup(&crate::config::LogSettings {
            level: crate::config::LogVerbosity::Standard,
            retention_days: 30,
            max_total_mb: 1,
        })
        .unwrap();
        let runtime_files = std::fs::read_dir(root.join("logs/official/demo/runtime"))
            .unwrap()
            .count();
        assert_eq!(runtime_files, 1);
        if let Some(value) = previous.as_ref() {
            std::env::set_var("AIDEA_DATA_DIR", value);
        } else {
            std::env::remove_var("AIDEA_DATA_DIR");
        }
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn 只统计_warn_及以上并可清空全部日志() {
        let _guard = crate::config::TEST_DATA_DIR_LOCK.lock().unwrap();
        let root = std::env::temp_dir().join(format!("aidea-log-count-{}", uuid::Uuid::new_v4()));
        let previous = std::env::var_os("AIDEA_DATA_DIR");
        std::env::set_var("AIDEA_DATA_DIR", &root);

        append_level(
            &LogOwner::Official("demo".into()),
            LogChannel::Runtime,
            LogLevel::Info,
            "stdout",
            "normal",
        )
        .unwrap();
        append_level(
            &LogOwner::Official("demo".into()),
            LogChannel::Runtime,
            LogLevel::Warn,
            "stderr",
            "warning",
        )
        .unwrap();
        append_level(
            &LogOwner::Official("demo".into()),
            LogChannel::Platform,
            LogLevel::Error,
            "process",
            "failed",
        )
        .unwrap();

        assert_eq!(
            count_warn_plus(&LogOwner::Official("demo".into())).unwrap(),
            2
        );
        clear_all().unwrap();
        assert!(
            !root.join("logs").exists()
                || std::fs::read_dir(root.join("logs"))
                    .unwrap()
                    .next()
                    .is_none()
        );
        if let Some(value) = previous.as_ref() {
            std::env::set_var("AIDEA_DATA_DIR", value);
        } else {
            std::env::remove_var("AIDEA_DATA_DIR");
        }
        let _ = std::fs::remove_dir_all(root);
    }
}
