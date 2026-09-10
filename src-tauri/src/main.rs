// Release builds are a windowed app, not a console one. Without this the
// launcher opens a console window alongside the widget, and closing that
// console kills the app. Debug builds keep the console so `tauri dev` can
// still print the companion/pointer logs.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    ai_usage_lib::run()
}
