pub mod commands;
pub mod config;
pub mod error;
pub mod mac_auth;
pub mod mail_runtime;
pub mod mail_store;
pub mod mail_sync;
pub mod manifest;
pub mod plugin_installer;
pub mod plugin_market;
pub mod process;
pub mod secret_store;

use process::{start_autostart_apps, ProcessManager};

pub fn run() {
    let manager = ProcessManager::default();
    let startup_manager = manager.clone();
    let shutdown_manager = manager.clone();
    let app = tauri::Builder::default()
        .manage(manager.clone())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            commands::shell::list_apps,
            commands::shell::list_official_plugins,
            commands::shell::list_installed_official_plugins,
            commands::shell::install_official_plugin,
            commands::shell::update_official_plugin,
            commands::shell::read_official_plugin_install_log,
            commands::shell::uninstall_official_plugin,
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
            commands::mail::save_mail_account,
            commands::mail::load_mail_account_secret,
            commands::mail::test_mail_account_connection,
            commands::mail::list_mail_accounts,
            commands::mail::delete_mail_account,
            commands::mail::sync_mail_accounts,
            commands::mail::sync_mail_history,
            commands::mail::cancel_mail_sync,
            commands::mail::list_mail_sync_tasks,
            commands::mail::list_mail_messages,
            commands::mail::get_mail_message,
            commands::mail::mark_mail_read,
            commands::mail::mark_mail_unread,
            commands::mail::move_mail_to_deleted,
            commands::mail::open_mail_webmail,
        ])
        .setup(move |_app| {
            config::migrate_legacy_data()
                .map_err(|error| Box::new(error) as Box<dyn std::error::Error>)?;
            // 启动 autostart 子应用（clone manager move 进 async task）
            let m = startup_manager.clone();
            tauri::async_runtime::spawn(async move {
                start_autostart_apps(&m).await;
            });
            mail_runtime::start_all(_app.handle().clone());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("启动 Tauri 应用失败");
    app.run(move |_app, event| {
        if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
            tauri::async_runtime::block_on(shutdown_manager.stop_all());
        }
    });
}
