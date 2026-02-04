use base64::{engine::general_purpose::STANDARD, Engine};
use ::image::{DynamicImage, GenericImageView, ImageBuffer, ImageFormat, Rgba, RgbaImage};
use ::image::imageops::FilterType;
use printpdf::{Mm, Px, PdfDocument, Image, ImageXObject, ImageTransform, ImageFilter, ColorSpace, ColorBits};
use serde::{Deserialize, Serialize};
use std::fs::File;
use std::io::{BufWriter, BufReader, Cursor, Read as IoRead, Seek, SeekFrom, Write};
use std::path::Path;
use std::sync::{OnceLock, Mutex};
use std::collections::HashMap;
use tauri::Emitter;
use ab_glyph::{Font, FontRef, PxScale, ScaleFont};
use imageproc::drawing::{draw_text_mut, draw_filled_rect_mut};
use imageproc::rect::Rect;
use mozjpeg::{Compress, ColorSpace as MozColorSpace};

/// MozJPEGでRGB画像をエンコード（高効率圧縮）
fn encode_jpeg_mozjpeg(rgb_data: &[u8], width: u32, height: u32, quality: f32) -> Option<Vec<u8>> {
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
fn write_jpeg_mozjpeg_to_file<P: AsRef<Path>>(rgb_data: &[u8], width: u32, height: u32, quality: f32, path: P) -> Result<(), String> {
    let jpeg_data = encode_jpeg_mozjpeg(rgb_data, width, height, quality)
        .ok_or("MozJPEGエンコードに失敗")?;

    let mut file = File::create(path).map_err(|e| format!("ファイル作成に失敗: {}", e))?;
    file.write_all(&jpeg_data).map_err(|e| format!("ファイル書き込みに失敗: {}", e))?;
    Ok(())
}

/// フォントデータのキャッシュ（一度だけ読み込み）
static FONT_CACHE: OnceLock<Option<Vec<u8>>> = OnceLock::new();

/// 日本語フォントデータのキャッシュ（作品情報印字用）
static JP_FONT_CACHE: OnceLock<Option<Vec<u8>>> = OnceLock::new();

/// キャッシュされたフォントデータを取得
fn get_cached_font_data() -> Option<&'static Vec<u8>> {
    FONT_CACHE.get_or_init(|| {
        get_system_font_path().and_then(|path| std::fs::read(&path).ok())
    }).as_ref()
}

/// キャッシュされた日本語フォントデータを取得
fn get_cached_jp_font_data() -> Option<&'static Vec<u8>> {
    JP_FONT_CACHE.get_or_init(|| {
        get_jp_font_path().and_then(|path| std::fs::read(&path).ok())
    }).as_ref()
}

/// 日本語フォントのパスを取得（Windows用）
fn get_jp_font_path() -> Option<std::path::PathBuf> {
    let font_paths = [
        "C:\\Windows\\Fonts\\YuGothB.ttc",   // Yu Gothic Bold
        "C:\\Windows\\Fonts\\YuGothM.ttc",   // Yu Gothic Medium
        "C:\\Windows\\Fonts\\yugothib.ttf",  // Yu Gothic UI Bold
        "C:\\Windows\\Fonts\\meiryob.ttc",   // Meiryo Bold
        "C:\\Windows\\Fonts\\meiryo.ttc",    // Meiryo
        "C:\\Windows\\Fonts\\msgothic.ttc",  // MS Gothic
    ];

    for path in &font_paths {
        let p = std::path::PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// PSD画像キャッシュ（プレビュー用）
/// キー: ファイルパス、値: (画像データ, 幅, 高さ)
static PSD_CACHE: OnceLock<Mutex<HashMap<String, (Vec<u8>, u32, u32)>>> = OnceLock::new();

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
fn get_or_cache_psd(path: &Path) -> Result<DynamicImage, String> {
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
        // メモリ制限: 10ファイルまで
        if cache.len() >= 10 {
            cache.clear();
        }
        cache.insert(path_str, (rgba.as_raw().clone(), width, height));
    }

    Ok(img)
}

/// PSDファイルのImage Dataセクションを直接読み込む（高速版）
/// Photoshopの「互換性を最大に」で保存されたPSDには、
/// 合成済みのフラット化画像が含まれている。これを直接読むことで
/// レイヤー合成をスキップし、10倍以上高速化できる。
fn load_psd_composite(path: &Path) -> Result<DynamicImage, String> {
    let file = File::open(path).map_err(|e| format!("ファイルを開けません: {}", e))?;
    // 64KBバッファでファイルI/Oを高速化
    let mut file = BufReader::with_capacity(64 * 1024, file);
    let mut buf4 = [0u8; 4];
    let mut buf2 = [0u8; 2];

    // === Header (26 bytes) ===
    // Signature: "8BPS"
    file.read_exact(&mut buf4).map_err(|e| format!("PSD読み込みエラー: {}", e))?;
    if &buf4 != b"8BPS" {
        return Err("無効なPSDファイル".to_string());
    }

    // Version (2 bytes)
    file.read_exact(&mut buf2).map_err(|e| format!("PSD読み込みエラー: {}", e))?;
    let version = u16::from_be_bytes(buf2);
    if version != 1 && version != 2 {
        return Err("サポートされていないPSDバージョン".to_string());
    }

    // Reserved (6 bytes)
    file.seek(SeekFrom::Current(6)).map_err(|e| format!("シークエラー: {}", e))?;

    // Channels (2 bytes)
    file.read_exact(&mut buf2).map_err(|e| format!("PSD読み込みエラー: {}", e))?;
    let channels = u16::from_be_bytes(buf2) as usize;

    // Height (4 bytes)
    file.read_exact(&mut buf4).map_err(|e| format!("PSD読み込みエラー: {}", e))?;
    let height = u32::from_be_bytes(buf4);

    // Width (4 bytes)
    file.read_exact(&mut buf4).map_err(|e| format!("PSD読み込みエラー: {}", e))?;
    let width = u32::from_be_bytes(buf4);

    // Depth (2 bytes) - bits per channel
    file.read_exact(&mut buf2).map_err(|e| format!("PSD読み込みエラー: {}", e))?;
    let depth = u16::from_be_bytes(buf2);
    if depth != 8 {
        return Err(format!("サポートされていないビット深度: {}", depth));
    }

    // Color Mode (2 bytes)
    file.read_exact(&mut buf2).map_err(|e| format!("PSD読み込みエラー: {}", e))?;
    let color_mode = u16::from_be_bytes(buf2);
    // 3 = RGB, 1 = Grayscale, 4 = CMYK
    if color_mode != 3 && color_mode != 1 {
        return Err(format!("サポートされていないカラーモード: {} (RGB/Grayscaleのみ対応)", color_mode));
    }

    // === Color Mode Data Section ===
    file.read_exact(&mut buf4).map_err(|e| format!("PSD読み込みエラー: {}", e))?;
    let color_mode_len = u32::from_be_bytes(buf4);
    file.seek(SeekFrom::Current(color_mode_len as i64)).map_err(|e| format!("シークエラー: {}", e))?;

    // === Image Resources Section ===
    file.read_exact(&mut buf4).map_err(|e| format!("PSD読み込みエラー: {}", e))?;
    let resources_len = u32::from_be_bytes(buf4);
    file.seek(SeekFrom::Current(resources_len as i64)).map_err(|e| format!("シークエラー: {}", e))?;

    // === Layer and Mask Information Section ===
    // PSB (version 2) の場合は8バイト
    if version == 2 {
        let mut buf8 = [0u8; 8];
        file.read_exact(&mut buf8).map_err(|e| format!("PSD読み込みエラー: {}", e))?;
        let layer_len = u64::from_be_bytes(buf8);
        file.seek(SeekFrom::Current(layer_len as i64)).map_err(|e| format!("シークエラー: {}", e))?;
    } else {
        file.read_exact(&mut buf4).map_err(|e| format!("PSD読み込みエラー: {}", e))?;
        let layer_len = u32::from_be_bytes(buf4);
        file.seek(SeekFrom::Current(layer_len as i64)).map_err(|e| format!("シークエラー: {}", e))?;
    }

    // === Image Data Section ===
    // Compression method (2 bytes)
    file.read_exact(&mut buf2).map_err(|e| format!("PSD読み込みエラー: {}", e))?;
    let compression = u16::from_be_bytes(buf2);

    let pixels = (width as usize) * (height as usize);
    let num_channels = channels.min(4); // RGB/RGBAのみ

    match compression {
        0 => {
            // Raw (非圧縮)
            let mut channel_data = vec![vec![0u8; pixels]; num_channels];
            for ch in 0..num_channels {
                file.read_exact(&mut channel_data[ch]).map_err(|e| format!("画像データ読み込みエラー: {}", e))?;
            }
            channels_to_rgba(channel_data, width, height, color_mode)
        }
        1 => {
            // RLE圧縮
            decode_rle_image(&mut file, width, height, num_channels, color_mode, version)
        }
        _ => {
            Err(format!("サポートされていない圧縮方式: {}", compression))
        }
    }
}

/// RLE圧縮された画像データをデコード
fn decode_rle_image<R: IoRead>(
    file: &mut R,
    width: u32,
    height: u32,
    num_channels: usize,
    color_mode: u16,
    version: u16,
) -> Result<DynamicImage, String> {
    let rows = height as usize;
    let pixels = (width as usize) * rows;

    // 各チャンネルの各行のバイト数を読み取る
    let total_rows = rows * num_channels;
    let mut row_lengths = vec![0u16; total_rows];

    if version == 2 {
        // PSBは4バイト
        let mut buf4 = [0u8; 4];
        for i in 0..total_rows {
            file.read_exact(&mut buf4).map_err(|e| format!("行長読み込みエラー: {}", e))?;
            row_lengths[i] = u32::from_be_bytes(buf4) as u16;
        }
    } else {
        let mut buf2 = [0u8; 2];
        for i in 0..total_rows {
            file.read_exact(&mut buf2).map_err(|e| format!("行長読み込みエラー: {}", e))?;
            row_lengths[i] = u16::from_be_bytes(buf2);
        }
    }

    // 各チャンネルをデコード
    let mut channel_data = vec![vec![0u8; pixels]; num_channels];

    for ch in 0..num_channels {
        for row in 0..rows {
            let row_idx = ch * rows + row;
            let row_len = row_lengths[row_idx] as usize;

            let mut compressed = vec![0u8; row_len];
            file.read_exact(&mut compressed).map_err(|e| format!("RLEデータ読み込みエラー: {}", e))?;

            // PackBits RLE デコード
            let row_start = row * width as usize;
            let row_data = &mut channel_data[ch][row_start..row_start + width as usize];
            decode_packbits(&compressed, row_data);
        }
    }

    channels_to_rgba(channel_data, width, height, color_mode)
}

/// PackBits RLEデコード
fn decode_packbits(input: &[u8], output: &mut [u8]) {
    let mut i = 0;
    let mut o = 0;

    while i < input.len() && o < output.len() {
        let n = input[i] as i8;
        i += 1;

        if n >= 0 {
            // リテラル: n+1バイトをコピー
            let count = (n as usize) + 1;
            let end = (o + count).min(output.len());
            let src_end = (i + count).min(input.len());
            let copy_len = (end - o).min(src_end - i);
            output[o..o + copy_len].copy_from_slice(&input[i..i + copy_len]);
            i += count;
            o += count;
        } else if n > -128 {
            // 繰り返し: 次の1バイトを(-n+1)回繰り返す
            let count = (-n as usize) + 1;
            if i < input.len() {
                let val = input[i];
                i += 1;
                let end = (o + count).min(output.len());
                for j in o..end {
                    output[j] = val;
                }
                o += count;
            }
        }
        // n == -128 は no-op
    }
}

/// チャンネルデータをRGBA画像に変換
fn channels_to_rgba(channel_data: Vec<Vec<u8>>, width: u32, height: u32, color_mode: u16) -> Result<DynamicImage, String> {
    let pixels = (width as usize) * (height as usize);
    let mut rgba = vec![255u8; pixels * 4];

    match color_mode {
        3 => {
            // RGB
            for i in 0..pixels {
                rgba[i * 4] = channel_data.get(0).map(|c| c[i]).unwrap_or(0);     // R
                rgba[i * 4 + 1] = channel_data.get(1).map(|c| c[i]).unwrap_or(0); // G
                rgba[i * 4 + 2] = channel_data.get(2).map(|c| c[i]).unwrap_or(0); // B
                rgba[i * 4 + 3] = channel_data.get(3).map(|c| c[i]).unwrap_or(255); // A
            }
        }
        1 => {
            // Grayscale
            for i in 0..pixels {
                let gray = channel_data.get(0).map(|c| c[i]).unwrap_or(0);
                rgba[i * 4] = gray;     // R
                rgba[i * 4 + 1] = gray; // G
                rgba[i * 4 + 2] = gray; // B
                rgba[i * 4 + 3] = channel_data.get(1).map(|c| c[i]).unwrap_or(255); // A
            }
        }
        _ => {}
    }

    let img: RgbaImage = ImageBuffer::from_raw(width, height, rgba)
        .ok_or_else(|| format!("RGBA画像の作成に失敗しました ({}x{})", width, height))?;
    Ok(DynamicImage::ImageRgba8(img))
}

/// PSDファイルを高速読み込み
/// まずフラット化画像を試し、失敗したらレイヤー合成にフォールバック
fn load_psd_fast(path: &Path) -> Result<DynamicImage, String> {
    // まずフラット化画像の直接読み込みを試す
    match load_psd_composite(path) {
        Ok(img) => Ok(img),
        Err(_) => {
            // フォールバック: psd crateでレイヤー合成（遅いが確実）
            load_psd_with_layers(path)
        }
    }
}

/// 画像情報
#[derive(Debug, Serialize, Deserialize)]
pub struct ImageInfo {
    pub width: u32,
    pub height: u32,
    pub base64: String,
}

/// プレビューファイル情報（ファイルシステム経由転送用）
#[derive(Debug, Serialize, Deserialize)]
pub struct PreviewFileInfo {
    pub width: u32,
    pub height: u32,
    pub file_path: String,
}

/// 処理オプション
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ProcessOptions {
    pub crop_left: u32,
    pub crop_top: u32,
    pub crop_right: u32,
    pub crop_bottom: u32,
    pub tachikiri_type: String, // "none", "crop_only", "crop_and_stroke", "stroke_only", "fill_white", "fill_and_stroke"
    pub stroke_color: String,   // "black", "white", "cyan"
    pub fill_color: String,     // "white", "black", "cyan"
    pub fill_opacity: u8,       // 0-100
    // 基準ドキュメントサイズ（スケーリング用）
    #[serde(default)]
    pub reference_width: u32,
    #[serde(default)]
    pub reference_height: u32,
    // ノンブル設定
    #[serde(default)]
    pub add_nombre: bool,
    #[serde(default = "default_nombre_start")]
    pub nombre_start_number: u32,
    #[serde(default = "default_nombre_size")]
    pub nombre_size: String, // "small", "medium", "large", "xlarge"
    // リサイズ設定
    #[serde(default = "default_resize_mode")]
    pub resize_mode: String, // "none", "percent", "fixed"
    #[serde(default = "default_resize_percent")]
    pub resize_percent: u32,
}

fn default_nombre_start() -> u32 { 1 }
fn default_nombre_size() -> String { "medium".to_string() }
fn default_resize_mode() -> String { "none".to_string() }
fn default_resize_percent() -> u32 { 50 }

// リサイズターゲットサイズ（元のTachimiと同じ）
const TARGET_RESIZE_WIDTH: u32 = 2250;
const TARGET_RESIZE_HEIGHT: u32 = 3000;

/// 処理結果
#[derive(Debug, Serialize, Deserialize)]
pub struct ProcessResult {
    pub processed: usize,
    pub total: usize,
    pub errors: Vec<String>,
    pub output_folder: String,
}

/// 作品情報（白紙ページに印字）
#[derive(Debug, Serialize, Deserialize, Clone, Default)]
pub struct WorkInfo {
    #[serde(default)]
    pub label: String,        // レーベル名
    #[serde(default)]
    pub author_type: u8,      // 0=著のみ, 1=作画/原作分離, 2=そのまま
    #[serde(default)]
    pub author1: String,      // 著者1（作画）
    #[serde(default)]
    pub author2: String,      // 著者2（原作）
    #[serde(default)]
    pub title: String,        // タイトル
    #[serde(default)]
    pub subtitle: String,     // サブタイトル
    #[serde(default)]
    pub version: String,      // 巻数
}

/// PDFオプション
#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PdfOptions {
    pub preset: String,       // "b4_single", "b4_spread", "a4_single", "a4_spread", "custom"
    pub width_mm: f32,
    pub height_mm: f32,
    pub gutter: u32,
    pub padding: u32,
    pub is_spread: bool,
    #[serde(default)]
    pub add_white_page: bool, // 先頭に白紙ページを追加するか
    #[serde(default)]
    pub print_work_info: bool, // 白紙ページに作品情報を印字するか
    #[serde(default)]
    pub work_info: Option<WorkInfo>, // 作品情報
    #[serde(default)]
    pub add_nombre: bool, // PDF余白にノンブルを追加するか
    #[serde(default = "default_nombre_size")]
    pub nombre_size: String, // ノンブルサイズ
}

/// 色文字列からRGBA値を取得
fn color_to_rgba(color: &str, opacity: u8) -> Rgba<u8> {
    let alpha = (opacity as f32 * 2.55) as u8;
    match color {
        "white" => Rgba([255, 255, 255, alpha]),
        "black" => Rgba([0, 0, 0, alpha]),
        "cyan" => Rgba([0, 255, 255, alpha]),
        _ => Rgba([255, 255, 255, alpha]),
    }
}

/// 色文字列からRGB値を取得
fn color_to_rgb(color: &str) -> Rgba<u8> {
    match color {
        "white" => Rgba([255, 255, 255, 255]),
        "black" => Rgba([0, 0, 0, 255]),
        "cyan" => Rgba([0, 255, 255, 255]),
        _ => Rgba([0, 0, 0, 255]),
    }
}

/// ノンブルサイズを取得（ピクセル単位）
/// 高解像度漫画原稿向け（背景ボックス方式用に調整）
fn get_nombre_font_size(size_key: &str) -> f32 {
    match size_key {
        "small" => 160.0,
        "medium" => 240.0,
        "large" => 320.0,
        "xlarge" => 400.0,
        _ => 240.0,
    }
}

/// システムフォントのパスを取得（Windows用）
fn get_system_font_path() -> Option<std::path::PathBuf> {
    // Windowsのシステムフォントパスを試す
    let font_paths = [
        "C:\\Windows\\Fonts\\arial.ttf",
        "C:\\Windows\\Fonts\\Arial.ttf",
        "C:\\Windows\\Fonts\\segoeui.ttf",
        "C:\\Windows\\Fonts\\calibri.ttf",
    ];

    for path in &font_paths {
        let p = std::path::PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }
    None
}

/// 画像にノンブル（ページ番号）を追加 - 背景ボックス方式
/// 控えめで品のある美しいデザイン
/// crop_bottom: 選択範囲の外（タチキリ領域）にノンブルを配置するための下マージン
fn add_nombre_to_image(img: &mut RgbaImage, page_num: u32, size_key: &str, crop_bottom: u32) {
    let font_size = get_nombre_font_size(size_key);
    let text = page_num.to_string();

    // キャッシュからフォントデータを取得
    let font_data = match get_cached_font_data() {
        Some(data) => data,
        None => return,
    };

    let font = match FontRef::try_from_slice(font_data) {
        Ok(f) => f,
        Err(_) => return,
    };

    let scale = PxScale::from(font_size);
    let scaled_font = font.as_scaled(scale);
    let (img_width, img_height) = (img.width(), img.height());

    // テキストの実際の幅を計算（カーニング含む）
    let mut text_width: f32 = 0.0;
    let mut prev_glyph: Option<ab_glyph::GlyphId> = None;
    for c in text.chars() {
        let glyph_id = scaled_font.glyph_id(c);
        if let Some(prev) = prev_glyph {
            text_width += scaled_font.kern(prev, glyph_id);
        }
        text_width += scaled_font.h_advance(glyph_id);
        prev_glyph = Some(glyph_id);
    }

    // パディング（余裕のある上品な余白）
    let padding_x = (font_size * 0.5) as i32;
    let padding_y = (font_size * 0.3) as i32;

    // ボックスサイズ（シンプルにフォントサイズベース）
    let box_width = text_width as i32 + padding_x * 2;
    let box_height = font_size as i32 + padding_y * 2;

    // 画像下端からのマージン
    let bottom_margin = (font_size * 0.4) as i32;

    // ボックスの位置（常に画像下端付近、タチキリ領域内に配置）
    let box_x = (img_width as i32 - box_width) / 2;
    let box_y = if crop_bottom > 0 && crop_bottom < img_height / 2 {
        // タチキリ領域がある場合：その領域の中央に配置
        let crop_area_top = img_height as i32 - crop_bottom as i32;
        let center_y = crop_area_top + (crop_bottom as i32 - box_height) / 2;
        // 画像内に収まるように調整
        center_y.max(crop_area_top + 5).min(img_height as i32 - box_height - 5)
    } else {
        // タチキリ領域がない、または異常に大きい場合：画像下端から少し上
        img_height as i32 - bottom_margin - box_height
    };

    // 背景ボックスを描画（控えめな半透明の白）
    let bg_color = Rgba([255, 255, 255, 210]);
    let rect = Rect::at(box_x, box_y).of_size(box_width as u32, box_height as u32);
    draw_filled_rect_mut(img, rect, bg_color);

    // テキスト位置（ボックス内の完全中央）
    // 水平中央
    let text_x = box_x + (box_width - text_width as i32) / 2;
    // 垂直中央（ボックス中央からフォントサイズの半分上に配置）
    let text_y = box_y + (box_height - font_size as i32) / 2;

    // 控えめなダークグレーで描画（品のある色）
    draw_text_mut(
        img,
        Rgba([60, 60, 60, 255]),
        text_x,
        text_y,
        scale,
        &font,
        &text,
    );
}

/// PSDファイルを読み込む（高速版を使用）
fn load_psd(path: &Path) -> Result<DynamicImage, String> {
    load_psd_fast(path)
}

/// PSDファイルをpsd crateで読み込む（レイヤー合成版、フォールバック用）
fn load_psd_with_layers(path: &Path) -> Result<DynamicImage, String> {
    let bytes = std::fs::read(path).map_err(|e| format!("ファイルを開けません: {}", e))?;
    let psd = psd::Psd::from_bytes(&bytes).map_err(|e| format!("PSDの読み込みに失敗: {:?}", e))?;

    let width = psd.width();
    let height = psd.height();
    let rgba = psd.rgba();

    let img: RgbaImage = ImageBuffer::from_raw(width, height, rgba)
        .ok_or("PSD画像の変換に失敗")?;

    Ok(DynamicImage::ImageRgba8(img))
}

/// PSDファイルからサムネイルを抽出（高速プレビュー用）
/// Image Resources Block ID 1036 (JPEG) または 1033 (RAW) からサムネイルを取得
fn extract_psd_thumbnail(path: &Path) -> Option<(DynamicImage, u32, u32)> {
    let mut file = File::open(path).ok()?;
    let mut buf4 = [0u8; 4];
    let mut buf2 = [0u8; 2];

    // PSD signature check: "8BPS"
    file.read_exact(&mut buf4).ok()?;
    if &buf4 != b"8BPS" {
        return None;
    }

    // Version (2 bytes) + Reserved (6 bytes) + Channels (2 bytes)
    file.seek(SeekFrom::Current(10)).ok()?;

    // Height (4 bytes)
    file.read_exact(&mut buf4).ok()?;
    let height = u32::from_be_bytes(buf4);

    // Width (4 bytes)
    file.read_exact(&mut buf4).ok()?;
    let width = u32::from_be_bytes(buf4);

    // Depth (2 bytes) + Color Mode (2 bytes)
    file.seek(SeekFrom::Current(4)).ok()?;

    // Color Mode Data Section
    file.read_exact(&mut buf4).ok()?;
    let color_mode_len = u32::from_be_bytes(buf4);
    file.seek(SeekFrom::Current(color_mode_len as i64)).ok()?;

    // Image Resources Section
    file.read_exact(&mut buf4).ok()?;
    let resources_len = u32::from_be_bytes(buf4);
    let resources_end = file.stream_position().ok()? + resources_len as u64;

    // Search for thumbnail resource (ID 1036 or 1033)
    while file.stream_position().ok()? < resources_end {
        // Signature "8BIM"
        file.read_exact(&mut buf4).ok()?;
        if &buf4 != b"8BIM" {
            break;
        }

        // Resource ID (2 bytes)
        file.read_exact(&mut buf2).ok()?;
        let resource_id = u16::from_be_bytes(buf2);

        // Pascal string (name) - first byte is length
        let mut name_len_buf = [0u8; 1];
        file.read_exact(&mut name_len_buf).ok()?;
        let name_len = name_len_buf[0] as u64;
        // Padded to even length
        let padded_name_len = if (name_len + 1) % 2 == 0 { name_len } else { name_len + 1 };
        file.seek(SeekFrom::Current(padded_name_len as i64)).ok()?;

        // Resource data size (4 bytes)
        file.read_exact(&mut buf4).ok()?;
        let data_size = u32::from_be_bytes(buf4);

        // Check if this is thumbnail resource
        if resource_id == 1036 || resource_id == 1033 {
            // Thumbnail resource structure:
            // 4 bytes: format (1 = JPEG, 0 = RAW)
            // 4 bytes: width
            // 4 bytes: height
            // 4 bytes: widthbytes (row bytes)
            // 4 bytes: total size
            // 4 bytes: compressed size
            // 2 bytes: bits per pixel
            // 2 bytes: planes
            // Then JPEG data follows

            file.read_exact(&mut buf4).ok()?;
            let format = u32::from_be_bytes(buf4);

            if format == 1 {
                // Skip thumbnail header (24 bytes remaining after format)
                file.seek(SeekFrom::Current(24)).ok()?;

                // Read JPEG data
                let jpeg_size = data_size - 28;
                let mut jpeg_data = vec![0u8; jpeg_size as usize];
                file.read_exact(&mut jpeg_data).ok()?;

                // Decode JPEG
                if let Ok(img) = ::image::load_from_memory_with_format(&jpeg_data, ImageFormat::Jpeg) {
                    return Some((img, width, height));
                }
            }
            return None;
        }

        // Skip to next resource (padded to even)
        let padded_size = if data_size % 2 == 0 { data_size } else { data_size + 1 };
        file.seek(SeekFrom::Current(padded_size as i64)).ok()?;
    }

    None
}

/// 画像ファイルを読み込む
fn load_image(path: &Path) -> Result<DynamicImage, String> {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    if ext == "psd" {
        load_psd(path)
    } else {
        ::image::open(path).map_err(|e| format!("画像の読み込みに失敗: {}", e))
    }
}

/// 画像のプレビューを取得（高速化版 + キャッシュ対応）
pub fn get_image_preview(file_path: &str, max_size: u32) -> Result<ImageInfo, String> {
    let path = Path::new(file_path);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    // PSDの場合、高速読み込み + キャッシュを使用
    // 断ち切り線の設定にはトンボ位置の確認が必要なため、
    // サムネイルではなくフル解像度画像をキャッシュして使う
    let (img, orig_width, orig_height) = if ext == "psd" {
        // キャッシュから取得またはフル読み込み（高速版）
        let img = get_or_cache_psd(path)?;
        let (w, h) = img.dimensions();
        (img, w, h)
    } else {
        let img = ::image::open(path).map_err(|e| format!("画像の読み込みに失敗: {}", e))?;
        let (w, h) = img.dimensions();
        (img, w, h)
    };

    // リサイズ（CatmullRomは細い線も保持しつつ高速）
    let (current_w, current_h) = img.dimensions();
    let resized = if current_w > max_size || current_h > max_size {
        img.resize(max_size, max_size, FilterType::CatmullRom)
    } else {
        img
    };

    // MozJPEGでエンコード（品質90、高効率圧縮）
    let rgb_img = resized.to_rgb8();
    let jpeg_data = encode_jpeg_mozjpeg(rgb_img.as_raw(), rgb_img.width(), rgb_img.height(), 100.0)
        .ok_or("MozJPEGエンコードに失敗")?;

    let base64_str = STANDARD.encode(&jpeg_data);

    Ok(ImageInfo {
        width: orig_width,
        height: orig_height,
        base64: format!("data:image/jpeg;base64,{}", base64_str),
    })
}

/// 画像のプレビューをファイルに保存（高速化版 + キャッシュ対応）
/// Base64エンコードを回避し、ファイルシステム経由で転送
pub fn get_image_preview_file(file_path: &str, max_size: u32, temp_dir: &str) -> Result<PreviewFileInfo, String> {
    let path = Path::new(file_path);
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();

    // PSDの場合、高速読み込み + キャッシュを使用
    let (img, orig_width, orig_height) = if ext == "psd" {
        let img = get_or_cache_psd(path)?;
        let (w, h) = img.dimensions();
        (img, w, h)
    } else {
        let img = ::image::open(path).map_err(|e| format!("画像の読み込みに失敗: {}", e))?;
        let (w, h) = img.dimensions();
        (img, w, h)
    };

    // リサイズ（Triangleフィルタで品質と速度のバランス）
    let (current_w, current_h) = img.dimensions();
    let resized = if current_w > max_size || current_h > max_size {
        img.resize(max_size, max_size, FilterType::Triangle)
    } else {
        img
    };

    // 一時ファイルのパスを生成
    let file_name = path.file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("preview");
    let temp_file_path = Path::new(temp_dir).join(format!("{}_preview.jpg", file_name));

    // MozJPEGでファイルに保存（品質80、プレビュー用）
    let rgb_img = resized.to_rgb8();
    write_jpeg_mozjpeg_to_file(rgb_img.as_raw(), rgb_img.width(), rgb_img.height(), 80.0, &temp_file_path)?;

    Ok(PreviewFileInfo {
        width: orig_width,
        height: orig_height,
        file_path: temp_file_path.to_string_lossy().to_string(),
    })
}

/// 単一画像を処理
pub fn process_single_image(
    input_path: &Path,
    output_path: &Path,
    options: &ProcessOptions,
    page_number: u32,
) -> Result<(), String> {
    let img = load_image(input_path)?;
    let (orig_width, orig_height) = img.dimensions();

    // タチキリタイプが "none" なら何もせずコピー（ノンブル・リサイズは追加する可能性あり）
    if options.tachikiri_type == "none" {
        let mut result = img.to_rgba8();

        // ノンブル追加（リサイズ前に追加→リサイズで一緒に縮小される）
        // "none"でも選択範囲外（タチキリ領域）にノンブルを配置
        if options.add_nombre {
            // スケーリング計算
            let scale_y = if options.reference_height > 0 {
                orig_height as f64 / options.reference_height as f64
            } else {
                1.0
            };
            let scaled_bottom = (options.crop_bottom as f64 * scale_y).round() as u32;
            let crop_bottom_y = scaled_bottom.min(orig_height);
            // タチキリ領域の高さ = 画像の高さ - 選択範囲の下端
            let nombre_margin = orig_height.saturating_sub(crop_bottom_y);
            add_nombre_to_image(&mut result, page_number, &options.nombre_size, nombre_margin);
        }

        // リサイズ処理
        let final_image = match options.resize_mode.as_str() {
            "percent" => {
                let scale = options.resize_percent as f32 / 100.0;
                let new_width = (result.width() as f32 * scale).round() as u32;
                let new_height = (result.height() as f32 * scale).round() as u32;
                DynamicImage::ImageRgba8(result).resize_exact(new_width, new_height, FilterType::CatmullRom)
            }
            "fixed" => {
                let (w, h) = (result.width(), result.height());
                let scale = (TARGET_RESIZE_WIDTH as f32 / w as f32)
                    .min(TARGET_RESIZE_HEIGHT as f32 / h as f32);
                let new_width = (w as f32 * scale).round() as u32;
                let new_height = (h as f32 * scale).round() as u32;
                DynamicImage::ImageRgba8(result).resize_exact(new_width, new_height, FilterType::CatmullRom)
            }
            _ => DynamicImage::ImageRgba8(result),
        };

        // MozJPEGで保存（高画質95%）
        let rgb_image = final_image.to_rgb8();
        write_jpeg_mozjpeg_to_file(rgb_image.as_raw(), rgb_image.width(), rgb_image.height(), 95.0, output_path)?;
        return Ok(());
    }

    // スケーリング計算（基準サイズが指定されている場合）
    let (scale_x, scale_y) = if options.reference_width > 0 && options.reference_height > 0 {
        (
            orig_width as f64 / options.reference_width as f64,
            orig_height as f64 / options.reference_height as f64,
        )
    } else {
        (1.0, 1.0)
    };

    // クロップ座標をスケーリング
    let scaled_left = (options.crop_left as f64 * scale_x).round() as u32;
    let scaled_top = (options.crop_top as f64 * scale_y).round() as u32;
    let scaled_right = (options.crop_right as f64 * scale_x).round() as u32;
    let scaled_bottom = (options.crop_bottom as f64 * scale_y).round() as u32;

    // クロップ座標の検証
    let crop_left = scaled_left.min(orig_width);
    let crop_top = scaled_top.min(orig_height);
    let crop_right = scaled_right.min(orig_width).max(crop_left);
    let crop_bottom = scaled_bottom.min(orig_height).max(crop_top);

    let crop_width = crop_right - crop_left;
    let crop_height = crop_bottom - crop_top;

    if crop_width == 0 || crop_height == 0 {
        return Err("クロップ範囲が無効です".to_string());
    }

    let mut result: RgbaImage;

    match options.tachikiri_type.as_str() {
        "crop" | "crop_only" => {
            // クロップのみ
            let cropped = img.crop_imm(crop_left, crop_top, crop_width, crop_height);
            result = cropped.to_rgba8();
        }
        "crop_and_stroke" => {
            // クロップ + 境界線
            let cropped = img.crop_imm(crop_left, crop_top, crop_width, crop_height);
            result = cropped.to_rgba8();
            draw_stroke(&mut result, &options.stroke_color);
        }
        "stroke_only" => {
            // 元画像に境界線のみ（クロップ範囲に線を描画）
            result = img.to_rgba8();
            draw_stroke_at_crop(&mut result, crop_left, crop_top, crop_right, crop_bottom, &options.stroke_color);
        }
        "fill_white" | "fill_and_stroke" => {
            // クロップ範囲外を塗る
            result = img.to_rgba8();
            fill_outside_crop(&mut result, crop_left, crop_top, crop_right, crop_bottom, &options.fill_color, options.fill_opacity);

            if options.tachikiri_type == "fill_and_stroke" {
                draw_stroke_at_crop(&mut result, crop_left, crop_top, crop_right, crop_bottom, &options.stroke_color);
            }
        }
        _ => {
            result = img.to_rgba8();
        }
    }

    // ノンブル追加（リサイズ前に追加→リサイズで一緒に縮小される）
    // 選択範囲の外（タチキリ領域内）に配置
    if options.add_nombre {
        // タチキリタイプに応じてノンブルの配置マージンを計算
        let nombre_margin = match options.tachikiri_type.as_str() {
            // クロップ系：画像がクロップされているのでタチキリ領域なし→下端に配置
            "crop" | "crop_only" | "crop_and_stroke" => 0,
            // 塗り・線系：元画像サイズを維持、下端のタチキリ領域に配置
            _ => orig_height.saturating_sub(crop_bottom),
        };
        add_nombre_to_image(&mut result, page_number, &options.nombre_size, nombre_margin);
    }

    // リサイズ処理
    let final_image = match options.resize_mode.as_str() {
        "percent" => {
            let scale = options.resize_percent as f32 / 100.0;
            let new_width = (result.width() as f32 * scale).round() as u32;
            let new_height = (result.height() as f32 * scale).round() as u32;
            DynamicImage::ImageRgba8(result).resize_exact(new_width, new_height, FilterType::CatmullRom)
        }
        "fixed" => {
            // アスペクト比を維持してリサイズ
            let (w, h) = (result.width(), result.height());
            let scale = (TARGET_RESIZE_WIDTH as f32 / w as f32)
                .min(TARGET_RESIZE_HEIGHT as f32 / h as f32);
            let new_width = (w as f32 * scale).round() as u32;
            let new_height = (h as f32 * scale).round() as u32;
            DynamicImage::ImageRgba8(result).resize_exact(new_width, new_height, FilterType::CatmullRom)
        }
        _ => DynamicImage::ImageRgba8(result),
    };

    // MozJPEGで保存（高画質95%）
    let rgb_image = final_image.to_rgb8();
    write_jpeg_mozjpeg_to_file(rgb_image.as_raw(), rgb_image.width(), rgb_image.height(), 95.0, output_path)?;

    Ok(())
}

/// 画像の境界に線を描画
fn draw_stroke(img: &mut RgbaImage, color: &str) {
    let (width, height) = img.dimensions();
    let stroke_color = color_to_rgb(color);

    // 上辺
    for x in 0..width {
        img.put_pixel(x, 0, stroke_color);
    }
    // 下辺
    for x in 0..width {
        img.put_pixel(x, height - 1, stroke_color);
    }
    // 左辺
    for y in 0..height {
        img.put_pixel(0, y, stroke_color);
    }
    // 右辺
    for y in 0..height {
        img.put_pixel(width - 1, y, stroke_color);
    }
}

/// 指定座標に線を描画
fn draw_stroke_at_crop(
    img: &mut RgbaImage,
    left: u32,
    top: u32,
    right: u32,
    bottom: u32,
    color: &str,
) {
    let stroke_color = color_to_rgb(color);

    // 上辺
    for x in left..right {
        if top < img.height() {
            img.put_pixel(x, top, stroke_color);
        }
    }
    // 下辺
    for x in left..right {
        if bottom > 0 && bottom - 1 < img.height() {
            img.put_pixel(x, bottom - 1, stroke_color);
        }
    }
    // 左辺
    for y in top..bottom {
        if left < img.width() {
            img.put_pixel(left, y, stroke_color);
        }
    }
    // 右辺
    for y in top..bottom {
        if right > 0 && right - 1 < img.width() {
            img.put_pixel(right - 1, y, stroke_color);
        }
    }
}

/// クロップ範囲外を塗りつぶす
/// 最適化版: 外側4領域のみ処理（全ピクセル走査を回避）
fn fill_outside_crop(
    img: &mut RgbaImage,
    left: u32,
    top: u32,
    right: u32,
    bottom: u32,
    color: &str,
    opacity: u8,
) {
    let (width, height) = img.dimensions();
    let fill_color = color_to_rgba(color, opacity);
    let raw: &mut [u8] = img.as_mut();
    let bytes_per_pixel = 4usize;
    let stride = width as usize * bytes_per_pixel;

    // アルファブレンドをインライン化
    let alpha = fill_color[3] as f32 / 255.0;
    let inv_alpha = 1.0 - alpha;

    // ピクセルをブレンドするクロージャ
    let blend_pixel = |base: &mut [u8]| {
        base[0] = (base[0] as f32 * inv_alpha + fill_color[0] as f32 * alpha) as u8;
        base[1] = (base[1] as f32 * inv_alpha + fill_color[1] as f32 * alpha) as u8;
        base[2] = (base[2] as f32 * inv_alpha + fill_color[2] as f32 * alpha) as u8;
        base[3] = 255;
    };

    // 上部領域: (0, 0) - (width, top)
    for y in 0..top as usize {
        let row_start = y * stride;
        for x in 0..width as usize {
            let pixel_start = row_start + x * bytes_per_pixel;
            blend_pixel(&mut raw[pixel_start..pixel_start + 4]);
        }
    }

    // 下部領域: (0, bottom) - (width, height)
    for y in bottom as usize..height as usize {
        let row_start = y * stride;
        for x in 0..width as usize {
            let pixel_start = row_start + x * bytes_per_pixel;
            blend_pixel(&mut raw[pixel_start..pixel_start + 4]);
        }
    }

    // 左部領域: (0, top) - (left, bottom)
    for y in top as usize..bottom as usize {
        let row_start = y * stride;
        for x in 0..left as usize {
            let pixel_start = row_start + x * bytes_per_pixel;
            blend_pixel(&mut raw[pixel_start..pixel_start + 4]);
        }
    }

    // 右部領域: (right, top) - (width, bottom)
    for y in top as usize..bottom as usize {
        let row_start = y * stride;
        for x in right as usize..width as usize {
            let pixel_start = row_start + x * bytes_per_pixel;
            blend_pixel(&mut raw[pixel_start..pixel_start + 4]);
        }
    }
}

/// アルファブレンド
fn blend_pixels(base: Rgba<u8>, overlay: Rgba<u8>) -> Rgba<u8> {
    let alpha = overlay[3] as f32 / 255.0;
    let inv_alpha = 1.0 - alpha;

    Rgba([
        (base[0] as f32 * inv_alpha + overlay[0] as f32 * alpha) as u8,
        (base[1] as f32 * inv_alpha + overlay[1] as f32 * alpha) as u8,
        (base[2] as f32 * inv_alpha + overlay[2] as f32 * alpha) as u8,
        255,
    ])
}

/// 白紙ページに作品情報を描画
fn draw_work_info_on_image(img: &mut RgbaImage, info: &WorkInfo) {
    let (width, height) = img.dimensions();

    // 日本語フォントを取得
    let font_data = match get_cached_jp_font_data() {
        Some(data) => data,
        None => return,
    };

    let font = match FontRef::try_from_slice(font_data) {
        Ok(f) => f,
        Err(_) => return,
    };

    // フォントサイズを計算（高さの1/30を基準にしてより繊細に）
    let base_size = height as f32 / 30.0;
    let title_size = base_size * 2.0;      // タイトルは大きく目立つ
    let subtitle_size = base_size * 1.0;   // サブタイトル
    let version_size = base_size * 1.2;    // 巻数
    let author_size = base_size * 0.85;    // 著者は控えめ
    let label_size = base_size * 0.7;      // レーベルは小さめ

    let black = Rgba([0u8, 0u8, 0u8, 255u8]);
    let gray = Rgba([80u8, 80u8, 80u8, 255u8]);  // レーベル・著者用のグレー

    // === レイアウト設計 ===
    // 上半分を使用し、黄金比（約0.382）の位置にタイトルを配置
    let page_center_y = height as f32 / 2.0;
    let golden_ratio = 0.35;  // 上から35%の位置がタイトル中心
    let title_center_y = height as f32 * golden_ratio;

    // --- タイトルブロック（中心要素）---
    let mut title_block: Vec<(String, f32, Rgba<u8>)> = Vec::new();

    if !info.title.is_empty() {
        title_block.push((info.title.clone(), title_size, black));
    }
    if !info.subtitle.is_empty() {
        title_block.push((info.subtitle.clone(), subtitle_size, black));
    }
    if !info.version.is_empty() {
        title_block.push((info.version.clone(), version_size, black));
    }

    // --- 上部ブロック（レーベル）---
    let mut top_block: Vec<(String, f32, Rgba<u8>)> = Vec::new();
    if !info.label.is_empty() {
        top_block.push((info.label.clone(), label_size, gray));
    }

    // --- 下部ブロック（著者）---
    let mut bottom_block: Vec<(String, f32, Rgba<u8>)> = Vec::new();
    let author_text = match info.author_type {
        0 => {
            if !info.author1.is_empty() {
                format!("著　{}", info.author1)
            } else {
                String::new()
            }
        }
        1 => {
            let mut parts = Vec::new();
            if !info.author1.is_empty() {
                parts.push(format!("作画　{}", info.author1));
            }
            if !info.author2.is_empty() {
                parts.push(format!("原作　{}", info.author2));
            }
            parts.join("　　")
        }
        _ => info.author1.clone(),
    };
    if !author_text.is_empty() {
        bottom_block.push((author_text, author_size, gray));
    }

    // === 描画 ===

    // タイトルブロックの総高さを計算
    let title_line_height = 1.6;
    let title_total_height: f32 = title_block.iter()
        .map(|(_, size, _)| size * title_line_height)
        .sum();

    // タイトルブロックを中心位置から描画
    let title_start_y = title_center_y - title_total_height / 2.0;
    let mut current_y = title_start_y;

    for (text, font_size, color) in &title_block {
        if !text.is_empty() {
            let scale = PxScale::from(*font_size);
            let scaled_font = font.as_scaled(scale);
            let text_width: f32 = text.chars()
                .map(|c| scaled_font.h_advance(scaled_font.glyph_id(c)))
                .sum();
            let x = ((width as f32 - text_width) / 2.0).max(0.0) as i32;
            draw_text_mut(img, *color, x, current_y as i32, scale, &font, text);
        }
        current_y += font_size * title_line_height;
    }

    // 上部ブロック（レーベル）- タイトルから適度な間隔を空けて上に
    if !top_block.is_empty() {
        let top_spacing = base_size * 3.0;  // タイトルとの間隔
        let top_line_height = 1.4;
        let top_total_height: f32 = top_block.iter()
            .map(|(_, size, _)| size * top_line_height)
            .sum();
        let mut top_y = title_start_y - top_spacing - top_total_height;

        for (text, font_size, color) in &top_block {
            if !text.is_empty() {
                let scale = PxScale::from(*font_size);
                let scaled_font = font.as_scaled(scale);
                let text_width: f32 = text.chars()
                    .map(|c| scaled_font.h_advance(scaled_font.glyph_id(c)))
                    .sum();
                let x = ((width as f32 - text_width) / 2.0).max(0.0) as i32;
                draw_text_mut(img, *color, x, top_y as i32, scale, &font, text);
            }
            top_y += font_size * top_line_height;
        }
    }

    // 下部ブロック（著者）- タイトルブロックの下、上半分の下端付近
    if !bottom_block.is_empty() {
        let bottom_margin = base_size * 2.5;  // 下からのマージン
        let bottom_line_height = 1.4;
        let bottom_total_height: f32 = bottom_block.iter()
            .map(|(_, size, _)| size * bottom_line_height)
            .sum();
        let mut bottom_y = page_center_y - bottom_margin - bottom_total_height;

        for (text, font_size, color) in &bottom_block {
            if !text.is_empty() {
                let scale = PxScale::from(*font_size);
                let scaled_font = font.as_scaled(scale);
                let text_width: f32 = text.chars()
                    .map(|c| scaled_font.h_advance(scaled_font.glyph_id(c)))
                    .sum();
                let x = ((width as f32 - text_width) / 2.0).max(0.0) as i32;
                draw_text_mut(img, *color, x, bottom_y as i32, scale, &font, text);
            }
            bottom_y += font_size * bottom_line_height;
        }
    }
}

/// 白紙ページのPDF用Imageを作成（作品情報印字対応）
fn create_white_page_image(width: u32, height: u32, work_info: Option<&WorkInfo>, print_work_info: bool) -> Option<Image> {
    // 真っ白なRGBA画像を作成
    let mut white_img: RgbaImage = ImageBuffer::from_fn(width, height, |_, _| {
        Rgba([255u8, 255u8, 255u8, 255u8])
    });

    // 作品情報を印字
    if print_work_info {
        if let Some(info) = work_info {
            draw_work_info_on_image(&mut white_img, info);
        }
    }

    // RGBに変換
    let rgb_img: ImageBuffer<image::Rgb<u8>, Vec<u8>> = ImageBuffer::from_fn(width, height, |x, y| {
        let p = white_img.get_pixel(x, y);
        image::Rgb([p[0], p[1], p[2]])
    });

    // MozJPEGでエンコード（高画質100%）
    let jpeg_data = encode_jpeg_mozjpeg(rgb_img.as_raw(), width, height, 100.0)?;

    Some(Image::from(ImageXObject {
        width: Px(width as usize),
        height: Px(height as usize),
        color_space: ColorSpace::Rgb,
        bits_per_component: ColorBits::Bit8,
        interpolate: true,
        image_data: jpeg_data,
        image_filter: Some(ImageFilter::DCT),
        clipping_bbox: None,
        smask: None,
    }))
}

/// 画像をMozJPEGエンコードしてPDF用ImageXObjectを作成（高効率圧縮）
fn create_pdf_image(img: &DynamicImage) -> Option<Image> {
    let rgb_img = img.to_rgb8();

    // MozJPEGでエンコード（高画質90%）
    let jpeg_data = encode_jpeg_mozjpeg(rgb_img.as_raw(), rgb_img.width(), rgb_img.height(), 100.0)?;

    Some(Image::from(ImageXObject {
        width: Px(img.width() as usize),
        height: Px(img.height() as usize),
        color_space: ColorSpace::Rgb,
        bits_per_component: ColorBits::Bit8,
        interpolate: true,
        image_data: jpeg_data,
        image_filter: Some(ImageFilter::DCT),
        clipping_bbox: None,
        smask: None,
    }))
}

/// JPEGファイルから直接PDF用Imageを作成（デコード不要で高速）
fn create_pdf_image_from_jpeg_file(path: &Path) -> Option<(Image, u32, u32)> {
    // JPEGファイルをそのまま読み込み
    let jpeg_data = std::fs::read(path).ok()?;

    // JPEGヘッダからサイズを取得（SOF0/SOF2マーカーを探す）
    let (width, height) = get_jpeg_dimensions(&jpeg_data)?;

    let image = Image::from(ImageXObject {
        width: Px(width as usize),
        height: Px(height as usize),
        color_space: ColorSpace::Rgb,
        bits_per_component: ColorBits::Bit8,
        interpolate: true,
        image_data: jpeg_data,
        image_filter: Some(ImageFilter::DCT),
        clipping_bbox: None,
        smask: None,
    });

    Some((image, width, height))
}

/// JPEGバイト列から画像サイズを取得（デコードせずにヘッダ解析）
fn get_jpeg_dimensions(data: &[u8]) -> Option<(u32, u32)> {
    let mut i = 0;

    // SOIマーカー確認
    if data.len() < 2 || data[0] != 0xFF || data[1] != 0xD8 {
        return None;
    }
    i += 2;

    while i + 4 < data.len() {
        if data[i] != 0xFF {
            i += 1;
            continue;
        }

        let marker = data[i + 1];

        // SOF0 (0xC0) または SOF2 (0xC2) - ベースラインまたはプログレッシブ
        if marker == 0xC0 || marker == 0xC2 {
            if i + 9 < data.len() {
                let height = ((data[i + 5] as u32) << 8) | (data[i + 6] as u32);
                let width = ((data[i + 7] as u32) << 8) | (data[i + 8] as u32);
                return Some((width, height));
            }
        }

        // EOI (End of Image) に達したら終了
        if marker == 0xD9 {
            break;
        }

        // その他のマーカー - セグメント長を読んでスキップ
        if marker >= 0xD0 && marker <= 0xD9 {
            // RST0-RST7, SOI, EOI はセグメント長なし
            i += 2;
        } else if i + 4 < data.len() {
            let segment_len = ((data[i + 2] as usize) << 8) | (data[i + 3] as usize);
            i += 2 + segment_len;
        } else {
            break;
        }
    }

    None
}

/// 2枚の画像を横に結合（見開き用、元Tachimiのcombinetwo PsdFilesと同等）
/// 最適化版: 行単位のバルクコピーで高速化
fn combine_images_horizontal(left: &DynamicImage, right: Option<&DynamicImage>, gutter_px: u32) -> DynamicImage {
    let left_rgba = left.to_rgba8();
    let (left_w, left_h) = left_rgba.dimensions();
    let left_raw = left_rgba.as_raw();

    // 右ページがない場合は白いページを作成（元スクリプトのprocessLeftoverFileAsRightPageと同等）
    let right_rgba = match right {
        Some(img) => img.to_rgba8(),
        None => ImageBuffer::from_pixel(left_w, left_h, Rgba([255, 255, 255, 255])),
    };
    let (right_w, right_h) = right_rgba.dimensions();
    let right_raw = right_rgba.as_raw();

    // 高さは大きい方に合わせる
    let max_h = left_h.max(right_h);

    // 結合画像のサイズ（左 + ノド + 右）
    let combined_w = left_w + gutter_px + right_w;

    // 白背景で初期化（vec!で直接バッファ作成）
    let mut combined_raw = vec![255u8; (combined_w * max_h * 4) as usize];

    let bytes_per_pixel = 4usize;
    let combined_stride = combined_w as usize * bytes_per_pixel;
    let left_stride = left_w as usize * bytes_per_pixel;
    let right_stride = right_w as usize * bytes_per_pixel;

    // 左ページを行単位でコピー（バルクコピー）
    for y in 0..left_h as usize {
        let src_start = y * left_stride;
        let dst_start = y * combined_stride;
        combined_raw[dst_start..dst_start + left_stride]
            .copy_from_slice(&left_raw[src_start..src_start + left_stride]);
    }

    // 右ページを行単位でコピー（バルクコピー）
    let right_offset = (left_w + gutter_px) as usize * bytes_per_pixel;
    for y in 0..right_h as usize {
        let src_start = y * right_stride;
        let dst_start = y * combined_stride + right_offset;
        combined_raw[dst_start..dst_start + right_stride]
            .copy_from_slice(&right_raw[src_start..src_start + right_stride]);
    }

    let combined: RgbaImage = ImageBuffer::from_raw(combined_w, max_h, combined_raw)
        .expect("Failed to create combined image");

    DynamicImage::ImageRgba8(combined)
}

/// 画像に余白を追加（元TachimiのaddPaddingToPsdと同等）
/// 最適化版: 行単位のバルクコピーで高速化
fn add_padding_to_image(img: &DynamicImage, padding_px: u32) -> DynamicImage {
    if padding_px == 0 {
        return img.clone();
    }

    let rgba = img.to_rgba8();
    let (w, h) = rgba.dimensions();
    let src_raw = rgba.as_raw();

    let new_w = w + padding_px * 2;
    let new_h = h + padding_px * 2;

    // 白背景で初期化（vec!で直接バッファ作成）
    let mut padded_raw = vec![255u8; (new_w * new_h * 4) as usize];

    let bytes_per_pixel = 4usize;
    let src_stride = w as usize * bytes_per_pixel;
    let dst_stride = new_w as usize * bytes_per_pixel;
    let padding_offset = padding_px as usize * bytes_per_pixel;

    // 元画像を中央に行単位でコピー（バルクコピー）
    for y in 0..h as usize {
        let src_start = y * src_stride;
        let dst_start = (y + padding_px as usize) * dst_stride + padding_offset;
        padded_raw[dst_start..dst_start + src_stride]
            .copy_from_slice(&src_raw[src_start..src_start + src_stride]);
    }

    let padded: RgbaImage = ImageBuffer::from_raw(new_w, new_h, padded_raw)
        .expect("Failed to create padded image");

    DynamicImage::ImageRgba8(padded)
}

/// 画像サイズからPDFページサイズを計算（mm単位、指定DPI基準）
fn calc_page_size_mm(width_px: u32, height_px: u32, dpi: f32) -> (f32, f32) {
    // 1インチ = 25.4mm
    let width_mm = (width_px as f32 / dpi) * 25.4;
    let height_mm = (height_px as f32 / dpi) * 25.4;
    (width_mm, height_mm)
}

/// PDF生成（Electron版pdf-libと同じアプローチ）
///
/// アプローチ：
/// - ページサイズ = 画像サイズ（ピクセルをmm換算）
/// - 画像を(0,0)に配置、スケール1.0
/// - 見開きの場合：画像サイズ×2 + ノド + 余白
///
/// これにより確実に画像がページ全体に表示される
pub fn generate_pdf(
    app_handle: &tauri::AppHandle,
    input_folder: &str,
    output_path: &str,
    files: &[String],
    options: &PdfOptions,
) -> Result<String, String> {
    let input_path = Path::new(input_folder);
    let total = files.len();

    if total == 0 {
        return Err("処理するファイルがありません".to_string());
    }

    // DPI設定（このDPIで画像ピクセルをmmに変換）
    let dpi = 350.0_f32;

    // 余白・ノドをmm単位に変換
    let px_to_mm = 25.4 / dpi;
    let padding_mm = options.padding as f32 * px_to_mm;
    let gutter_mm = options.gutter as f32 * px_to_mm;

    if options.is_spread {
        generate_spread_pdf_simple(
            app_handle, input_path, output_path, files, dpi, padding_mm, gutter_mm,
            options.add_white_page, options.print_work_info, options.work_info.as_ref(),
            options.add_nombre, &options.nombre_size
        )
    } else {
        generate_single_pdf_simple(
            app_handle, input_path, output_path, files, dpi,
            options.add_nombre, &options.nombre_size, padding_mm
        )
    }
}

/// 単ページPDF生成（画像サイズ = ページサイズ）
/// Electron版pdf-libと同じアプローチ：ページサイズを画像に合わせる
fn generate_single_pdf_simple(
    app_handle: &tauri::AppHandle,
    input_path: &Path,
    output_path: &str,
    files: &[String],
    dpi: f32,
    add_nombre: bool,
    nombre_size: &str,
    padding_mm: f32,
) -> Result<String, String> {
    use printpdf::BuiltinFont;

    let total = files.len();

    // 最初の画像でドキュメントを初期化
    let first_file = input_path.join(&files[0]);
    let (first_w, first_h) = get_image_dimensions(&first_file)?;

    // 画像ピクセルからmm単位のページサイズを計算
    let first_page_width_mm = first_w as f32 / dpi * 25.4;
    let first_page_height_mm = first_h as f32 / dpi * 25.4;

    // 余白を含めたページサイズ
    let first_page_width_with_padding = first_page_width_mm + padding_mm * 2.0;
    let first_page_height_with_padding = first_page_height_mm + padding_mm * 2.0;

    let (doc, page1, layer1) = PdfDocument::new(
        "タチミ出力",
        Mm(first_page_width_with_padding),
        Mm(first_page_height_with_padding),
        "Layer 1"
    );
    let mut current_layer = doc.get_page(page1).get_layer(layer1);

    // ノンブル用フォント（余白がありノンブル有効の場合のみ）
    let nombre_font = if add_nombre && padding_mm > 0.0 {
        doc.add_builtin_font(BuiltinFont::Helvetica).ok()
    } else {
        None
    };

    // ノンブルのフォントサイズ（mm単位）
    let nombre_font_size_pt = match nombre_size {
        "large" => 12.0,
        "medium" => 9.0,
        _ => 7.0, // small
    };

    for (i, filename) in files.iter().enumerate() {
        // 画像読み込み中の進捗
        let _ = app_handle.emit("progress", crate::ProgressPayload {
            current: i + 1,
            total,
            filename: filename.clone(),
            phase: format!("PDF生成: 画像読み込み中 ({}/{})", i + 1, total),
            in_progress: 0,
        });

        let file_path = input_path.join(filename);

        // JPEGファイルの場合は高速パス（デコード不要）
        let (pdf_image, img_w, img_h) = if is_jpeg_file(&file_path) {
            match create_pdf_image_from_jpeg_file(&file_path) {
                Some((img, w, h)) => (img, w, h),
                None => {
                    eprintln!("PDF生成: JPEGファイル読み込みエラー: {}", filename);
                    continue;
                }
            }
        } else {
            // その他の形式は従来通りデコード→エンコード
            let img = match load_image(&file_path) {
                Ok(img) => img,
                Err(e) => {
                    eprintln!("PDF生成: 画像読み込みエラー ({}): {}", filename, e);
                    continue;
                }
            };
            let (w, h) = img.dimensions();
            match create_pdf_image(&img) {
                Some(pdf_img) => (pdf_img, w, h),
                None => {
                    eprintln!("PDF生成: PDF画像変換エラー: {}", filename);
                    continue;
                }
            }
        };

        // ページ追加中の進捗
        let _ = app_handle.emit("progress", crate::ProgressPayload {
            current: i + 1,
            total,
            filename: filename.clone(),
            phase: format!("PDF生成: ページ追加中 ({}/{})", i + 1, total),
            in_progress: 0,
        });

        let page_width_mm = img_w as f32 / dpi * 25.4;
        let page_height_mm = img_h as f32 / dpi * 25.4;

        // 余白を含めたページサイズ
        let page_width_with_padding = page_width_mm + padding_mm * 2.0;
        let page_height_with_padding = page_height_mm + padding_mm * 2.0;

        // 2ページ目以降は新しいページを追加（サイズは各画像に合わせる）
        if i > 0 {
            let (page, layer) = doc.add_page(Mm(page_width_with_padding), Mm(page_height_with_padding), "Layer 1");
            current_layer = doc.get_page(page).get_layer(layer);
        }

        // 画像を余白分オフセットして配置
        // printpdfではY軸が下から上向きなので、translate_y=padding_mmで画像下端が余白の上に来る
        let transform = ImageTransform {
            translate_x: Some(Mm(padding_mm)),
            translate_y: Some(Mm(padding_mm)),
            scale_x: Some(1.0),
            scale_y: Some(1.0),
            dpi: Some(dpi),
            ..Default::default()
        };

        pdf_image.add_to_layer(current_layer.clone(), transform);

        // ノンブル描画（余白がありノンブル有効の場合）
        if let Some(ref font) = nombre_font {
            let page_num = (i + 1).to_string();
            // ページ中央、下余白の中央に配置
            let text_x = page_width_with_padding / 2.0 - (page_num.len() as f32 * nombre_font_size_pt * 0.3 / 2.0);
            let text_y = padding_mm / 2.0 - nombre_font_size_pt * 0.35 / 2.0;
            current_layer.use_text(&page_num, nombre_font_size_pt, Mm(text_x), Mm(text_y), font);
        }
    }

    // PDF保存中の進捗
    let _ = app_handle.emit("progress", crate::ProgressPayload {
        current: total,
        total,
        filename: "".to_string(),
        phase: "PDF生成: ファイル保存中...".to_string(),
        in_progress: 0,
    });

    let file = File::create(output_path)
        .map_err(|e| format!("PDFファイルの作成に失敗: {}", e))?;
    let mut writer = BufWriter::new(file);

    doc.save(&mut writer)
        .map_err(|e| format!("PDFの保存に失敗: {}", e))?;

    Ok(output_path.to_string())
}

/// ファイルがJPEGかどうか判定
fn is_jpeg_file(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_lowercase())
        .map(|e| e == "jpg" || e == "jpeg")
        .unwrap_or(false)
}

/// 画像のサイズを取得（JPEGの場合は高速パス）
fn get_image_dimensions(path: &Path) -> Result<(u32, u32), String> {
    if is_jpeg_file(path) {
        let data = std::fs::read(path)
            .map_err(|e| format!("ファイルを開けません: {}", e))?;
        get_jpeg_dimensions(&data)
            .ok_or_else(|| "JPEGサイズの取得に失敗".to_string())
    } else {
        let img = load_image(path)?;
        Ok(img.dimensions())
    }
}

/// 見開きPDF生成（Electron版と同じアプローチ）
/// ページサイズ = 右画像幅 + 左画像幅 + ノド + 余白×2
fn generate_spread_pdf_simple(
    app_handle: &tauri::AppHandle,
    input_path: &Path,
    output_path: &str,
    files: &[String],
    dpi: f32,
    padding_mm: f32,
    gutter_mm: f32,
    add_white_page: bool,
    print_work_info: bool,
    work_info: Option<&WorkInfo>,
    add_nombre: bool,
    nombre_size: &str,
) -> Result<String, String> {
    use printpdf::BuiltinFont;

    let total = files.len();

    // 最初の画像でサイズを取得（ドキュメント初期化用）
    let first_file = input_path.join(&files[0]);
    let (first_w, first_h) = get_image_dimensions(&first_file)?;

    let first_width_mm = first_w as f32 / dpi * 25.4;
    let first_height_mm = first_h as f32 / dpi * 25.4;

    // 初期ページサイズ（見開き: 画像×2 + ノド + 余白）
    let init_page_width = first_width_mm * 2.0 + gutter_mm + padding_mm * 2.0;
    let init_page_height = first_height_mm + padding_mm * 2.0;

    let (doc, page1, layer1) = PdfDocument::new(
        "タチミ出力（見開き）",
        Mm(init_page_width),
        Mm(init_page_height),
        "Layer 1"
    );
    let mut current_layer = doc.get_page(page1).get_layer(layer1);

    // ノンブル用フォント（余白がありノンブル有効の場合のみ）
    let nombre_font = if add_nombre && padding_mm > 0.0 {
        doc.add_builtin_font(BuiltinFont::Helvetica).ok()
    } else {
        None
    };

    // ノンブルのフォントサイズ（pt単位）
    let nombre_font_size_pt = match nombre_size {
        "large" => 12.0,
        "medium" => 9.0,
        _ => 7.0, // small
    };

    let mut is_first_page = true;

    // 白紙追加時は実効ページ数が1増える
    let effective_total = if add_white_page { total + 1 } else { total };
    let spread_total = (effective_total + 1) / 2;
    let mut spread_index = 0;

    // ファイルインデックス（白紙追加時は-1からスタート）
    let mut file_idx: i32 = if add_white_page { -1 } else { 0 };

    while (file_idx as usize) < total || (add_white_page && file_idx == -1) {
        spread_index += 1;
        let current_file_idx = file_idx.max(0) as usize;
        let filename = files.get(current_file_idx).cloned().unwrap_or_default();

        // 画像読み込み中の進捗
        let _ = app_handle.emit("progress", crate::ProgressPayload {
            current: (file_idx.max(0) + 1) as usize,
            total,
            filename: filename.clone(),
            phase: format!("見開きPDF: 画像読み込み中 ({}/{})", spread_index, spread_total),
            in_progress: 0,
        });

        // 右ページを取得（白紙の場合は先頭画像サイズの白紙を作成）
        let (pdf_right, right_w, right_h): (Image, u32, u32) = if file_idx == -1 {
            // 白紙ページ（先頭画像と同じサイズ、作品情報印字対応）
            match create_white_page_image(first_w, first_h, work_info, print_work_info) {
                Some(img) => (img, first_w, first_h),
                None => {
                    file_idx += 2;
                    continue;
                }
            }
        } else {
            let right_file = input_path.join(&files[file_idx as usize]);
            if is_jpeg_file(&right_file) {
                match create_pdf_image_from_jpeg_file(&right_file) {
                    Some((img, w, h)) => (img, w, h),
                    None => {
                        file_idx += 2;
                        continue;
                    }
                }
            } else {
                let right_img = match load_image(&right_file) {
                    Ok(img) => img,
                    Err(_) => {
                        file_idx += 2;
                        continue;
                    }
                };
                let (w, h) = right_img.dimensions();
                match create_pdf_image(&right_img) {
                    Some(pdf_img) => (pdf_img, w, h),
                    None => {
                        file_idx += 2;
                        continue;
                    }
                }
            }
        };

        let right_width_mm = right_w as f32 / dpi * 25.4;
        let right_height_mm = right_h as f32 / dpi * 25.4;

        // 左ページのファイルインデックス
        let left_file_idx = file_idx + 1;

        // 左ページ（存在すれば）
        let (pdf_left, left_width_mm, left_height_mm) = if left_file_idx >= 0 && (left_file_idx as usize) < total {
            let left_file = input_path.join(&files[left_file_idx as usize]);

            if is_jpeg_file(&left_file) {
                match create_pdf_image_from_jpeg_file(&left_file) {
                    Some((img, w, h)) => {
                        let lw = w as f32 / dpi * 25.4;
                        let lh = h as f32 / dpi * 25.4;
                        (Some(img), lw, lh)
                    }
                    None => (None, right_width_mm, right_height_mm)
                }
            } else {
                match load_image(&left_file) {
                    Ok(left_img) => {
                        let (w, h) = left_img.dimensions();
                        let lw = w as f32 / dpi * 25.4;
                        let lh = h as f32 / dpi * 25.4;
                        match create_pdf_image(&left_img) {
                            Some(pdf_img) => (Some(pdf_img), lw, lh),
                            None => (None, right_width_mm, right_height_mm)
                        }
                    }
                    Err(_) => (None, right_width_mm, right_height_mm)
                }
            }
        } else {
            // 奇数ページの場合は白紙（左側）
            (None, right_width_mm, right_height_mm)
        };

        // ページ追加中の進捗
        let _ = app_handle.emit("progress", crate::ProgressPayload {
            current: (file_idx.max(0) + 1) as usize,
            total,
            filename: filename.clone(),
            phase: format!("見開きPDF: ページ追加中 ({}/{})", spread_index, spread_total),
            in_progress: 0,
        });

        // 左ページがあるかのフラグ（ノンブル描画用）
        let has_left_page = pdf_left.is_some();

        // ページサイズ計算（右 + 左 + ノド + 余白×2）
        let page_width_mm = right_width_mm + left_width_mm + gutter_mm + padding_mm * 2.0;
        let page_height_mm = right_height_mm.max(left_height_mm) + padding_mm * 2.0;

        // 2ページ目以降は新しいページを追加
        if !is_first_page {
            let (page, layer) = doc.add_page(Mm(page_width_mm), Mm(page_height_mm), "Layer 1");
            current_layer = doc.get_page(page).get_layer(layer);
        }
        is_first_page = false;

        // 右ページを配置（右側: 左画像幅 + ノド + 余白の位置から）
        let right_x = padding_mm + left_width_mm + gutter_mm;
        let transform = ImageTransform {
            translate_x: Some(Mm(right_x)),
            translate_y: Some(Mm(padding_mm)),
            scale_x: Some(1.0),
            scale_y: Some(1.0),
            dpi: Some(dpi),
            ..Default::default()
        };
        pdf_right.add_to_layer(current_layer.clone(), transform);

        // 左ページを配置（左側: 余白位置から）
        if let Some(left_img) = pdf_left {
            let transform = ImageTransform {
                translate_x: Some(Mm(padding_mm)),
                translate_y: Some(Mm(padding_mm)),
                scale_x: Some(1.0),
                scale_y: Some(1.0),
                dpi: Some(dpi),
                ..Default::default()
            };
            left_img.add_to_layer(current_layer.clone(), transform);
        }

        // ノンブル描画（余白がありノンブル有効の場合）
        // 白紙ページにはノンブルを付けず、本文から1でカウント開始
        if let Some(ref font) = nombre_font {
            // テキストY位置（余白中央）
            let text_y = padding_mm / 2.0 - nombre_font_size_pt * 0.35 / 2.0;

            if file_idx == -1 {
                // 白紙見開き: 右ページ（白紙）にはノンブルなし、左ページ（本文1ページ目）にノンブル「1」
                if has_left_page {
                    let left_num_str = "1".to_string();
                    let left_text_x = padding_mm + left_width_mm / 2.0 - (left_num_str.len() as f32 * nombre_font_size_pt * 0.3 / 2.0);
                    current_layer.use_text(&left_num_str, nombre_font_size_pt, Mm(left_text_x), Mm(text_y), font);
                }
            } else {
                // 通常の見開き
                // file_idxはファイル配列のインデックスなので、ページ番号は file_idx + 1
                // 白紙追加時: file_idx=1 → 右=2ページ目, 左=3ページ目
                // 白紙なし:   file_idx=0 → 右=1ページ目, 左=2ページ目
                let right_page_num = file_idx as usize + 1;
                let left_page_num = right_page_num + 1;

                // 右ページのノンブル
                let right_num_str = right_page_num.to_string();
                let right_text_x = right_x + right_width_mm / 2.0 - (right_num_str.len() as f32 * nombre_font_size_pt * 0.3 / 2.0);
                current_layer.use_text(&right_num_str, nombre_font_size_pt, Mm(right_text_x), Mm(text_y), font);

                // 左ページのノンブル（左ページがある場合のみ）
                if has_left_page {
                    let left_num_str = left_page_num.to_string();
                    let left_text_x = padding_mm + left_width_mm / 2.0 - (left_num_str.len() as f32 * nombre_font_size_pt * 0.3 / 2.0);
                    current_layer.use_text(&left_num_str, nombre_font_size_pt, Mm(left_text_x), Mm(text_y), font);
                }
            }
        }

        file_idx += 2;
    }

    // PDF保存中の進捗
    let _ = app_handle.emit("progress", crate::ProgressPayload {
        current: total,
        total,
        filename: "".to_string(),
        phase: "見開きPDF: ファイル保存中...".to_string(),
        in_progress: 0,
    });

    let file = File::create(output_path)
        .map_err(|e| format!("PDFファイルの作成に失敗: {}", e))?;
    let mut writer = BufWriter::new(file);

    doc.save(&mut writer)
        .map_err(|e| format!("PDFの保存に失敗: {}", e))?;

    Ok(output_path.to_string())
}
