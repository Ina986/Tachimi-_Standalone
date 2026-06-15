//! パス検証・許可リスト・secure_* コマンド（手順書 02_ / 12_ §2 準拠）。
//! 設計: すべてのファイル読み書きは `ensure_*_path` を通す。
//!   canonical化 → 保護パス拒否 → 許可リスト照合 の3段。
//! 許可ルート＝「アプリ内部 / ホーム標準 / 参照リスト指定 / 利用者がダイアログ等で選んだ場所」のみ。

use serde::Serialize;
use std::collections::HashSet;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::sync::{Mutex, OnceLock};

/// 拒否理由は一律（理由細分で情報を漏らさない）。
const FORBIDDEN_PATH: &str = "forbidden path";
const APP_NAME: &str = "Tachimi";

/// ホーム配下で許可する標準フォルダ（直書き）。
const USER_FOLDERS: &[&str] = &[
    "Documents", "Desktop", "Downloads", "Pictures", "Videos", "Music",
    "Contacts", "Favorites", "Links", "Searches", "Saved Games",
];
/// 業務で使う共有ドライブ固定フォルダ（自動更新の App_installer・JSONフォルダ）。
/// 直書き（割符によるアドレス外付けは終盤フェーズで導入予定）。
const BUSINESS_PATHS: &[&str] = &[
    r"G:\共有ドライブ\CLLENN\編集部フォルダ\編集企画部\編集企画_C班(AT業務推進)\DTP制作部\App_installer",
    r"G:\共有ドライブ\CLLENN\編集部フォルダ\編集企画部\編集企画_C班(AT業務推進)\DTP制作部\JSONフォルダ",
];

static ALLOWED_ROOTS: OnceLock<Mutex<HashSet<PathBuf>>> = OnceLock::new();

/// アプリ専用 temp（`%TEMP%\Tachimi`）。
pub fn app_temp_dir() -> PathBuf {
    std::env::temp_dir().join(APP_NAME)
}

/// 一時フォルダを現ユーザ＋SYSTEM のみの ACL に絞る（初回1回・best-effort）。
pub fn harden_temp_dir() {
    static DONE: OnceLock<()> = OnceLock::new();
    let _ = DONE.get_or_init(|| {
        let dir = app_temp_dir();
        let _ = fs::create_dir_all(&dir);
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            if let Ok(user) = std::env::var("USERNAME") {
                let _ = std::process::Command::new("icacls")
                    .arg(&dir)
                    .args([
                        "/inheritance:r",
                        "/grant:r",
                        &format!("{}:(OI)(CI)F", user),
                        "/grant:r",
                        "SYSTEM:(OI)(CI)F",
                    ])
                    .creation_flags(CREATE_NO_WINDOW)
                    .output();
            }
        }
    });
}

pub fn init() {
    let _ = roots();
}

fn roots() -> &'static Mutex<HashSet<PathBuf>> {
    ALLOWED_ROOTS.get_or_init(|| {
        let mut set = HashSet::new();
        // (A) アプリ内部用
        add_default_root(&mut set, app_temp_dir(), true);
        add_default_root(&mut set, std::env::temp_dir().join("tachimi_preview"), true);
        if let Ok(lad) = std::env::var("LOCALAPPDATA") {
            add_default_root(&mut set, Path::new(&lad).join(APP_NAME), true);
        }
        // (B) ホーム標準フォルダ ＋ OneDrive リダイレクト先
        if let Ok(home) = std::env::var("USERPROFILE") {
            let home = Path::new(&home);
            for name in USER_FOLDERS {
                add_default_root(&mut set, home.join(name), false);
            }
            if let Ok(entries) = fs::read_dir(home) {
                for e in entries.flatten() {
                    let p = e.path();
                    if p.is_dir() {
                        if let Some(n) = p.file_name().and_then(|n| n.to_str()) {
                            if n.starts_with("OneDrive") {
                                add_default_root(&mut set, p, false);
                            }
                        }
                    }
                }
            }
        }
        // (C) 業務用の共有ドライブ固定フォルダ（直書き）
        for p in BUSINESS_PATHS {
            add_default_root(&mut set, PathBuf::from(p), false);
        }
        // (D) 利用者選択は実行時 grant_user_path() で動的追加
        Mutex::new(set)
    })
}

fn add_default_root(set: &mut HashSet<PathBuf>, path: PathBuf, create: bool) {
    if create {
        let _ = fs::create_dir_all(&path);
    }
    if let Ok(canon) = fs::canonicalize(&path) {
        set.insert(canon);
    }
}

/// 利用者がダイアログ/D&D/CLI で選んだ場所を許可リストへ動的追加（ファイルなら親フォルダ）。
pub fn grant_user_path(path: impl AsRef<Path>) -> Result<(), String> {
    let path = path.as_ref();
    let root = if path.exists() {
        let canon = canonicalize_existing(path)?;
        if canon.is_file() {
            canon.parent().ok_or_else(|| FORBIDDEN_PATH.to_string())?.to_path_buf()
        } else {
            canon
        }
    } else {
        canonicalize_existing(path.parent().ok_or_else(|| FORBIDDEN_PATH.to_string())?)?
    };
    reject_protected_path(&root)?;
    roots().lock().map_err(|_| FORBIDDEN_PATH.to_string())?.insert(root);
    Ok(())
}

pub fn grant_user_paths<I, P>(paths: I) -> Result<(), String>
where
    I: IntoIterator<Item = P>,
    P: AsRef<Path>,
{
    for p in paths {
        grant_user_path(p)?;
    }
    Ok(())
}

pub fn ensure_read_path(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let canon = canonicalize_existing(path.as_ref())?;
    reject_protected_path(&canon)?;
    ensure_allowed(&canon)?;
    Ok(canon)
}

pub fn ensure_directory_read_path(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let canon = ensure_read_path(path)?;
    if !canon.is_dir() {
        return Err(FORBIDDEN_PATH.to_string());
    }
    Ok(canon)
}

pub fn ensure_write_path(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let path = path.as_ref();
    let target = if path.exists() {
        canonicalize_existing(path)?
    } else {
        canonicalize_for_new_path(path)?
    };
    reject_protected_path(&target)?;
    ensure_allowed(&target)?;
    Ok(target)
}

pub fn ensure_query_path(path: impl AsRef<Path>) -> Result<PathBuf, String> {
    let path = path.as_ref();
    if path.exists() {
        ensure_read_path(path)
    } else {
        ensure_write_path(path)
    }
}

/// JSON 内の「絶対パスらしい文字列」を再帰検証（設定/バッチ JSON を受けるコマンドで使う）。
/// 横展開キット標準ヘルパー。Tachimi では現状未使用だが、JSON にパスを含む新コマンド追加時に使う。
#[allow(dead_code)]
pub fn validate_json_paths(value: &serde_json::Value) -> Result<(), String> {
    match value {
        serde_json::Value::String(s) => {
            if looks_like_absolute_path(s) {
                ensure_query_path(s)?;
            }
        }
        serde_json::Value::Array(a) => {
            for i in a {
                validate_json_paths(i)?;
            }
        }
        serde_json::Value::Object(m) => {
            for i in m.values() {
                validate_json_paths(i)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// 新規ファイル名の検査（`..`・予約名・危険文字・末尾ドット/空白を拒否）。
pub fn validate_file_name(file_name: &str) -> Result<(), String> {
    if file_name.is_empty() {
        return Err(FORBIDDEN_PATH.to_string());
    }
    if file_name.trim() != file_name || file_name.ends_with('.') {
        return Err(FORBIDDEN_PATH.to_string());
    }
    if file_name == "." || file_name == ".." {
        return Err(FORBIDDEN_PATH.to_string());
    }
    if file_name.contains('\\') || file_name.contains('/') {
        return Err(FORBIDDEN_PATH.to_string());
    }
    if file_name
        .chars()
        .any(|c| c.is_control() || matches!(c, ':' | '*' | '?' | '"' | '<' | '>' | '|'))
    {
        return Err(FORBIDDEN_PATH.to_string());
    }
    let stem = file_name.split('.').next().unwrap_or(file_name).to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || stem
            .strip_prefix("COM")
            .and_then(|n| n.parse::<u8>().ok())
            .map(|n| (1..=9).contains(&n))
            .unwrap_or(false)
        || stem
            .strip_prefix("LPT")
            .and_then(|n| n.parse::<u8>().ok())
            .map(|n| (1..=9).contains(&n))
            .unwrap_or(false);
    if reserved {
        return Err(FORBIDDEN_PATH.to_string());
    }
    Ok(())
}

fn canonicalize_existing(path: &Path) -> Result<PathBuf, String> {
    fs::canonicalize(path).map_err(|_| FORBIDDEN_PATH.to_string())
}

/// 未存在パス: 存在する親まで遡り、各新規コンポーネントを validate_file_name してから再結合。
fn canonicalize_for_new_path(path: &Path) -> Result<PathBuf, String> {
    let mut missing = Vec::new();
    let mut cursor = path;
    while !cursor.exists() {
        let name = cursor
            .file_name()
            .and_then(|n| n.to_str())
            .ok_or_else(|| FORBIDDEN_PATH.to_string())?;
        validate_file_name(name)?;
        missing.push(name.to_string());
        cursor = cursor.parent().ok_or_else(|| FORBIDDEN_PATH.to_string())?;
    }
    let mut canon = canonicalize_existing(cursor)?;
    for name in missing.iter().rev() {
        canon.push(name);
    }
    Ok(canon)
}

/// 許可リスト照合（Path::starts_with はコンポーネント単位＝sibling接頭辞バイパス無し）。
fn ensure_allowed(canon: &Path) -> Result<(), String> {
    let guard = roots().lock().map_err(|_| FORBIDDEN_PATH.to_string())?;
    if guard.iter().any(|root| canon == root || canon.starts_with(root)) {
        return Ok(());
    }
    Err(FORBIDDEN_PATH.to_string())
}

#[allow(dead_code)]
fn looks_like_absolute_path(value: &str) -> bool {
    let n = value.replace('/', "\\");
    let b = n.as_bytes();
    n.starts_with(r"\\") || (b.len() >= 3 && b[1] == b':' && b[2] == b'\\' && b[0].is_ascii_alphabetic())
}

/// ドライブ直下 / ユーザーホーム直下 / システム配下を拒否。
fn reject_protected_path(path: &Path) -> Result<(), String> {
    if is_drive_root(path) || is_user_home_root(path) || is_under_system_root(path) {
        return Err(FORBIDDEN_PATH.to_string());
    }
    Ok(())
}

fn is_drive_root(path: &Path) -> bool {
    path.parent().is_none()
        || path
            .components()
            .filter(|c| !matches!(c, Component::Prefix(_) | Component::RootDir))
            .count()
            == 0
}

fn is_user_home_root(path: &Path) -> bool {
    std::env::var("USERPROFILE")
        .ok()
        .and_then(|h| fs::canonicalize(h).ok())
        .map(|h| path == h)
        .unwrap_or(false)
}

fn is_under_system_root(path: &Path) -> bool {
    let mut protected = Vec::new();
    for var in ["WINDIR", "ProgramFiles", "ProgramFiles(x86)", "ProgramData"] {
        if let Ok(v) = std::env::var(var) {
            if let Ok(c) = fs::canonicalize(v) {
                protected.push(c);
            }
        }
    }
    protected.iter().any(|root| path == root || path.starts_with(root))
}

// ---- secure_* コマンド（フロントは生 plugin-fs/shell を使わず必ずこれ経由）----

#[derive(Serialize)]
pub struct SecureDirEntry {
    pub name: String,
    pub is_file: bool,
    pub is_directory: bool,
    pub is_symlink: bool,
}

#[derive(Serialize)]
pub struct SecureMetadata {
    pub is_file: bool,
    pub is_directory: bool,
    pub size: u64,
}

#[tauri::command]
pub async fn secure_read_dir(path: String) -> Result<Vec<SecureDirEntry>, String> {
    let dir = ensure_directory_read_path(path)?;
    let mut entries = Vec::new();
    for e in fs::read_dir(&dir).map_err(|_| FORBIDDEN_PATH.to_string())? {
        let e = e.map_err(|_| FORBIDDEN_PATH.to_string())?;
        let t = e.file_type().map_err(|_| FORBIDDEN_PATH.to_string())?;
        entries.push(SecureDirEntry {
            name: e.file_name().to_string_lossy().to_string(),
            is_file: t.is_file(),
            is_directory: t.is_dir(),
            is_symlink: t.is_symlink(),
        });
    }
    Ok(entries)
}

#[tauri::command]
pub async fn secure_read_text_file(file_path: String) -> Result<String, String> {
    let path = ensure_read_path(file_path)?;
    if !path.is_file() {
        return Err(FORBIDDEN_PATH.to_string());
    }
    fs::read_to_string(path).map_err(|_| FORBIDDEN_PATH.to_string())
}

#[tauri::command]
pub async fn secure_read_binary_file(file_path: String) -> Result<Vec<u8>, String> {
    let path = ensure_read_path(file_path)?;
    if !path.is_file() {
        return Err(FORBIDDEN_PATH.to_string());
    }
    fs::read(path).map_err(|_| FORBIDDEN_PATH.to_string())
}

#[tauri::command]
pub async fn secure_stat(path: String) -> Result<SecureMetadata, String> {
    let p = ensure_query_path(&path)?;
    let m = fs::symlink_metadata(&p).map_err(|_| FORBIDDEN_PATH.to_string())?;
    Ok(SecureMetadata {
        is_file: m.is_file(),
        is_directory: m.is_dir(),
        size: m.len(),
    })
}

/// 既定アプリ/エクスプローラーで開く（許可済みパスのみ・シェル非経由）。
#[tauri::command]
pub async fn secure_open_path(path: String) -> Result<(), String> {
    let p = ensure_read_path(path)?;
    opener::open(&p).map_err(|_| "開けませんでした".to_string())
}
