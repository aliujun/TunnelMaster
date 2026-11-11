# TunnelMaster · 隧道管家

基于 [cloudflared](https://github.com/cloudflare/cloudflared) 的 Windows 桌面图形化管理工具，用鼠标点点就能管理 Cloudflare Tunnel，告别命令行。

> 本工具是 cloudflared 的第三方图形化封装，与 Cloudflare 官方无关。cloudflared 本体需要自行准备。

## 功能特性

- **快速隧道**：填一个本地端口即可启动，自动解析 `trycloudflare.com` 随机公网地址，一键复制
- **命名隧道全流程图形化**：浏览器授权登录 → 一键创建隧道 → 从 Cloudflare 账号导入 → 绑定域名（CNAME）→ 删除云端隧道，全程无需命令行
- **Ingress 多规则编辑器**：一个隧道映射多个「域名 → 本地服务」，支持 HTTP / HTTPS / SSH / RDP 协议，运行时自动生成 `config.yml`
- **崩溃自动重启**：进程异常退出后按配置的间隔与上限自动拉起，恢复后计数清零
- **边缘链路监测**：实时显示与 Cloudflare 边缘的 4 条高可用链路注册状态（默认 4 条，与访客数无关）
- **日志系统**：实时日志、搜索过滤、error/warn 着色、导出 txt、停止后仍可导出本次运行日志
- **系统托盘**：托盘菜单显示每条隧道状态、点击即可启停；关闭行为可选「直接退出」或「最小化到托盘」
- **开机自启 + 启动恢复**：开机自动拉起应用，并自动恢复上次退出前正在运行的隧道
- **配置导入导出**：隧道配置一键备份 / 迁移（JSON 文件）
- **cloudflared 路径自定义**：内置路径探测，也可在设置页手动指定

## 安装使用

### 方式一：下载安装包（推荐）

前往 [Releases](https://github.com/aliujun/TunnelMaster/releases) 下载最新的 `隧道管家 Setup x.x.x.exe`，双击安装即可（可选安装目录，自动创建桌面与开始菜单快捷方式）。

安装后首次使用前，需要在「设置」页指定 cloudflared 可执行文件路径（如 `C:\tools\cloudflared\cloudflared.exe`），没有的话去 [cloudflared Releases](https://github.com/cloudflare/cloudflared/releases/latest) 下载 `cloudflared-windows-amd64.exe`。

### 方式二：从源码构建

```bash
git clone https://github.com/aliujun/TunnelMaster.git
cd TunnelMaster
npm install

# 开发模式
npm run dev

# 打包 Windows 安装包（NSIS）
npm run dist
```

构建产物输出在 `dist/` 目录。

## 使用说明

1. **cloudflared 管理**页：点击「开始登录授权」，浏览器打开 Cloudflare 授权页面完成认证（生成 `cert.pem`），授权成功后自动拉取账号下的命名隧道
2. **新建隧道**：
   - *快速隧道*：只填本地服务端口，启动后获得随机公网地址，适合临时调试
   - *命名隧道*：可一键创建新隧道或导入已有隧道，配置 ingress 规则后启动，再通过「绑定域名」把域名指向隧道
3. **隧道卡片**：启停、复制公网地址、查看/搜索/导出日志、边缘链路状态一目了然
4. **设置**页：cloudflared 路径与版本检测、开机自启、启动恢复、关闭行为、配置导入导出

## 技术栈

- [Electron](https://www.electronjs.org/) + [electron-vite](https://github.com/alex8088/electron-vite)
- [Vue 3](https://vuejs.org/)（Composition API）+ [Pinia](https://pinia.vuejs.org/)
- electron-builder（NSIS 安装包）
- 除以上外零运行时依赖，主进程直接管理 cloudflared 子进程

## 目录结构

```
src/
├── main/                 # 主进程
│   ├── index.js          # 入口：窗口、IPC、托盘、自启
│   ├── process-manager.js # 隧道子进程生命周期管理
│   ├── cloudflared-cli.js # cloudflared 命令封装
│   ├── store.js          # JSON 持久化存储
│   └── tray.js           # 系统托盘
├── preload/              # 预加载桥接（contextBridge）
└── renderer/             # 渲染进程（Vue 3 + Pinia）
    └── src/
        ├── App.vue       # 布局与页面切换
        ├── components/   # TunnelCard / TunnelForm / CloudflaredPanel / SettingsPage
        └── stores/       # tunnels / cloudflared
```

## 数据存储位置

- 应用配置与隧道列表：`%APPDATA%\tunnelmaster\tunnelmaster-data.json`
- ingress 生成的 `config.yml`：`%APPDATA%\tunnelmaster\tunnel-configs\`
- cloudflared 授权凭据：`~/.cloudflared/`（由 cloudflared 自行管理）

## 免责声明

本工具按「现状」提供，使用本工具产生的一切后果（包括但不限于隧道配置错误导致的服务暴露）由使用者自行承担。请合理遵守 Cloudflare 服务条款。

## 许可证

[MIT](./LICENSE) © 2026 aliujun
