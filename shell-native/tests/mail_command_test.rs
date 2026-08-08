use aidea_shell_lib::commands::mail::{
    validate_account_request, validate_connection_request, validate_webmail_url,
    SaveMailAccountRequest,
};

fn valid_request() -> SaveMailAccountRequest {
    SaveMailAccountRequest {
        id: None,
        display_name: "腾讯企业邮箱".into(),
        email: "ops@example.com".into(),
        provider: "tencent-exmail".into(),
        imap_host: "imap.exmail.qq.com".into(),
        imap_port: 993,
        tls_mode: "tls".into(),
        username: "ops@example.com".into(),
        auth_kind: "app-password".into(),
        secret: "secret".into(),
        webmail_url: "https://exmail.qq.com".into(),
        inbox_folder: "INBOX".into(),
        trash_folder: None,
        spam_folder: None,
        deleted_folder: None,
    }
}

#[test]
fn 网页邮箱跳转只接受安全协议() {
    assert!(validate_webmail_url("https://exmail.qq.com").is_ok());
    assert!(validate_webmail_url("file:///tmp/mail").is_err());
}

#[test]
fn 邮箱地址可作为未单独填写账号时的_imap_登录名() {
    let mut request = valid_request();
    request.username.clear();
    assert!(validate_account_request(&request).is_ok());
}

#[test]
fn 编辑已有账户时可保留已保存凭据() {
    let mut request = valid_request();
    request.id = Some("existing-account".into());
    request.secret.clear();

    assert!(validate_account_request(&request).is_ok());
}

#[test]
fn 账户配置拒绝无效端口和非网页协议() {
    let mut invalid_port = valid_request();
    invalid_port.imap_port = 0;
    assert!(validate_account_request(&invalid_port).is_err());

    let mut invalid_url = valid_request();
    invalid_url.webmail_url = "file:///tmp/mail".into();
    assert!(validate_account_request(&invalid_url).is_err());
}

#[test]
fn 测试连接只校验_imap_登录字段() {
    let mut request = valid_request();
    request.webmail_url = "file:///tmp/mail".into();
    assert!(validate_connection_request(&request).is_ok());

    request.secret.clear();
    assert!(validate_connection_request(&request).is_err());
}
