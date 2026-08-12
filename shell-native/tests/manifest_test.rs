use aidea_shell_lib::manifest::{load_all_manifests, UiMode};

fn prepare_data_dir() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/test-data");
    std::fs::create_dir_all(&path).expect("创建测试数据目录失败");
    std::env::set_var("AIDEA_DATA_DIR", path);
}

#[test]
fn 应能加载内置和已安装官方应用() {
    prepare_data_dir();
    // 内置 manifest 编译进 Rust，不依赖源码目录或用户配置。
    let manifests = load_all_manifests().expect("加载 manifest 失败");
    assert!(
        manifests.iter().any(|manifest| manifest.id == "dev-tools"),
        "应包含 dev-tools 内置应用"
    );
    assert!(
        !manifests.iter().any(|manifest| manifest.id == "dashboard"),
        "统计页不应作为内置应用加载"
    );
    assert!(
        !manifests
            .iter()
            .any(|manifest| manifest.id == "mail-manager"),
        "旧邮件管理不应作为内置应用加载"
    );
}

#[test]
fn dev_tools_应为_builtin_模式且无_process() {
    prepare_data_dir();
    let manifests = load_all_manifests().expect("加载 manifest 失败");
    let dev_tools = manifests
        .iter()
        .find(|m| m.id == "dev-tools")
        .expect("应能找到 dev-tools");
    assert_eq!(dev_tools.ui.mode, UiMode::Builtin);
    assert!(dev_tools.process.is_none(), "dev-tools 不应有 process 段");
}

#[test]
fn 首次启动迁移旧配置() {
    prepare_data_dir();
    aidea_shell_lib::config::migrate_legacy_data().expect("迁移旧用户数据失败");

    let root = std::env::var("AIDEA_DATA_DIR").expect("缺少测试数据目录");
    let root = std::path::Path::new(&root);
    assert!(root.join("shell.config.json").exists());
    assert!(root.join(".migration-v1").exists());
}
