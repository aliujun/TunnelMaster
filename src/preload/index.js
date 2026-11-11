import { contextBridge, ipcRenderer } from 'electron'

/**
 * 通过 contextBridge 暴露给渲染进程的 API
 * 全部走 ipcRenderer.invoke（请求-响应）与事件监听两类通道
 */
contextBridge.exposeInMainWorld('tunnelApi', {
  /** 获取隧道列表与运行状态 */
  list: () => ipcRenderer.invoke('tunnel:list'),

  /** 新增隧道 */
  add: (tunnel) => ipcRenderer.invoke('tunnel:add', tunnel),

  /** 更新隧道配置 */
  update: (id, patch) => ipcRenderer.invoke('tunnel:update', { id, patch }),

  /** 删除隧道 */
  remove: (id) => ipcRenderer.invoke('tunnel:delete', id),

  /** 启动隧道 */
  start: (id) => ipcRenderer.invoke('tunnel:start', id),

  /** 停止隧道 */
  stop: (id) => ipcRenderer.invoke('tunnel:stop', id),

  /** 获取全部运行状态快照 */
  states: () => ipcRenderer.invoke('tunnel:states'),

  /** 导出隧道日志到本地文件 */
  exportLogs: (id) => ipcRenderer.invoke('tunnel:export-logs', id),

  /** 选择凭据文件（命名隧道） */
  pickCredentials: () => ipcRenderer.invoke('tunnel:pick-credentials'),

  /** 隧道状态变化事件：{ tunnelId, status, publicUrl } */
  onTunnelEvent: (callback) => {
    const listener = (_e, payload) => callback(payload)
    ipcRenderer.on('tunnel:event', listener)
    return () => ipcRenderer.removeListener('tunnel:event', listener)
  },

  /** 隧道日志事件：{ tunnelId, line } */
  onTunnelLog: (callback) => {
    const listener = (_e, payload) => callback(payload)
    ipcRenderer.on('tunnel:log', listener)
    return () => ipcRenderer.removeListener('tunnel:log', listener)
  }
})

contextBridge.exposeInMainWorld('appApi', {
  /** 读取设置 */
  getSettings: () => ipcRenderer.invoke('settings:get'),

  /** 更新设置 */
  setSettings: (patch) => ipcRenderer.invoke('settings:set', patch),

  /** 选择 cloudflared.exe 路径 */
  pickCloudflared: () => ipcRenderer.invoke('settings:pick-cloudflared'),

  /** 应用版本号 */
  getVersion: () => ipcRenderer.invoke('app:version'),

  /** 导出隧道配置到 JSON 文件 */
  exportConfig: () => ipcRenderer.invoke('config:export'),

  /** 从 JSON 文件导入隧道配置 */
  importConfig: () => ipcRenderer.invoke('config:import')
})

contextBridge.exposeInMainWorld('cfApi', {
  /** 查询授权状态：{ logined, cloudflaredHome } */
  loginStatus: () => ipcRenderer.invoke('cf:login-status'),

  /** 发起浏览器授权登录 */
  login: () => ipcRenderer.invoke('cf:login'),

  /** 取消登录流程 */
  loginCancel: () => ipcRenderer.invoke('cf:login-cancel'),

  /** 退出登录：删除授权凭据 cert.pem */
  logout: () => ipcRenderer.invoke('cf:logout'),

  /** 查询账号下的命名隧道列表 */
  listTunnels: () => ipcRenderer.invoke('cf:list-tunnels'),

  /** 创建命名隧道：返回 { id, name, credentialsPath } */
  createTunnel: (name) => ipcRenderer.invoke('cf:create-tunnel', name),

  /** 删除云端命名隧道 */
  deleteCloudTunnel: (tunnelId) => ipcRenderer.invoke('cf:delete-cloud-tunnel', tunnelId),

  /** 绑定 DNS 路由 */
  routeDns: (tunnelId, hostname) => ipcRenderer.invoke('cf:route-dns', { tunnelId, hostname }),

  /** 获取云端隧道绑定域名记录：{ tunnelId: hostname } */
  getDomainBindings: () => ipcRenderer.invoke('cf:get-domain-bindings'),

  /** 查询 cloudflared 版本：{ ok, version } */
  getVersion: () => ipcRenderer.invoke('cf:version'),

  /** login 过程事件：{ type: 'login-log'|'login-done', ... } */
  onEvent: (callback) => {
    const listener = (_e, payload) => callback(payload)
    ipcRenderer.on('cf:event', listener)
    return () => ipcRenderer.removeListener('cf:event', listener)
  }
})
