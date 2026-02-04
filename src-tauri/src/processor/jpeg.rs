//! タチミ - JPEGユーティリティモジュール
//! JPEG エンコード/デコード関連の機能

use mozjpeg::{Compress, ColorSpace as MozColorSpace};
use std::fs::File;
use std::io::Write;
use std::path::Path;

/// デフォルトJPEG品質
pub const JPEG_QUALITY: f32 = 95.0;

/// MozJPEGでRGB画像をエンコード（高効率圧縮）
pub fn encode_jpeg_mozjpeg(rgb_data: &[u8], width: u32, height: u32, quality: f32) -> Option<Vec<u8>> {
    std::panic::catch_unwind(|| {
        let mut comp = Compress::new(MozColorSpace::JCS_RGB);
        comp.set_size(width as usize, height as usize);
        comp.set_quality(quality);

        // 圧縮開始（Vec<u8>に出力）
        let mut writer = comp.start_compress(Vec::new()).ok()?;

        // 全スキャンラインを書き込み
        writer.write_scanlines(rgb_data).ok()?;

        writer.finish().ok()
    }).ok().flatten()
}

/// MozJPEGでRGB画像をファイルに書き出し
pub fn write_jpeg_mozjpeg_to_file<P: AsRef<Path>>(
    rgb_data: &[u8],
    width: u32,
    height: u32,
    quality: f32,
    path: P
) -> Result<(), String> {
    let jpeg_data = encode_jpeg_mozjpeg(rgb_data, width, height, quality)
        .ok_or("MozJPEGエンコードに失敗")?;

    let mut file = File::create(path).map_err(|e| format!("ファイル作成に失敗: {}", e))?;
    file.write_all(&jpeg_data).map_err(|e| format!("ファイル書き込みに失敗: {}", e))?;
    Ok(())
}

/// ファイルがJPEGかどうか判定
pub fn is_jpeg_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .map(|e| e == "jpg" || e == "jpeg")
        .unwrap_or(false)
}

/// JPEGファイルのサイズを高速取得（デコード不要）
pub fn get_jpeg_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    // JPEGシグネチャチェック
    if data.len() < 2 || data[0] != 0xFF || data[1] != 0xD8 {
        return None;
    }

    let mut i = 2;
    while i + 4 < data.len() {
        // マーカー開始を探す
        if data[i] != 0xFF {
            i += 1;
            continue;
        }

        let marker = data[i + 1];

        // SOFマーカー（フレーム開始）をチェック
        // SOF0-SOF3, SOF5-SOF7, SOF9-SOF11, SOF13-SOF15
        if matches!(marker, 0xC0..=0xC3 | 0xC5..=0xC7 | 0xC9..=0xCB | 0xCD..=0xCF) {
            if i + 9 < data.len() {
                // SOFセグメント: FF Cn [length 2bytes] [precision 1byte] [height 2bytes] [width 2bytes]
                let height = ((data[i + 5] as u32) << 8) | (data[i + 6] as u32);
                let width = ((data[i + 7] as u32) << 8) | (data[i + 8] as u32);
                return Some((width, height));
            }
        }

        // SOI, EOI, RSTn はサイズフィールドがない
        if marker == 0xD8 || marker == 0xD9 || (0xD0..=0xD7).contains(&marker) {
            i += 2;
            continue;
        }

        // セグメント長を取得してスキップ
        if i + 3 < data.len() {
            let len = ((data[i + 2] as usize) << 8) | (data[i + 3] as usize);
            i += 2 + len;
        } else {
            break;
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_jpeg_file() {
        assert!(is_jpeg_file(Path::new("test.jpg")));
        assert!(is_jpeg_file(Path::new("test.jpeg")));
        assert!(is_jpeg_file(Path::new("test.JPG")));
        assert!(!is_jpeg_file(Path::new("test.png")));
        assert!(!is_jpeg_file(Path::new("test.psd")));
    }
}
