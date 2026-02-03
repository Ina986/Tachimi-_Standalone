//! タチミ - 画像処理モジュール
//! クロップ、タチキリ処理、ノンブル追加などの画像処理機能

use ::image::{DynamicImage, GenericImageView, Rgba, RgbaImage};
use ::image::imageops::FilterType;
use ab_glyph::{Font, FontRef, PxScale, ScaleFont};
use imageproc::drawing::{draw_text_mut, draw_filled_rect_mut};
use imageproc::rect::Rect;
use std::path::Path;

use super::types::{
    ProcessOptions, color_to_rgba, color_to_rgb, get_nombre_font_size,
    TARGET_RESIZE_WIDTH, TARGET_RESIZE_HEIGHT,
};
use super::cache::get_cached_font_data;
use super::image_loader::load_image;
use super::jpeg::{write_jpeg_mozjpeg_to_file, JPEG_QUALITY};

/// 単一画像を処理
pub fn process_single_image(
    input_path: &Path,
    output_path: &Path,
    options: &ProcessOptions,
    page_number: u32,
) -> Result<(), String> {
    let img = load_image(input_path)?;
    let (orig_width, orig_height) = img.dimensions();

    // タチキリタイプが "none" なら何もせずコピー
    if options.tachikiri_type == "none" {
        let mut result = img.to_rgba8();

        // ノンブル追加
        if options.add_nombre {
            let scale_y = if options.reference_height > 0 {
                orig_height as f64 / options.reference_height as f64
            } else {
                1.0
            };
            let scaled_bottom = (options.crop_bottom as f64 * scale_y).round() as u32;
            let crop_bottom_y = scaled_bottom.min(orig_height);
            let nombre_margin = orig_height.saturating_sub(crop_bottom_y);
            add_nombre_to_image(&mut result, page_number, &options.nombre_size, nombre_margin);
        }

        // リサイズ処理
        let final_image = apply_resize(DynamicImage::ImageRgba8(result), options);

        // MozJPEGで保存
        let rgb_image = final_image.to_rgb8();
        write_jpeg_mozjpeg_to_file(rgb_image.as_raw(), rgb_image.width(), rgb_image.height(), JPEG_QUALITY, output_path)?;
        return Ok(());
    }

    // スケーリング計算
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
            let cropped = img.crop_imm(crop_left, crop_top, crop_width, crop_height);
            result = cropped.to_rgba8();
        }
        "crop_and_stroke" => {
            let cropped = img.crop_imm(crop_left, crop_top, crop_width, crop_height);
            result = cropped.to_rgba8();
            draw_stroke(&mut result, &options.stroke_color);
        }
        "stroke_only" => {
            result = img.to_rgba8();
            draw_stroke_at_crop(&mut result, crop_left, crop_top, crop_right, crop_bottom, &options.stroke_color);
        }
        "fill_white" | "fill_and_stroke" => {
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

    // ノンブル追加
    if options.add_nombre {
        let nombre_margin = match options.tachikiri_type.as_str() {
            "crop" | "crop_only" | "crop_and_stroke" => 0,
            _ => orig_height.saturating_sub(crop_bottom),
        };
        add_nombre_to_image(&mut result, page_number, &options.nombre_size, nombre_margin);
    }

    // リサイズ処理
    let final_image = apply_resize(DynamicImage::ImageRgba8(result), options);

    // MozJPEGで保存
    let rgb_image = final_image.to_rgb8();
    write_jpeg_mozjpeg_to_file(rgb_image.as_raw(), rgb_image.width(), rgb_image.height(), JPEG_QUALITY, output_path)?;

    Ok(())
}

/// リサイズ処理を適用
fn apply_resize(img: DynamicImage, options: &ProcessOptions) -> DynamicImage {
    match options.resize_mode.as_str() {
        "percent" => {
            let scale = options.resize_percent as f32 / 100.0;
            let (w, h) = img.dimensions();
            let new_width = (w as f32 * scale).round() as u32;
            let new_height = (h as f32 * scale).round() as u32;
            img.resize_exact(new_width, new_height, FilterType::CatmullRom)
        }
        "fixed" => {
            let (w, h) = img.dimensions();
            let scale = (TARGET_RESIZE_WIDTH as f32 / w as f32)
                .min(TARGET_RESIZE_HEIGHT as f32 / h as f32);
            let new_width = (w as f32 * scale).round() as u32;
            let new_height = (h as f32 * scale).round() as u32;
            img.resize_exact(new_width, new_height, FilterType::CatmullRom)
        }
        _ => img,
    }
}

/// 画像の境界に線を描画
pub fn draw_stroke(img: &mut RgbaImage, color: &str) {
    let (width, height) = img.dimensions();
    let stroke_color = color_to_rgb(color);

    for x in 0..width {
        img.put_pixel(x, 0, stroke_color);
        img.put_pixel(x, height - 1, stroke_color);
    }
    for y in 0..height {
        img.put_pixel(0, y, stroke_color);
        img.put_pixel(width - 1, y, stroke_color);
    }
}

/// 指定座標に線を描画
pub fn draw_stroke_at_crop(
    img: &mut RgbaImage,
    left: u32,
    top: u32,
    right: u32,
    bottom: u32,
    color: &str,
) {
    let stroke_color = color_to_rgb(color);

    for x in left..right {
        if top < img.height() {
            img.put_pixel(x, top, stroke_color);
        }
        if bottom > 0 && bottom - 1 < img.height() {
            img.put_pixel(x, bottom - 1, stroke_color);
        }
    }
    for y in top..bottom {
        if left < img.width() {
            img.put_pixel(left, y, stroke_color);
        }
        if right > 0 && right - 1 < img.width() {
            img.put_pixel(right - 1, y, stroke_color);
        }
    }
}

/// クロップ範囲外を塗りつぶす
pub fn fill_outside_crop(
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

    let alpha = fill_color[3] as f32 / 255.0;
    let inv_alpha = 1.0 - alpha;

    let blend_pixel = |base: &mut [u8]| {
        base[0] = (base[0] as f32 * inv_alpha + fill_color[0] as f32 * alpha) as u8;
        base[1] = (base[1] as f32 * inv_alpha + fill_color[1] as f32 * alpha) as u8;
        base[2] = (base[2] as f32 * inv_alpha + fill_color[2] as f32 * alpha) as u8;
        base[3] = 255;
    };

    // 上部領域
    for y in 0..top as usize {
        let row_start = y * stride;
        for x in 0..width as usize {
            let pixel_start = row_start + x * bytes_per_pixel;
            blend_pixel(&mut raw[pixel_start..pixel_start + 4]);
        }
    }

    // 下部領域
    for y in bottom as usize..height as usize {
        let row_start = y * stride;
        for x in 0..width as usize {
            let pixel_start = row_start + x * bytes_per_pixel;
            blend_pixel(&mut raw[pixel_start..pixel_start + 4]);
        }
    }

    // 左部領域
    for y in top as usize..bottom as usize {
        let row_start = y * stride;
        for x in 0..left as usize {
            let pixel_start = row_start + x * bytes_per_pixel;
            blend_pixel(&mut raw[pixel_start..pixel_start + 4]);
        }
    }

    // 右部領域
    for y in top as usize..bottom as usize {
        let row_start = y * stride;
        for x in right as usize..width as usize {
            let pixel_start = row_start + x * bytes_per_pixel;
            blend_pixel(&mut raw[pixel_start..pixel_start + 4]);
        }
    }
}

/// アルファブレンド
pub fn blend_pixels(base: Rgba<u8>, overlay: Rgba<u8>) -> Rgba<u8> {
    let alpha = overlay[3] as f32 / 255.0;
    let inv_alpha = 1.0 - alpha;

    Rgba([
        (base[0] as f32 * inv_alpha + overlay[0] as f32 * alpha) as u8,
        (base[1] as f32 * inv_alpha + overlay[1] as f32 * alpha) as u8,
        (base[2] as f32 * inv_alpha + overlay[2] as f32 * alpha) as u8,
        255,
    ])
}

/// 画像にノンブル（ページ番号）を追加
pub fn add_nombre_to_image(img: &mut RgbaImage, page_num: u32, size_key: &str, crop_bottom: u32) {
    let font_size = get_nombre_font_size(size_key);
    let text = page_num.to_string();

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

    // テキスト幅を計算
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

    let padding_x = (font_size * 0.5) as i32;
    let padding_y = (font_size * 0.3) as i32;
    let box_width = text_width as i32 + padding_x * 2;
    let box_height = font_size as i32 + padding_y * 2;
    let bottom_margin = (font_size * 0.4) as i32;

    let box_x = (img_width as i32 - box_width) / 2;
    let box_y = if crop_bottom > 0 && crop_bottom < img_height / 2 {
        let crop_area_top = img_height as i32 - crop_bottom as i32;
        let center_y = crop_area_top + (crop_bottom as i32 - box_height) / 2;
        center_y.max(crop_area_top + 5).min(img_height as i32 - box_height - 5)
    } else {
        img_height as i32 - bottom_margin - box_height
    };

    // 背景ボックス
    let bg_color = Rgba([255, 255, 255, 210]);
    let rect = Rect::at(box_x, box_y).of_size(box_width as u32, box_height as u32);
    draw_filled_rect_mut(img, rect, bg_color);

    // テキスト
    let text_x = box_x + (box_width - text_width as i32) / 2;
    let text_y = box_y + (box_height - font_size as i32) / 2;

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
