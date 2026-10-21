# 代码签名政策（Code Signing Policy）

本项目（Mountain 启动器）通过 [SignPath Foundation](https://signpath.org) 为开源项目提供的免费代码签名服务发布 Windows 安装包。

## 签名范围

- **签名对象**：由本仓库 CI（GitHub Actions）自动构建的 Windows 安装包（`*-setup.exe`）
- **签名者**：证书由 SignPath Foundation 签发（发布者显示为 "SignPath Foundation"）
- **构建来源**：仅签名由 GitHub Actions 从本仓库构建的产物；不签名任何来源不明或第三方的二进制
- **发布渠道**：签名产物仅通过本仓库的 [GitHub Releases](https://github.com/Hello-1660/mountain/releases) 分发

## 角色与职责

| 角色 | 职责 |
|---|---|
| **作者（Author）** | 仓库维护者，负责源码与构建脚本的变更 |
| **审阅者（Reviewer）** | 外部贡献（Pull Request）合并前须经维护者审阅 |
| **批准者（Approver）** | 每次签名请求（发布）由维护者确认后触发 |

（当前为个人维护项目，由维护者一人兼任以上角色；接受外部 PR 时执行审阅流程。）

## 安全要求

- 仓库与 SignPath 账户均启用多因素认证（MFA）
- 签名在 CI 中自动完成，私钥保存在 SignPath 的硬件安全模块（HSM）中，项目不接触私钥
- 每个发布标签（`v*`）触发一次签名，签名结果可在 SignPath 审计日志中追溯

## 验证发布产物

Windows 上可验证安装包签名：

```powershell
Get-AuthenticodeSignature "Mountain 启动器_x.y.z_x64-setup.exe"
# 期望：Status = Valid，Signer 含 CN=SignPath Foundation
```

或在文件属性 →「数字签名」中查看签名者。
