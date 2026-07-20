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
        // RAW job through the Windows print spooler (`address` = installed printer
        // name) — the recommended Windows path (docs/PERIPHERALS.md §1). Sends the
        // opaque ESC/POS bytes with the "RAW" datatype so the spooler does no driver
        // rendering. Windows-only; the mac build returns a clear error.
        "windows_spooler" => print_windows_spooler(&target.address, &data),
        // TODO(stage-5-finish): open the COM/tty port and write the bytes.
        "serial" => Err("serial transport not yet implemented".into()),
        other => Err(format!("unknown print target kind: {other}")),
    }
}

/// Minimal Win32 spooler FFI (`winspool`) for the RAW-datatype print path. Declared
/// by hand rather than pulling in the large `windows` crate — the Win32 C ABI is
/// stable and this keeps the desktop binary lean. Windows-only.
#[cfg(windows)]
#[allow(non_snake_case)]
mod winspool {
    use std::os::raw::c_void;

    pub type Handle = *mut c_void;
    pub type Bool = i32;
    pub type Dword = u32;
    pub type Lpwstr = *mut u16;

    /// `DOC_INFO_1W` — names the spool job and selects its datatype ("RAW").
    #[repr(C)]
    pub struct DocInfo1W {
        pub p_doc_name: Lpwstr,
        pub p_output_file: Lpwstr,
        pub p_datatype: Lpwstr,
    }

    #[link(name = "winspool")]
    extern "system" {
        pub fn OpenPrinterW(
            p_printer_name: Lpwstr,
            ph_printer: *mut Handle,
            p_default: *mut c_void,
        ) -> Bool;
        pub fn ClosePrinter(h_printer: Handle) -> Bool;
        pub fn StartDocPrinterW(h_printer: Handle, level: Dword, p_doc_info: *mut DocInfo1W)
            -> Dword;
        pub fn EndDocPrinter(h_printer: Handle) -> Bool;
        pub fn StartPagePrinter(h_printer: Handle) -> Bool;
        pub fn EndPagePrinter(h_printer: Handle) -> Bool;
        pub fn WritePrinter(
            h_printer: Handle,
            p_buf: *const c_void,
            cb_buf: Dword,
            pc_written: *mut Dword,
        ) -> Bool;
    }
}

/// Send `data` to an installed Windows printer by name, using the spooler's RAW
/// datatype (the classic Open→StartDoc→StartPage→Write→EndPage→EndDoc→Close
/// sequence). Every handle is torn down on every path; write errors are captured
/// before cleanup so the OS error code stays accurate.
#[cfg(windows)]
fn print_windows_spooler(printer_name: &str, data: &[u8]) -> Result<(), String> {
    use std::os::raw::c_void;
    use std::ptr;
    use winspool::*;

    fn to_wide(s: &str) -> Vec<u16> {
        s.encode_utf16().chain(std::iter::once(0)).collect()
    }
    fn os_err() -> std::io::Error {
        std::io::Error::last_os_error()
    }

    if printer_name.trim().is_empty() {
        return Err("windows_spooler: no printer name configured".into());
    }

    let mut name = to_wide(printer_name);
    let mut doc_name = to_wide("VallaPOS Receipt");
    let mut datatype = to_wide("RAW");

    unsafe {
        let mut h_printer: Handle = ptr::null_mut();
        if OpenPrinterW(name.as_mut_ptr(), &mut h_printer, ptr::null_mut()) == 0 {
            return Err(format!("OpenPrinter '{printer_name}' failed: {}", os_err()));
        }

        let mut doc = DocInfo1W {
            p_doc_name: doc_name.as_mut_ptr(),
            p_output_file: ptr::null_mut(),
            p_datatype: datatype.as_mut_ptr(),
        };
        if StartDocPrinterW(h_printer, 1, &mut doc) == 0 {
            let e = os_err();
            ClosePrinter(h_printer);
            return Err(format!("StartDocPrinter failed: {e}"));
        }
        if StartPagePrinter(h_printer) == 0 {
            let e = os_err();
            EndDocPrinter(h_printer);
            ClosePrinter(h_printer);
            return Err(format!("StartPagePrinter failed: {e}"));
        }

        // Loop in case the spooler accepts fewer bytes than requested.
        let mut offset = 0usize;
        let mut write_err: Option<String> = None;
        while offset < data.len() {
            let mut written: Dword = 0;
            let chunk = (data.len() - offset).min(u32::MAX as usize) as Dword;
            let ok = WritePrinter(
                h_printer,
                data[offset..].as_ptr() as *const c_void,
                chunk,
                &mut written,
            );
            if ok == 0 {
                write_err = Some(format!("WritePrinter failed: {}", os_err()));
                break;
            }
            if written == 0 {
                write_err = Some("WritePrinter wrote 0 bytes".to_string());
                break;
            }
            offset += written as usize;
        }

        EndPagePrinter(h_printer);
        EndDocPrinter(h_printer);
        ClosePrinter(h_printer);

        match write_err {
            Some(e) => Err(e),
            None => Ok(()),
        }
    }
}

/// Non-Windows stub so the shared codebase (e.g. the macOS release build) still
/// compiles; the spooler path only exists on Windows.
#[cfg(not(windows))]
fn print_windows_spooler(_printer_name: &str, _data: &[u8]) -> Result<(), String> {
    Err("windows_spooler is only available on the Windows build".into())
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
