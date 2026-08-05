// 与 Rust 侧 commands.rs 的 NetworkInfo / PublicIpInfo / PublicIpSourceResult 一一对应

/** 公网 IP 详情（简化：IP + 地区 + ISP） */
export interface PublicIpInfo {
  ip: string;
  region: string | null; // 国家/省/城市 拼接
  org: string | null;    // ISP/运营商
}

/** 单个数据源的查询结果（独立 ok/err，方便前端对比展示） */
export interface PublicIpSourceResult {
  source: string;
  info: PublicIpInfo | null;
  error: string | null;
}

/** 本机网络信息汇总 */
export interface NetworkInfo {
  /** 本机所有有效网络接口的 IP（仅 IPv4，去环回 + link-local） */
  local_ips: string[];
  /** 公网 IP 多源查询结果（所有源都尝试，每个独立 ok/err） */
  public: PublicIpSourceResult[];
}
