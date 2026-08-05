use aidea_shell_lib::manifest::{load_all_manifests, UiMode};

fn prepare_data_dir() {
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("target/test-data");
    std::fs::create_dir_all(&path).expect("创建测试数据目录失败");
    std::env::set_var("AIDEA_DATA_DIR", path);
}

#[test]
fn 应能加载_apps_目录下的所有_yaml() {
    prepare_data_dir();
    // 内置 manifest 编译进 Rust，不依赖源码目录或用户配置。
    let manifests = load_all_manifests().expect("加载 manifest 失败");
    assert!(manifests.len() >= 2, "至少应有两个内置子应用");

    let dashboard = manifests
        .iter()
        .find(|m| m.id == "dashboard")
        .expect("应能找到 dashboard");
    assert_eq!(dashboard.ui.mode, UiMode::Builtin);
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
fn 应从用户数据目录加载本地_manifest() {
    prepare_data_dir();
    let root = std::env::var("AIDEA_DATA_DIR").expect("缺少测试数据目录");
    let path = std::path::Path::new(&root).join("apps/local/local-test.yaml");
    std::fs::create_dir_all(path.parent().expect("本地 manifest 应有父目录"))
        .expect("创建本地 manifest 目录失败");
    std::fs::write(
        path,
        "id: local-test\nname: Local Test\nversion: 0.1.0\ncategory: 测试\npath: /tmp\nstatus: disabled\nui:\n  mode: none\n",
    )
    .expect("写入本地 manifest 失败");

    let manifests = load_all_manifests().expect("加载 manifest 失败");
    assert!(manifests.iter().any(|manifest| manifest.id == "local-test"));
}

#[test]
fn 应从用户数据目录加载已安装_manifest() {
    prepare_data_dir();
    let root = std::env::var("AIDEA_DATA_DIR").expect("缺少测试数据目录");
    let path = std::path::Path::new(&root).join("apps/installed/installed-test/manifest.yaml");
    std::fs::create_dir_all(path.parent().expect("已安装 manifest 应有父目录"))
        .expect("创建已安装 manifest 目录失败");
    std::fs::write(
        path,
        "id: installed-test\nname: Installed Test\nversion: 0.1.0\ncategory: 测试\npath: /tmp\nstatus: disabled\nui:\n  mode: none\n",
    )
    .expect("写入已安装 manifest 失败");

    let manifests = load_all_manifests().expect("加载 manifest 失败");
    assert!(manifests
        .iter()
        .any(|manifest| manifest.id == "installed-test"));
}

#[test]
fn 首次启动迁移旧配置和本地_manifest() {
    prepare_data_dir();
    aidea_shell_lib::config::migrate_legacy_data().expect("迁移旧用户数据失败");

    let root = std::env::var("AIDEA_DATA_DIR").expect("缺少测试数据目录");
    let root = std::path::Path::new(&root);
    assert!(root.join("shell.config.json").exists());
    assert!(root.join("apps/local/atlas.yaml").exists());
    assert!(root.join(".migration-v1").exists());
}
