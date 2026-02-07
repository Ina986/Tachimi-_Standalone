//! タチミ - 型定義モジュール
//! 処理オプションやデータ構造を定義

use ::image::Rgba;
use serde::{Deserialize, Serialize};

/// 画像情報（Base64転送用）
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
    /// タチキリ処理タイプ: "none", "crop_only", "crop_and_stroke", "stroke_only", "fill_white", "fill_and_stroke"
    pub tachikiri_type: String,
    /// 線の色: "black", "white", "cyan"
    pub stroke_color: String,
    /// 塗りの色: "white", "black", "cyan"
    pub fill_color: String,
    /// 塗りの不透明度: 0-100
    pub fill_opacity: u8,
    /// 基準ドキュメントサイズ（スケーリング用）
    #[serde(default)]
    pub reference_width: u32,
    #[serde(default)]
    pub reference_height: u32,
    /// ノンブル設定
    #[serde(default)]
    pub add_nombre: bool,
    #[serde(default = "default_nombre_start")]
    pub nombre_start_number: u32,
    #[serde(default = "default_nombre_size")]
    pub nombre_size: String, // "small", "medium", "large", "xlarge"
    /// リサイズ設定
    #[serde(default = "default_resize_mode")]
    pub resize_mode: String, // "none", "percent", "fixed"
    #[serde(default = "default_resize_percent")]
    pub resize_percent: u32,
}

pub fn default_nombre_start() -> u32 { 1 }
pub fn default_nombre_size() -> String { "medium".to_string() }
pub fn default_resize_mode() -> String { "none".to_string() }
pub fn default_resize_percent() -> u32 { 50 }

/// リサイズターゲットサイズ（元のTachimiと同じ）
pub const TARGET_RESIZE_WIDTH: u32 = 2250;
pub const TARGET_RESIZE_HEIGHT: u32 = 3000;

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
    /// プリセット: "b4_single", "b4_spread", "a4_single", "a4_spread", "custom"
    pub preset: String,
    pub width_mm: f32,
    pub height_mm: f32,
    pub gutter: u32,
    pub padding: u32,
    pub is_spread: bool,
    /// 先頭に白紙ページを追加するか
    #[serde(default)]
    pub add_white_page: bool,
    /// 白紙ページに作品情報を印字するか
    #[serde(default)]
    pub print_work_info: bool,
    /// 作品情報
    #[serde(default)]
    pub work_info: Option<WorkInfo>,
    /// PDF余白にノンブルを追加するか
    #[serde(default)]
    pub add_nombre: bool,
    /// ノンブルサイズ
    #[serde(default = "default_nombre_size")]
    pub nombre_size: String,
}

/// 色文字列からRGBA値を取得（塗り用、不透明度指定可）
pub fn color_to_rgba(color: &str, opacity: u8) -> Rgba<u8> {
    let alpha = (opacity as f32 * 2.55) as u8;
    match color {
        "white" => Rgba([255, 255, 255, alpha]),
        "black" => Rgba([0, 0, 0, alpha]),
        "cyan" => Rgba([0, 255, 255, alpha]),
        _ => Rgba([255, 255, 255, alpha]),
    }
}

/// 色文字列からRGB値を取得（線用、完全不透明）
pub fn color_to_rgb(color: &str) -> Rgba<u8> {
    match color {
        "white" => Rgba([255, 255, 255, 255]),
        "black" => Rgba([0, 0, 0, 255]),
        "cyan" => Rgba([0, 255, 255, 255]),
        _ => Rgba([0, 0, 0, 255]),
    }
}

/// ノンブルサイズを取得（ピクセル単位）
/// 高解像度漫画原稿向け（背景ボックス方式用に調整）
/// 余白なし時は断ち切り枠内に描画するため半分サイズ
pub fn get_nombre_font_size(size_key: &str) -> f32 {
    match size_key {
        "small" => 80.0,
        "medium" => 120.0,
        "large" => 160.0,
        "xlarge" => 200.0,
        _ => 120.0,
    }
}
