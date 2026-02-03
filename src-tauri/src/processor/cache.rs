//! タチミ - キャッシュモジュール
//! PSD画像とフォントのキャッシュ管理

use ::image::{DynamicImage, ImageBuffer};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

use super::image_loader::load_psd_fast;

/// フォントデータのキャッシュ（一度だけ読み込み）
static FONT_CACHE: OnceLock<Option<Vec<u8>>> = OnceLock::new();

/// 日本語フォントデータのキャッシュ（作品情報印字用）
static JP_FONT_CACHE: OnceLock<Option<Vec<u8>>> = OnceLock::new();

/// PSD画像キャッシュ（プレビュー用）
/// キー: ファイルパス、値: (画像データ, 幅, 高さ)
static PSD_CACHE: OnceLock<Mutex<HashMap<String, (Vec<u8>, u32, u32)>>> = OnceLock::new();

/// PSDキャッシュの最大エントリ数
const MAX_PSD_CACHE_ENTRIES: usize = 10;

/// キャッシュされたフォントデータを取得
pub fn get_cached_font_data() -> Option<&'static Vec<u8>> {
    FONT_CACHE.get_or_init(|| {
        get_system_font_path().and_then(|path| std::fs::read(&path).ok())
    }).as_ref()
}

/// キャッシュされた日本語フォントデータを取得
pub fn get_cached_jp_font_data() -> Option<&'static Vec<u8>> {
    JP_FONT_CACHE.get_or_init(|| {
        get_jp_font_path().and_then(|path| std::fs::read(&path).ok())
    }).as_ref()
}

/// システムフォントのパスを取得（数字用）
pub fn get_system_font_path() -> Option<PathBuf> {
    let font_paths = [
        "C:\\Windows\\Fonts\\arial.ttf",
        "C:\\Windows\\Fonts\\Arial.ttf",
        "C:\\Windows\\Fonts\\segoeui.ttf",
        "C:\\Windows\\Fonts\\calibri.ttf",
    ];

    for path in &font_paths {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// 日本語フォントのパスを取得（Windows用）
pub fn get_jp_font_path() -> Option<PathBuf> {
    let font_paths = [
        "C:\\Windows\\Fonts\\YuGothB.ttc",   // Yu Gothic Bold
        "C:\\Windows\\Fonts\\YuGothM.ttc",   // Yu Gothic Medium
        "C:\\Windows\\Fonts\\yugothib.ttf",  // Yu Gothic UI Bold
        "C:\\Windows\\Fonts\\meiryob.ttc",   // Meiryo Bold
        "C:\\Windows\\Fonts\\meiryo.ttc",    // Meiryo
        "C:\\Windows\\Fonts\\msgothic.ttc",  // MS Gothic
    ];

    for path in &font_paths {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// PSDキャッシュのハンドルを取得
fn get_psd_cache() -> &'static Mutex<HashMap<String, (Vec<u8>, u32, u32)>> {
    PSD_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

/// PSDキャッシュをクリア
pub fn clear_psd_cache() {
    if let Ok(mut cache) = get_psd_cache().lock() {
        cache.clear();
    }
}

/// PSDキャッシュから画像を取得、またはキャッシュに追加
pub fn get_or_cache_psd(path: &Path) -> Result<DynamicImage, String> {
    let path_str = path.to_string_lossy().to_string();

    // キャッシュをチェック
    if let Ok(cache) = get_psd_cache().lock() {
        if let Some((rgba_data, width, height)) = cache.get(&path_str) {
            if let Some(img) = ImageBuffer::from_raw(*width, *height, rgba_data.clone()) {
                return Ok(DynamicImage::ImageRgba8(img));
            }
        }
    }

    // キャッシュになければ読み込み
    let img = load_psd_fast(path)?;
    let rgba = img.to_rgba8();
    let (width, height) = rgba.dimensions();

    // キャッシュに追加
    if let Ok(mut cache) = get_psd_cache().lock() {
        // メモリ制限: エントリ数を制限
        if cache.len() >= MAX_PSD_CACHE_ENTRIES {
            cache.clear();
        }
        cache.insert(path_str, (rgba.as_raw().clone(), width, height));
    }

    Ok(img)
}
