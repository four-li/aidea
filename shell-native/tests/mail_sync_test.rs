use aidea_shell_lib::mail_runtime::{idle_keepalive, reconnect_delay};
use aidea_shell_lib::mail_sync::parse_message;
use aidea_shell_lib::mail_sync::{FULL_MESSAGE_FETCH_QUERY, METADATA_FETCH_QUERY};
use std::time::Duration;

const FIXTURE: &str = concat!(
    "From: Alert Bot <alerts@example.com>\r\n",
    "Subject: =?UTF-8?B?5p6E5bu65aSx6LSl?=\r\n",
    "Message-ID: <build-1@example.com>\r\n",
    "Date: Tue, 5 Aug 2026 10:00:00 +0800\r\n",
    "Content-Type: multipart/alternative; boundary=boundary\r\n\r\n",
    "--boundary\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n构建失败，请查看日志。\r\n",
    "--boundary\r\nContent-Type: text/html; charset=utf-8\r\n\r\n",
    "<p>构建失败</p><img src=\"https://tracker.example/pixel\"><script>alert(1)</script>\r\n",
    "--boundary--\r\n"
);

#[test]
fn 解析邮件会保留正文并清理脚本和远程图片() {
    let parsed = parse_message(FIXTURE.as_bytes()).expect("解析邮件");

    assert_eq!(parsed.sender_address, "alerts@example.com");
    assert_eq!(parsed.subject, "构建失败");
    assert_eq!(parsed.text_body.as_deref(), Some("构建失败，请查看日志。"));
    assert!(!parsed.sanitized_html.contains("<script"));
    assert!(!parsed.sanitized_html.contains("tracker.example"));
}

#[test]
fn 邮件元数据_fetch_字段必须作为_imap_列表发送() {
    assert_eq!(
        METADATA_FETCH_QUERY,
        "(UID FLAGS BODY.PEEK[HEADER] INTERNALDATE)"
    );
}

#[test]
fn 邮件正文_fetch_字段必须作为_imap_列表发送() {
    assert_eq!(FULL_MESSAGE_FETCH_QUERY, "(UID BODY.PEEK[])");
}

#[test]
fn idle监听使用保活和有上限的重连退避() {
    assert_eq!(idle_keepalive(), Duration::from_secs(29 * 60));
    assert_eq!(reconnect_delay(0), Duration::from_secs(1));
    assert_eq!(reconnect_delay(1), Duration::from_secs(2));
    assert_eq!(reconnect_delay(2), Duration::from_secs(4));
    assert_eq!(reconnect_delay(8), Duration::from_secs(60));
}
