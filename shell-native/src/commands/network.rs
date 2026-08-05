use crate::error::{AppError, AppResult};

// ============================================================
// DevTools IP 查询
// ============================================================

/// 公网 IP 详情（简化：IP + 地区 + ISP）
/// region = 国家/省/城市 拼接，org = ISP/运营商
#[derive(serde::Serialize, Clone)]
pub struct PublicIpInfo {
    pub ip: String,
    pub region: Option<String>, // 国家/省/城市 拼接
    pub org: Option<String>,    // ISP/运营商
}

/// 单个数据源的查询结果（独立 ok/err，方便前端对比展示）
/// 用户开 proxy 时不同源可能返回不同 IP，全部展示方便对比
#[derive(serde::Serialize)]
pub struct PublicIpSourceResult {
    pub source: String,
    pub info: Option<PublicIpInfo>,
    pub error: Option<String>,
}

/// 网络信息汇总
#[derive(serde::Serialize)]
pub struct NetworkInfo {
    /// 本机所有有效网络接口的 IP（仅 IPv4，去环回 + link-local）
    pub local_ips: Vec<String>,
    /// 公网 IP 多源查询结果（所有源都尝试，每个独立 ok/err）
    pub public: Vec<PublicIpSourceResult>,
}

/// 查询本机网络信息：内网 IP 列表 + 公网 IP 多源查询
/// - 内网 IP：仅保留 IPv4，过滤环回（127.0.0.0/8）和 link-local（169.254.0.0/16）
/// - 公网 IP：并发查询 5 个数据源，每个独立返回 ok/err（不短路）
#[tauri::command]
pub async fn get_network_info() -> AppResult<NetworkInfo> {
    // 内网 IP：仅保留 IPv4，过滤环回和 link-local
    let local_ips: Vec<String> = local_ip_address::list_afinet_netifas()
        .map_err(|e| AppError::Network(format!("枚举网络接口失败: {}", e)))?
        .into_iter()
        .map(|(_iface, ip)| ip)
        .filter(|ip| ip.is_ipv4() && !ip.is_loopback())
        .filter(|ip| {
            // 过滤 IPv4 link-local 169.254.0.0/16
            if let std::net::IpAddr::V4(v4) = ip {
                let octets = v4.octets();
                !(octets[0] == 169 && octets[1] == 254)
            } else {
                true
            }
        })
        .map(|ip| ip.to_string())
        .collect();

    // 公网 IP：并发查询所有源（不短路，方便对比）
    let public = fetch_public_info().await;

    Ok(NetworkInfo { local_ips, public })
}

/// 并发查询所有公网 IP 数据源，每个源独立返回 ok/err
/// 用户开 proxy 时不同源可能看到不同 IP，全部展示方便对比
async fn fetch_public_info() -> Vec<PublicIpSourceResult> {
    // 用 tokio::join! 并发请求五个源，互不阻塞
    let (r1, r2, r3, r4, r5) = tokio::join!(
        fetch_from_source("ipinfo.io", fetch_from_ipinfo),
        fetch_from_source("ip-api.com", fetch_from_ipapi),
        fetch_from_source("ifconfig.me", fetch_from_ifconfig),
        fetch_from_source("ip.sb", fetch_from_ipsb),
        fetch_from_source("myip.ipip.net", fetch_from_myip),
    );
    vec![r1, r2, r3, r4, r5]
}

/// 包装单个数据源的查询：把 Result 转成 PublicIpSourceResult
async fn fetch_from_source<F, Fut>(name: &str, f: F) -> PublicIpSourceResult
where
    F: FnOnce() -> Fut,
    Fut: std::future::Future<Output = anyhow::Result<PublicIpInfo>>,
{
    match f().await {
        Ok(info) => PublicIpSourceResult {
            source: name.to_string(),
            info: Some(info),
            error: None,
        },
        Err(e) => PublicIpSourceResult {
            source: name.to_string(),
            info: None,
            error: Some(e.to_string()),
        },
    }
}

/// 数据源 1：ipinfo.io
/// 返回 ip/city/region/country/org
async fn fetch_from_ipinfo() -> anyhow::Result<PublicIpInfo> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()?;
    let resp: serde_json::Value = client
        .get("https://ipinfo.io/json")
        .send()
        .await?
        .json()
        .await?;
    // 拼接 region：country + region + city（非空才拼）
    let region = [
        resp["country"].as_str(),
        resp["region"].as_str(),
        resp["city"].as_str(),
    ]
    .into_iter()
    .filter_map(|s| s)
    .collect::<Vec<_>>()
    .join(" / ");
    Ok(PublicIpInfo {
        ip: resp["ip"].as_str().unwrap_or("").to_string(),
        region: if region.is_empty() {
            None
        } else {
            Some(region)
        },
        org: resp["org"].as_str().map(|s| s.to_string()),
    })
}

/// 数据源 2：ip-api.com
/// 返回 query(=ip)/country/countryCode/regionName/city/isp
async fn fetch_from_ipapi() -> anyhow::Result<PublicIpInfo> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .build()?;
    let resp: serde_json::Value = client
        .get("http://ip-api.com/json")
        .send()
        .await?
        .json()
        .await?;
    // ip-api 失败时返回 {"status":"fail",...}
    if resp["status"].as_str() == Some("fail") {
        let msg = resp["message"]
            .as_str()
            .unwrap_or("ip-api.com 返回失败")
            .to_string();
        anyhow::bail!(msg);
    }
    // 拼接 region：country + regionName + city
    let region = [
        resp["country"].as_str(),
        resp["regionName"].as_str(),
        resp["city"].as_str(),
    ]
    .into_iter()
    .filter_map(|s| s)
    .collect::<Vec<_>>()
    .join(" / ");
    Ok(PublicIpInfo {
        ip: resp["query"].as_str().unwrap_or("").to_string(),
        region: if region.is_empty() {
            None
        } else {
            Some(region)
        },
        org: resp["isp"].as_str().map(|s| s.to_string()),
    })
}

/// 数据源 3：ifconfig.me/all.json（仅 IP，无地理位置）
/// 强制绑定 IPv4 地址（0.0.0.0），避免系统 DNS 返回 AAAA 记录后 reqwest 走 IPv6
async fn fetch_from_ifconfig() -> anyhow::Result<PublicIpInfo> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED))
        .build()?;
    let resp: serde_json::Value = client
        .get("https://ifconfig.me/all.json")
        .send()
        .await?
        .json()
        .await?;
    Ok(PublicIpInfo {
        ip: resp["ip_addr"].as_str().unwrap_or("").to_string(),
        region: None,
        org: None,
    })
}

/// 数据源 4：ip.sb（国内源，返回 JSON）
/// 返回 ip/country/region/city/isp
/// 强制绑定 IPv4，避免 DNS 解析到 IPv6 地址
async fn fetch_from_ipsb() -> anyhow::Result<PublicIpInfo> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED))
        .build()?;
    let resp: serde_json::Value = client
        .get("https://api.ip.sb/geoip")
        .send()
        .await?
        .json()
        .await?;
    // 拼接 region：country + region + city
    let region = [
        resp["country"].as_str(),
        resp["region"].as_str(),
        resp["city"].as_str(),
    ]
    .into_iter()
    .filter_map(|s| s)
    .collect::<Vec<_>>()
    .join(" / ");
    Ok(PublicIpInfo {
        ip: resp["ip"].as_str().unwrap_or("").to_string(),
        region: if region.is_empty() {
            None
        } else {
            Some(region)
        },
        org: resp["isp"].as_str().map(|s| s.to_string()),
    })
}

/// 数据源 5：myip.ipip.net（国内源，返回纯文本）
/// 返回格式："当前 IP：1.2.3.4  来自于：中国 北京 北京  联通/电信"
/// 强制绑定 IPv4，避免 DNS 解析到 IPv6 地址
async fn fetch_from_myip() -> anyhow::Result<PublicIpInfo> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(5))
        .local_address(std::net::IpAddr::V4(std::net::Ipv4Addr::UNSPECIFIED))
        .build()?;
    let text = client
        .get("https://myip.ipip.net/")
        .send()
        .await?
        .text()
        .await?;
    // 解析 "当前 IP：x.x.x.x  来自于：中国 北京 北京  联通"
    // 用正则或字符串分割提取
    parse_myip_response(&text)
}

/// 解析 myip.ipip.net 的纯文本响应
/// 格式："当前 IP：1.2.3.4  来自于：中国 北京 北京  联通"
fn parse_myip_response(text: &str) -> anyhow::Result<PublicIpInfo> {
    let text = text.trim();
    // 提取 IP：找到 "当前 IP：" 后面的部分
    let ip = text
        .split("当前 IP：")
        .nth(1)
        .and_then(|s| s.split_whitespace().next())
        .unwrap_or("")
        .to_string();

    if ip.is_empty() {
        anyhow::bail!("无法解析 IP：{}", text);
    }

    // 提取地区：找到 "来自于：" 后面的部分
    let rest = text.split("来自于：").nth(1).unwrap_or("");

    // 地区部分用空格分隔，取前几个非空片段作为地区
    let parts: Vec<&str> = rest.split_whitespace().collect();
    let region = if parts.is_empty() {
        None
    } else {
        Some(parts.join(" "))
    };

    Ok(PublicIpInfo {
        ip,
        region,
        org: None, // myip.ipip.net 不单独提供 ISP 字段
    })
}
