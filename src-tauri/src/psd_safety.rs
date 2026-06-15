//! PSD/PSB 入口ガード（手順書 03_ / 12_ §14 準拠）。
//! 細工された巨大寸法での過大アロケーション（width*height*ch）→クラッシュや
//! 巨大ファイルのメモリ枯渇を、パースの手前で防ぐ。値は寛大（正常原稿は通す）。

use std::path::Path;

const MAX_PSD_FILE_BYTES: u64 = 4 * 1024 * 1024 * 1024; // 4 GiB（PSB大判も通る寛大値）
const MAX_PSD_DIMENSION: u32 = 300_000; // PSB 仕様上限
const MAX_PSD_PIXELS: u64 = 1_500_000_000; // 総画素上限（メモリ枯渇防止）

/// 拡張子が psd/psb のときのみ、読み込み前にファイルサイズ上限を検査（非PSDは素通し）。
pub fn guard_psd_file_size(path: &Path) -> Result<(), String> {
    let is_psd = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| {
            let e = e.to_ascii_lowercase();
            e == "psd" || e == "psb"
        })
        .unwrap_or(false);
    if !is_psd {
        return Ok(());
    }
    let len = std::fs::metadata(path).map(|m| m.len()).unwrap_or(0);
    if len > MAX_PSD_FILE_BYTES {
        return Err("PSDファイルが大きすぎます".to_string());
    }
    Ok(())
}

/// 先頭26バイトを検査: 8BPS シグネチャ＋寸法/画素数サニティ。Psd::from_bytes の直前で呼ぶ。
pub fn validate_psd_header(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 26 {
        return Err("PSDヘッダが不完全です".to_string());
    }
    if &bytes[0..4] != b"8BPS" {
        return Err("8BPSシグネチャがありません".to_string());
    }
    let h = u32::from_be_bytes([bytes[14], bytes[15], bytes[16], bytes[17]]);
    let w = u32::from_be_bytes([bytes[18], bytes[19], bytes[20], bytes[21]]);
    validate_psd_dimensions(w, h)
}

/// 読み取り済みの幅/高さのサニティ検査。
pub fn validate_psd_dimensions(w: u32, h: u32) -> Result<(), String> {
    if w == 0 || h == 0 || w > MAX_PSD_DIMENSION || h > MAX_PSD_DIMENSION {
        return Err(format!("PSD寸法が不正です {}x{}", w, h));
    }
    if (w as u64) * (h as u64) > MAX_PSD_PIXELS {
        return Err("PSD画素数が過大です".to_string());
    }
    Ok(())
}
