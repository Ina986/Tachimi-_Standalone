/**
 * constants.js - アプリ全体の定数
 */

// Undo/Redo
export const MAX_HISTORY = 50;

// JSON保存パス
export const JSON_FOLDER_PATH = "G:/共有ドライブ/CLLENN/編集部フォルダ/編集企画部/編集企画_C班(AT業務推進)/DTP制作部/JSONフォルダ";

// 機能アンロック
export const UNLOCK_STORAGE_KEY = 'tachimi_feature_unlock';
export const UNLOCK_PASSWORD = 'Tachimi2026';

// JSON登録用の固定比率（幅:高さ = 640:909）
export const JSON_REGISTER_ASPECT_RATIO = 640 / 909;

// ジャンル別ラベル一覧
export const LABELS_BY_GENRE = {
    "一般女性": ["Ropopo!", "コイパレ", "キスカラ", "カルコミ", "ウーコミ!", "シェノン"],
    "TL": ["TLオトメチカ", "LOVE FLICK", "乙女チック", "ウーコミkiss!", "シェノン+", "@夜噺"],
    "BL": ["NuPu", "spicomi", "MooiComics", "BLオトメチカ", "BOYS FAN"],
    "一般男性": ["DEDEDE", "GG-COMICS", "コミックREBEL"],
    "メンズ": ["カゲキヤコミック", "もえスタビースト", "@夜噺＋"],
    "タテコミ": ["GIGATOON"]
};

// 色名とカラーコードの対応
export const COLOR_MAP = {
    black: '#000000',
    white: '#ffffff',
    cyan: '#00bfff'
};

// 設定の永続化キー
export const SETTINGS_STORAGE_KEY = 'tachimi_ui_settings';
