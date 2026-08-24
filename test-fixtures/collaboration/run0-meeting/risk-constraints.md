# 合成风险与约束

> 本文档只包含纯合成数据，不含真实会议内容或可重放授权。

## 风险

1. Availability projection 在 offer 到达前过期，Worker 需要本地 preflight。
2. Cloud Membership 与 Provider Membership 不一致，必须保持独立状态和可见恢复动作。
3. Provider 写入完成但响应丢失，必须精确 observation 后 link 或 abandon，不得盲重试。
4. Device 撤销或 Coordinator 转交后旧 execution/旧 Coordinator 迟到写入，Cloud 必须 fence。
5. UI 如果不自动聚焦新 Project 或隐藏 pending 卡片，Human 会误以为流程停滞。

## 约束

- 所有 User、Device、Agent、Project、Task 和 execution 识别符在最终回执中脱敏。
- 真实登录和 Provider 凭据只由对应 Human 在自己 Desktop 的私有运行边界输入。
- 完整 live 验收使用同一 exact commit 的 packaged artifact，五个独立 profile 且至少三台物理机或独立 VM。
- DNS/TLS 未就绪时状态是 awaiting_dns；真机矩阵不足时状态是 awaiting_real_devices。
