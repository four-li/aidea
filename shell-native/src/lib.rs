pub mod commands;
pub mod config;
pub mod error;
pub mod mail_runtime;
pub mod mail_store;
pub mod mail_sync;
pub mod manifest;
pub mod plugin_installer;
pub mod plugin_market;
pub mod process;

use process::{start_autostart_apps, start_configured_official_apps, ProcessManager};
use tauri::menu::{Menu, MenuItem, SubmenuBuilder};
use tauri::Emitter;

pub fn run() {
    let manager = ProcessManager::default();
    let startup_manager = manager.clone();
    let shutdown_manager = manager.clone();
    let app = tauri::Builder::default()
        .manage(manager.clone())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            commands::shell::get_aidea_version,
            commands::shell::get_os_username,
            commands::shell::check_aidea_update,
            commands::shell::install_aidea_update,
            commands::shell::list_apps,
            commands::shell::list_official_plugins,
            commands::shell::refresh_official_plugins,
            commands::shell::list_installed_official_plugins,
            commands::shell::install_official_plugin,
            commands::shell::update_official_plugin,
            commands::shell::read_official_plugin_install_log,
            commands::shell::uninstall_official_plugin,
            commands::shell::save_app_manifest,
            commands::shell::get_shell_config,
            commands::shell::save_app_override,
            commands::shell::reset_app_override,
            commands::shell::reset_app_settings,
            commands::shell::save_app_user_settings,
            commands::shell::start_app,
            commands::shell::stop_app,
            commands::shell::get_app_states,
            commands::shell::read_app_log,
            commands::dev_tools::get_dev_tools_settings,
            commands::dev_tools::save_dev_tools_settings,
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
        .menu(|app| {
            let menu = Menu::default(app)?;

            // 默认菜单保留系统快捷键，按显示文本翻译菜单并修改 macOS 应用菜单。
            let mut app_menu = None;
            for item in menu.items()? {
                let Some(submenu) = item.as_submenu().cloned() else {
                    continue;
                };
                let title = submenu.text()?;
                let translated = match title.as_str() {
                    "File" => Some("文件"),
                    "Edit" => Some("编辑"),
                    "View" => Some("视图"),
                    "Window" => Some("窗口"),
                    "Help" => Some("帮助"),
                    _ => None,
                };
                if let Some(translated) = translated {
                    submenu.set_text(translated)?;
                } else if app_menu.is_none() {
                    submenu.set_text("开搞")?;
                    for child in submenu.items()? {
                        let Some(predefined) = child.as_predefined_menuitem() else {
                            continue;
                        };
                        let text = predefined.text()?;
                        let translated = if text.starts_with("About ") {
                            Some("关于开搞")
                        } else if text.starts_with("Hide ") {
                            Some("隐藏开搞")
                        } else if text == "Hide Others" {
                            Some("隐藏其他")
                        } else if text.starts_with("Quit ") {
                            Some("退出开搞")
                        } else if text == "Services" {
                            Some("服务")
                        } else {
                            None
                        };
                        if let Some(translated) = translated {
                            predefined.set_text(translated)?;
                        }
                    }
                    app_menu = Some(submenu);
                }
            }

            if let Some(app_menu) = app_menu {
                // 自定义菜单项统一置于系统默认项之前，后续新增项继续插入到这里。
                let settings = MenuItem::with_id(
                    app,
                    "open-aidea-settings",
                    "设置",
                    true,
                    None::<&str>,
                )?;
                let check_update = MenuItem::with_id(
                    app,
                    "check-aidea-update",
                    "检查更新",
                    true,
                    None::<&str>,
                )?;
                app_menu.insert(&check_update, 0)?;
                app_menu.insert(&settings, 0)?;
            } else {
                let aidea_menu = SubmenuBuilder::new(app, "开搞")
                    .text("open-aidea-settings", "设置")
                    .text("check-aidea-update", "检查更新")
                    .build()?;
                menu.append(&aidea_menu)?;
            }
            Ok(menu)
        })
        .on_menu_event(|app, event| {
            if event.id() == "open-aidea-settings" {
                let _ = app.emit("aidea:open-settings", ());
            } else if event.id() == "check-aidea-update" {
                let _ = app.emit("aidea:check-update", ());
            }
        })
        .setup(move |_app| {
            config::migrate_legacy_data()
                .map_err(|error| Box::new(error) as Box<dyn std::error::Error>)?;
            // 启动 autostart 子应用（clone manager move 进 async task）
            let m = startup_manager.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(error) = m.recover_managed_processes().await {
                    eprintln!("恢复受管子应用失败: {error}");
                }
                start_configured_official_apps(&m).await;
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
