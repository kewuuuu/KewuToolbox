#![cfg_attr(not(target_os = "windows"), allow(dead_code))]

#[cfg(target_os = "windows")]
mod windows_listener {
    use std::ffi::c_void;
    use std::io::{self, Write};
    use std::ptr::{null, null_mut};
    use std::time::{SystemTime, UNIX_EPOCH};

    type Bool = i32;
    type Hinstance = *mut c_void;
    type Hwnd = *mut c_void;
    type Hmenu = *mut c_void;
    type Hicon = *mut c_void;
    type Hcursor = *mut c_void;
    type Hbrush = *mut c_void;
    type Lpcwstr = *const u16;
    type Uint = u32;
    type Wparam = usize;
    type Lparam = isize;
    type Lresult = isize;

    const WM_CLIPBOARDUPDATE: Uint = 0x031D;
    const WM_DESTROY: Uint = 0x0002;
    const HWND_MESSAGE: Hwnd = -3isize as Hwnd;

    #[repr(C)]
    struct WndClassW {
        style: u32,
        wnd_proc: Option<unsafe extern "system" fn(Hwnd, Uint, Wparam, Lparam) -> Lresult>,
        cls_extra: i32,
        wnd_extra: i32,
        instance: Hinstance,
        icon: Hicon,
        cursor: Hcursor,
        background: Hbrush,
        menu_name: Lpcwstr,
        class_name: Lpcwstr,
    }

    #[repr(C)]
    struct Msg {
        hwnd: Hwnd,
        message: Uint,
        w_param: Wparam,
        l_param: Lparam,
        time: u32,
        pt_x: i32,
        pt_y: i32,
    }

    #[link(name = "user32")]
    extern "system" {
        fn AddClipboardFormatListener(hwnd: Hwnd) -> Bool;
        fn RemoveClipboardFormatListener(hwnd: Hwnd) -> Bool;
        fn CreateWindowExW(
            ex_style: u32,
            class_name: Lpcwstr,
            window_name: Lpcwstr,
            style: u32,
            x: i32,
            y: i32,
            width: i32,
            height: i32,
            parent: Hwnd,
            menu: Hmenu,
            instance: Hinstance,
            param: *mut c_void,
        ) -> Hwnd;
        fn DefWindowProcW(hwnd: Hwnd, msg: Uint, w_param: Wparam, l_param: Lparam) -> Lresult;
        fn DestroyWindow(hwnd: Hwnd) -> Bool;
        fn DispatchMessageW(msg: *const Msg) -> Lresult;
        fn GetMessageW(msg: *mut Msg, hwnd: Hwnd, min: Uint, max: Uint) -> Bool;
        fn GetModuleHandleW(module_name: Lpcwstr) -> Hinstance;
        fn PostQuitMessage(exit_code: i32);
        fn RegisterClassW(class: *const WndClassW) -> u16;
        fn TranslateMessage(msg: *const Msg) -> Bool;
    }

    fn to_wide(value: &str) -> Vec<u16> {
        value.encode_utf16().chain(std::iter::once(0)).collect()
    }

    fn now_ms() -> u128 {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|duration| duration.as_millis())
            .unwrap_or_default()
    }

    fn emit_json_line(value: &str) {
        let mut stdout = io::stdout().lock();
        let _ = writeln!(stdout, "{value}");
        let _ = stdout.flush();
    }

    unsafe extern "system" fn window_proc(hwnd: Hwnd, msg: Uint, w_param: Wparam, l_param: Lparam) -> Lresult {
        match msg {
            WM_CLIPBOARDUPDATE => {
                emit_json_line(&format!(
                    "{{\"event\":\"clipboard-update\",\"timestampMs\":{}}}",
                    now_ms()
                ));
                0
            }
            WM_DESTROY => {
                PostQuitMessage(0);
                0
            }
            _ => DefWindowProcW(hwnd, msg, w_param, l_param),
        }
    }

    pub fn run() -> i32 {
        unsafe {
            let class_name = to_wide("KewuToolboxClipboardListenerWindow");
            let instance = GetModuleHandleW(null());
            let window_class = WndClassW {
                style: 0,
                wnd_proc: Some(window_proc),
                cls_extra: 0,
                wnd_extra: 0,
                instance,
                icon: null_mut(),
                cursor: null_mut(),
                background: null_mut(),
                menu_name: null(),
                class_name: class_name.as_ptr(),
            };

            if RegisterClassW(&window_class) == 0 {
                emit_json_line("{\"event\":\"error\",\"message\":\"register-class-failed\"}");
                return 2;
            }

            let hwnd = CreateWindowExW(
                0,
                class_name.as_ptr(),
                class_name.as_ptr(),
                0,
                0,
                0,
                0,
                0,
                HWND_MESSAGE,
                null_mut(),
                instance,
                null_mut(),
            );

            if hwnd.is_null() {
                emit_json_line("{\"event\":\"error\",\"message\":\"create-window-failed\"}");
                return 3;
            }

            if AddClipboardFormatListener(hwnd) == 0 {
                emit_json_line("{\"event\":\"error\",\"message\":\"add-listener-failed\"}");
                let _ = DestroyWindow(hwnd);
                return 4;
            }

            emit_json_line(&format!("{{\"event\":\"ready\",\"timestampMs\":{}}}", now_ms()));

            let mut msg = Msg {
                hwnd: null_mut(),
                message: 0,
                w_param: 0,
                l_param: 0,
                time: 0,
                pt_x: 0,
                pt_y: 0,
            };

            while GetMessageW(&mut msg, null_mut(), 0, 0) > 0 {
                let _ = TranslateMessage(&msg);
                let _ = DispatchMessageW(&msg);
            }

            let _ = RemoveClipboardFormatListener(hwnd);
            let _ = DestroyWindow(hwnd);
            0
        }
    }
}

#[cfg(target_os = "windows")]
fn main() {
    std::process::exit(windows_listener::run());
}

#[cfg(not(target_os = "windows"))]
fn main() {
    eprintln!("kewu-clipboard-listener only supports Windows.");
    std::process::exit(1);
}
