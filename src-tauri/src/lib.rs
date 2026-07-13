//! VallaPOS desktop (offline edition) Rust core — docs/EDITIONS.md §3/§5.
//!
//! The webview runs the same Next.js frontend as the cloud app (static export,
//! `NEXT_PUBLIC_VALLA_EDITION=local`). Two native concerns live here that the
//! browser can't do:
//!   1. `tauri-plugin-sql` ships the SQLite engine inside this binary; the JS
//!      `Database` it exposes is adapted to the store's `SqlDriver` by
//!      `src/lib/data-store/sqlite/tauri-driver.ts`.
//!   2. `print_raw` / `open_drawer` send PRE-FORMATTED ESC/POS bytes (built by the
//!      shared `src/features/peripherals/escpos.ts`) to a thermal printer over a
//!      native transport — turning the Windows `usbprint.sys` driver claim (a
//!      WebUSB blocker) into the supported path, and reaching TCP-9100 / serial
//!      printers the browser can't. Only the transport is native; the byte
//!      formatter is unchanged.

mod license;

use serde::Deserialize;
use std::io::Write;
use std::net::TcpStream;
use std::time::Duration;

/// Where `print_raw` should send the bytes — mirrors `NativePrintTarget` in
/// `src/features/peripherals/transports/tauri.ts`.
#[derive(Debug, Deserialize)]
pub struct PrintTarget {
    /// "tcp" | "windows_spooler" | "serial".
    pub kind: String,
    /// host[:port] for tcp (port defaults to 9100); printer name / COM port else.
    pub address: String,
}

/// Send a raw, pre-formatted ESC/POS byte stream to a printer.
///
/// Implemented: the driver-free **TCP 9100 (JetDirect)** path — the robust,
/// first-class transport `docs/PERIPHERALS.md` recommends for a shipped product.
/// The Windows spooler (RAW `WritePrinter`) and serial paths are TODO stubs that
/// fail loudly rather than silently dropping a receipt.
#[tauri::command]
fn print_raw(target: PrintTarget, data: Vec<u8>) -> Result<(), String> {
    match target.kind.as_str() {
        "tcp" => {
            let addr = if target.address.contains(':') {
                target.address.clone()
            } else {
                format!("{}:9100", target.address)
            };
            let mut stream = TcpStream::connect(&addr)
                .map_err(|e| format!("connect {addr}: {e}"))?;
            stream
                .set_write_timeout(Some(Duration::from_secs(5)))
                .map_err(|e| format!("set timeout: {e}"))?;
            stream.write_all(&data).map_err(|e| format!("write: {e}"))?;
            stream.flush().map_err(|e| format!("flush: {e}"))?;
            Ok(())
        }
        // TODO(stage-5-finish): RAW job via the Windows print spooler
        // (`OpenPrinter`/`StartDocPrinter`/`WritePrinter`) against a Generic/Text
        // driver — the recommended Windows path (docs/PERIPHERALS.md §1).
        "windows_spooler" => Err("windows_spooler transport not yet implemented".into()),
        // TODO(stage-5-finish): open the COM/tty port and write the bytes.
        "serial" => Err("serial transport not yet implemented".into()),
        other => Err(format!("unknown print target kind: {other}")),
    }
}

/// Fire the printer-driven cash-drawer kick (`ESC p m t1 t2`). `pin` selects the
/// RJ11 DK pin (2 or 5); default 2, matching `escpos.ts` `drawerKick(2)`. This is a
/// convenience command — the JS transport also kicks the drawer by sending the
/// shared `drawerKick()` bytes through `print_raw`.
#[tauri::command]
fn open_drawer(target: PrintTarget, pin: Option<u8>) -> Result<(), String> {
    let m: u8 = if pin == Some(5) { 1 } else { 0 };
    // ESC p m t1 t2 — on≈50ms (0x32), off≈250ms (0xFA) at ~2ms/unit.
    let bytes = vec![0x1B, 0x70, m, 0x32, 0xFA];
    print_raw(target, bytes)
}

/// Verify a license blob against the embedded Ed25519 public key. Returns the SKU
/// on success (enough for the webview to render a friendly licensed state) or a
/// short error code the UI maps to a message. This command is the boot gate hook;
/// Stage 6b gates the SQLite open + license entry screen on it. `revoked` is the
/// signed embedded blocklist (empty for now).
#[tauri::command]
fn check_license(blob: String, now_ms: u64) -> Result<String, String> {
    match license::verify_license(&blob, now_ms, &[]) {
        Ok(claims) => Ok(claims.sku),
        Err(license::LicenseError::BadSignature) => Err("bad_signature".into()),
        Err(license::LicenseError::Expired) => Err("expired".into()),
        Err(license::LicenseError::Revoked) => Err("revoked".into()),
        Err(license::LicenseError::UnsupportedVersion) => Err("unsupported_version".into()),
        Err(license::LicenseError::Malformed) => Err("malformed".into()),
    }
}

/// Build + run the Tauri app: register the SQLite + store plugins and the native
/// commands, then hand control to the webview.
#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_store::Builder::default().build())
        .invoke_handler(tauri::generate_handler![print_raw, open_drawer, check_license])
        .run(tauri::generate_context!())
        .expect("error while running the VallaPOS desktop app");
}
