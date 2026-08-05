pub mod ai_keychain;
pub mod commands;
pub mod config;
pub mod error;
pub mod mac_auth;
pub mod manifest;
pub mod process;

use process::{start_autostart_apps, ProcessManager};

pub fn run() {
    let manager = ProcessManager::default();
    tauri::Builder::default()
        .manage(manager.clone())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            commands::shell::list_apps,
            commands::shell::save_app_manifest,
            commands::shell::get_shell_config,
            commands::shell::save_app_override,
            commands::shell::reset_app_override,
            commands::shell::start_app,
            commands::shell::stop_app,
            commands::shell::get_app_states,
            commands::shell::read_app_log,
            commands::network::get_network_info,
            commands::ai::send_ai_http_request,
            commands::ai::save_ai_config,
            commands::ai::list_ai_configs,
            commands::ai::load_ai_config,
            commands::ai::delete_ai_config,
        ])
        .setup(move |_app| {
            config::migrate_legacy_data()
                .map_err(|error| Box::new(error) as Box<dyn std::error::Error>)?;
            // 启动 autostart 子应用（clone manager move 进 async task）
            let m = manager.clone();
            tauri::async_runtime::spawn(async move {
                start_autostart_apps(&m).await;
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
}
