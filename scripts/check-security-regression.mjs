// Tachimi セキュリティ回帰検査（手順書 06_/12_ §10）。
// CSP・最小権限・asset scope・パス検証・生プラグイン封鎖・脱git updater の後退を機械検出する。
// 実行: node scripts/check-security-regression.mjs   （いずれか違反で exit 1）
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");
const fail = [];
const ok = [];
const check = (cond, msg) => (cond ? ok.push(msg) : fail.push(msg));

// 1) tauri.conf.json: CSP + assetProtocol
const conf = JSON.parse(read("src-tauri/tauri.conf.json"));
const csp = conf?.app?.security?.csp ?? "";
check(/default-src 'self'/.test(csp), "CSP: default-src 'self'");
check(/script-src 'self'/.test(csp), "CSP: script-src 'self'");
check(!/unsafe-eval/.test(csp), "CSP: no unsafe-eval");
check(!/script-src[^;]*unsafe-inline/.test(csp), "CSP: no script unsafe-inline");
check(/object-src 'none'/.test(csp), "CSP: object-src 'none'");
check(/base-uri 'self'/.test(csp), "CSP: base-uri 'self'");
check(/form-action 'self'/.test(csp), "CSP: form-action 'self'");
const scope = JSON.stringify(conf?.app?.security?.assetProtocol?.scope ?? []);
check(!/"\*\*"/.test(scope) && !/\$HOME|\$DOCUMENT|\$DESKTOP|\$DOWNLOAD|\$LOCALAPPDATA|"[A-Za-z]:/.test(scope), "assetProtocol.scope is app-scoped (no **/$HOME/drive)");
check(/\$TEMP\/Tachimi/.test(scope), "assetProtocol.scope contains $TEMP/Tachimi");

// 2) capabilities: 最小権限（fs:read-all/write-all/** や shell:allow-open が無い）
const caps = read("src-tauri/capabilities/default.json");
check(!/fs:read-all/.test(caps), "caps: no fs:read-all");
check(!/fs:write-all/.test(caps), "caps: no fs:write-all");
check(!/"\*\*"/.test(caps), "caps: no ** path scope");
check(!/shell:allow-open|shell:default/.test(caps), "caps: no shell plugin perms");

// 3) security.rs: パス検証関数群
const sec = read("src-tauri/src/security.rs");
for (const fn of ["ensure_read_path", "ensure_write_path", "ensure_query_path", "validate_file_name", "reject_protected_path", "grant_user_path", "secure_read_dir", "secure_stat", "secure_read_binary_file"]) {
  check(sec.includes(`fn ${fn}`), `security.rs: ${fn} present`);
}

// 4) lib.rs: 生プラグイン未登録 + secure_* / 脱git登録
const lib = read("src-tauri/src/lib.rs");
check(!/plugin\(tauri_plugin_fs::init\(\)\)/.test(lib), "lib.rs: tauri-plugin-fs not registered");
check(!/plugin\(tauri_plugin_shell::init\(\)\)/.test(lib), "lib.rs: tauri-plugin-shell not registered");
check(/security::secure_read_dir/.test(lib), "lib.rs: secure_* commands registered");
check(/updater_local::check_local_update/.test(lib) && /updater_local::apply_local_update/.test(lib), "lib.rs: 脱git updater commands registered");

// 5) フロント: 生 fs/shell/dialog/path プラグインを直接呼んでいない
const api = read("src/js/core/tauri-api.js");
check(!/__TAURI__\.(fs|shell|dialog|path)\b/.test(api), "tauri-api.js: no raw fs/shell/dialog/path");
check(/secure_open_dialog|secure_read_text_file|secure_stat/.test(api), "tauri-api.js: uses secure_* commands");

// 6) updater_local.rs: minisign 検証
const upd = read("src-tauri/src/updater_local.rs");
check(/minisign_verify/.test(upd) && /verify_minisign/.test(upd), "updater_local.rs: minisign verification");

// 結果
for (const m of ok) console.log(`  ok  ${m}`);
if (fail.length) {
  console.error("\nSecurity regression check FAILED:");
  for (const m of fail) console.error(`  NG  ${m}`);
  process.exit(1);
}
console.log(`\nSecurity regression check passed (${ok.length} checks)`);
