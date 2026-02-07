mod processor;

use processor::{ProcessOptions, ProcessResult, ImageInfo, PreviewFileInfo};
use rayon::prelude::*;
use rayon::ThreadPoolBuilder;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::Emitter;

/// 処理キャンセル用のグローバルフラグ
static CANCEL_FLAG: AtomicBool = AtomicBool::new(false);

/// 並列処理のスレッドプールを初期化
/// CPUコア数の2倍のスレッドを使用（I/O待ち時間を活用）
fn init_thread_pool() {
    let num_cpus = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4);

    // コア数の2倍（最大32スレッド）
    let num_threads = (num_cpus * 2).min(32);

    if let Err(e) = ThreadPoolBuilder::new()
        .num_threads(num_threads)
        .build_global()
    {
        eprintln!("スレッドプール初期化エラー: {}", e);
    } else {
        println!("並列処理: {}スレッドで初期化", num_threads);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProgressPayload {
    pub current: usize,      // 完了数
    pub total: usize,        // 合計
    pub filename: String,
    pub phase: String,
    pub in_progress: usize,  // 現在処理中のファイル数
}

/// フォルダ内の画像ファイル一覧を取得
#[tauri::command]
async fn get_image_files(folder_path: String) -> Result<Vec<String>, String> {
    let path = PathBuf::from(&folder_path);
    if !path.exists() {
        return Err("フォルダが存在しません".to_string());
    }

    // フォルダ切り替え時にPSDキャッシュをクリア
    processor::clear_psd_cache();

    let extensions = ["png", "jpg", "jpeg", "gif", "webp", "psd", "tif", "tiff"];
    let mut files: Vec<String> = Vec::new();

    for entry in walkdir::WalkDir::new(&path)
        .max_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension() {
                let ext_lower = ext.to_string_lossy().to_lowercase();
                if extensions.contains(&ext_lower.as_str()) {
                    if let Some(filename) = path.file_name() {
                        files.push(filename.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    files.sort();
    Ok(files)
}

/// PSDキャッシュをクリア
#[tauri::command]
async fn clear_psd_cache() {
    processor::clear_psd_cache();
}

/// 画像のプレビューを取得（Base64）
#[tauri::command]
async fn get_image_preview(file_path: String, max_size: u32) -> Result<ImageInfo, String> {
    processor::get_image_preview(&file_path, max_size)
}

/// 画像のプレビューをファイルに保存して取得（高速化版）
/// Base64エンコードを回避し、ファイルシステム経由で転送
#[tauri::command]
async fn get_image_preview_as_file(
    app_handle: tauri::AppHandle,
    file_path: String,
    max_size: u32
) -> Result<PreviewFileInfo, String> {
    // 進捗通知: 読み込み開始
    let _ = app_handle.emit("preview_progress", "reading");

    // 一時ディレクトリを取得
    let temp_dir = std::env::temp_dir().join("tachimi_preview");
    std::fs::create_dir_all(&temp_dir)
        .map_err(|e| format!("一時フォルダの作成に失敗: {}", e))?;
    let temp_dir_str = temp_dir.to_string_lossy().to_string();

    // 非同期でブロッキング処理を実行（UIフリーズを防止）
    let result = tokio::task::spawn_blocking(move || {
        processor::get_image_preview_file(&file_path, max_size, &temp_dir_str)
    }).await.map_err(|e| format!("タスクエラー: {}", e))?;

    result
}

/// 処理をキャンセル
#[tauri::command]
async fn cancel_processing() -> Result<(), String> {
    CANCEL_FLAG.store(true, Ordering::SeqCst);
    println!("処理キャンセルが要求されました");
    Ok(())
}

/// 画像を処理（クロップ、タチキリ処理）
#[tauri::command]
async fn process_images(
    app_handle: tauri::AppHandle,
    input_folder: String,
    output_folder: String,
    files: Vec<String>,
    options: ProcessOptions,
) -> Result<ProcessResult, String> {
    // キャンセルフラグをリセット
    CANCEL_FLAG.store(false, Ordering::SeqCst);

    // 入力バリデーション
    if files.is_empty() {
        return Err("処理するファイルが選択されていません".to_string());
    }

    let input_path = PathBuf::from(&input_folder);
    if !input_path.exists() {
        return Err(format!("入力フォルダが存在しません: {}", input_folder));
    }

    let base_output_path = PathBuf::from(&output_folder);

    // JPEGは "jpg" サブフォルダに出力（一時フォルダの場合はそのまま）
    let output_path = if output_folder.contains("_temp_pdf_source") {
        base_output_path.clone()
    } else {
        base_output_path.join("jpg")
    };

    // 出力フォルダを作成
    std::fs::create_dir_all(&output_path)
        .map_err(|e| format!("出力フォルダの作成に失敗: {}", e))?;

    let total = files.len();
    let processed = AtomicUsize::new(0);
    let in_progress = AtomicUsize::new(0);  // 現在処理中のファイル数
    let errors: Mutex<Vec<String>> = Mutex::new(Vec::new());

    // rayon並列処理で複数ファイルを同時処理
    // enumerate()でインデックスを取得してノンブル用のページ番号に使用
    files.par_iter().enumerate().for_each(|(index, filename)| {
        // キャンセルチェック
        if CANCEL_FLAG.load(Ordering::Relaxed) {
            return;
        }

        // 処理開始を通知
        let started = in_progress.fetch_add(1, Ordering::SeqCst) + 1;
        let done = processed.load(Ordering::SeqCst);
        let _ = app_handle.emit("progress", ProgressPayload {
            current: done,
            total,
            filename: filename.clone(),
            phase: format!("読み込み中... ({} 処理中)", started),
            in_progress: started,
        });

        let input_file = input_path.join(filename);
        let output_file = match PathBuf::from(filename)
            .with_extension("jpg")
            .file_name()
        {
            Some(name) => output_path.join(name),
            None => {
                if let Ok(mut errs) = errors.lock() {
                    errs.push(format!("{}: 無効なファイル名", filename));
                }
                in_progress.fetch_sub(1, Ordering::SeqCst);
                processed.fetch_add(1, Ordering::SeqCst);
                return;
            }
        };

        // ページ番号 = 開始番号 + インデックス
        let page_number = options.nombre_start_number + index as u32;

        // 画像処理を実行
        let result = processor::process_single_image(&input_file, &output_file, &options, page_number);

        // 処理完了後に進捗を送信
        in_progress.fetch_sub(1, Ordering::SeqCst);
        let completed = processed.fetch_add(1, Ordering::SeqCst) + 1;
        let currently_processing = in_progress.load(Ordering::SeqCst);
        let _ = app_handle.emit("progress", ProgressPayload {
            current: completed,
            total,
            filename: filename.clone(),
            phase: if currently_processing > 0 {
                format!("変換完了 ({}/{}) - {} 処理中", completed, total, currently_processing)
            } else {
                format!("変換完了 ({}/{})", completed, total)
            },
            in_progress: currently_processing,
        });

        match result {
            Ok(_) => {}
            Err(e) => {
                if let Ok(mut errs) = errors.lock() {
                    errs.push(format!("{}: {}", filename, e));
                }
            }
        }
    });

    // キャンセルされた場合は早期リターン
    if CANCEL_FLAG.load(Ordering::Relaxed) {
        let done = processed.load(Ordering::SeqCst);
        return Ok(ProcessResult {
            processed: done,
            total,
            errors: vec![format!("処理がキャンセルされました ({}/{}完了)", done, total)],
            output_folder: output_folder.clone(),
        });
    }

    // Mutexからエラーリストを取得（poisonedの場合は空リストを返す）
    let error_list = errors.into_inner().unwrap_or_else(|poisoned| {
        eprintln!("エラーリストのMutexがpoisoned状態です");
        poisoned.into_inner()
    });

    Ok(ProcessResult {
        processed: processed.load(Ordering::SeqCst),
        total,
        errors: error_list,
        output_folder: output_folder.clone(),
    })
}

/// PDF生成
#[tauri::command]
async fn generate_pdf(
    app_handle: tauri::AppHandle,
    input_folder: String,
    output_path: String,
    files: Vec<String>,
    options: processor::PdfOptions,
) -> Result<String, String> {
    processor::generate_pdf(&app_handle, &input_folder, &output_path, &files, &options)
}

/// デフォルト出力フォルダのパスを取得（デスクトップ/Script_Output/処理結果PDF）
#[tauri::command]
async fn get_default_output_folder() -> Result<String, String> {
    // デスクトップパスを取得
    let desktop = dirs::desktop_dir()
        .ok_or_else(|| "デスクトップパスを取得できません".to_string())?;

    let output_folder = desktop.join("Script_Output").join("処理結果PDF");

    // フォルダが存在しなければ作成
    if !output_folder.exists() {
        std::fs::create_dir_all(&output_folder)
            .map_err(|e| format!("出力フォルダの作成に失敗: {}", e))?;
    }

    Ok(output_folder.to_string_lossy().to_string())
}

/// フォルダを削除（中身ごと）
#[tauri::command]
async fn delete_folder(path: String) -> Result<(), String> {
    let folder_path = PathBuf::from(&path);
    if folder_path.exists() {
        std::fs::remove_dir_all(&folder_path)
            .map_err(|e| format!("フォルダの削除に失敗: {}", e))?;
    }
    Ok(())
}

/// フォルダ内のサブフォルダとJSONファイル一覧を取得
#[derive(Debug, Clone, Serialize)]
pub struct FolderContents {
    pub folders: Vec<String>,
    pub json_files: Vec<String>,
}

#[tauri::command]
async fn list_folder_contents(folder_path: String) -> Result<FolderContents, String> {
    let path = PathBuf::from(&folder_path);
    if !path.exists() {
        return Err(format!("フォルダが存在しません: {}", folder_path));
    }

    let mut folders: Vec<String> = Vec::new();
    let mut json_files: Vec<String> = Vec::new();

    for entry in walkdir::WalkDir::new(&path)
        .max_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let entry_path = entry.path();
        // ルートディレクトリ自体はスキップ
        if entry_path == path {
            continue;
        }

        if entry_path.is_dir() {
            if let Some(name) = entry_path.file_name() {
                folders.push(name.to_string_lossy().to_string());
            }
        } else if entry_path.is_file() {
            if let Some(ext) = entry_path.extension() {
                if ext.to_string_lossy().to_lowercase() == "json" {
                    if let Some(filename) = entry_path.file_name() {
                        json_files.push(filename.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    folders.sort();
    json_files.sort();
    Ok(FolderContents { folders, json_files })
}

/// 作品タイトル検索結果
#[derive(Debug, Clone, Serialize)]
pub struct SearchResult {
    pub label: String,      // レーベル名（親フォルダ名）
    pub title: String,      // 作品タイトル（フォルダ名）
    pub path: String,       // フルパス
}

/// フォルダ内を検索（作品タイトルで検索）
/// 構造: JSONフォルダ / レーベル / 作品タイトル.json
#[tauri::command]
async fn search_json_folders(base_path: String, query: String) -> Result<Vec<SearchResult>, String> {
    println!("検索開始: base_path={}, query={}", base_path, query);
    let path = PathBuf::from(&base_path);
    if !path.exists() {
        println!("フォルダが存在しません: {}", base_path);
        return Err(format!("フォルダが存在しません: {}", base_path));
    }

    let query_lower = query.to_lowercase();
    let mut results: Vec<SearchResult> = Vec::new();
    let mut entry_count = 0;

    // レーベルフォルダ内のJSONファイルを検索（深さ2 = レーベル/ファイル.json）
    for entry in walkdir::WalkDir::new(&path)
        .min_depth(2)
        .max_depth(2)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        entry_count += 1;
        let entry_path = entry.path();

        // JSONファイルのみ対象
        if entry_path.is_file() {
            if let Some(ext) = entry_path.extension() {
                if ext.to_string_lossy().to_lowercase() == "json" {
                    if let Some(filename) = entry_path.file_stem() {
                        let title_str = filename.to_string_lossy().to_string();

                        // 検索クエリにマッチするか確認
                        if title_str.to_lowercase().contains(&query_lower) {
                            // 親フォルダ（レーベル）名を取得
                            let label = entry_path.parent()
                                .and_then(|p| p.file_name())
                                .map(|n| n.to_string_lossy().to_string())
                                .unwrap_or_default();

                            println!("マッチ: {} / {}", label, title_str);
                            results.push(SearchResult {
                                label,
                                title: title_str,
                                path: entry_path.to_string_lossy().to_string(),
                            });
                        }
                    }
                }
            }
        }
    }

    // タイトルでソート
    results.sort_by(|a, b| a.title.cmp(&b.title));
    println!("検索完了: エントリ数={}, 結果数={}", entry_count, results.len());
    Ok(results)
}

/// JSONフォルダ内のJSONファイル一覧を取得（後方互換性のため維持）
#[tauri::command]
async fn list_json_files(folder_path: String) -> Result<Vec<String>, String> {
    let path = PathBuf::from(&folder_path);
    if !path.exists() {
        return Err(format!("フォルダが存在しません: {}", folder_path));
    }

    let mut files: Vec<String> = Vec::new();

    for entry in walkdir::WalkDir::new(&path)
        .max_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let entry_path = entry.path();
        if entry_path.is_file() {
            if let Some(ext) = entry_path.extension() {
                if ext.to_string_lossy().to_lowercase() == "json" {
                    if let Some(filename) = entry_path.file_name() {
                        files.push(filename.to_string_lossy().to_string());
                    }
                }
            }
        }
    }

    files.sort();
    Ok(files)
}

/// フォルダを開く（Windowsエクスプローラー）
#[tauri::command]
async fn open_folder(path: String) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("フォルダを開けませんでした: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("フォルダを開けませんでした: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("フォルダを開けませんでした: {}", e))?;
    }
    Ok(())
}

/// JSONファイルを保存
#[tauri::command]
async fn save_json_file(path: String, content: String) -> Result<(), String> {
    use std::fs;
    use std::io::Write;

    let file_path = PathBuf::from(&path);

    // 親フォルダが存在しない場合は作成
    if let Some(parent) = file_path.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent)
                .map_err(|e| format!("フォルダの作成に失敗: {}", e))?;
        }
    }

    // UTF-8 BOMなしで保存
    let mut file = fs::File::create(&file_path)
        .map_err(|e| format!("ファイルの作成に失敗: {}", e))?;

    file.write_all(content.as_bytes())
        .map_err(|e| format!("ファイルの書き込みに失敗: {}", e))?;

    println!("JSONファイル保存完了: {}", path);
    Ok(())
}

/// JSONファイルを読み込み
#[tauri::command]
async fn read_json_file(path: String) -> Result<String, String> {
    use std::fs;

    let file_path = PathBuf::from(&path);

    if !file_path.exists() {
        return Err(format!("ファイルが存在しません: {}", path));
    }

    fs::read_to_string(&file_path)
        .map_err(|e| format!("ファイルの読み込みに失敗: {}", e))
}

/// フォルダが存在しない場合は作成
#[tauri::command]
async fn ensure_folder_exists(path: String) -> Result<(), String> {
    use std::fs;

    let folder_path = PathBuf::from(&path);

    if !folder_path.exists() {
        fs::create_dir_all(&folder_path)
            .map_err(|e| format!("フォルダの作成に失敗: {}", e))?;
        println!("フォルダ作成: {}", path);
    }

    Ok(())
}

/// ファイルが存在するか確認
#[tauri::command]
async fn file_exists(path: String) -> Result<bool, String> {
    let file_path = PathBuf::from(&path);
    Ok(file_path.exists())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // 並列処理のスレッドプールを初期化（CPUコア数の2倍）
    init_thread_pool();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_image_files,
            get_image_preview,
            get_image_preview_as_file,
            process_images,
            cancel_processing,
            generate_pdf,
            get_default_output_folder,
            open_folder,
            delete_folder,
            clear_psd_cache,
            list_json_files,
            list_folder_contents,
            search_json_folders,
            save_json_file,
            read_json_file,
            ensure_folder_exists,
            file_exists,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
