import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import appIcon from '../../resources/icon.png?asset'
import {
  initStore,
  getData,
  updateSettings,
  saveTunnels,
  genId,
  setDomainBinding,
  getDomainBindings
} from './store.js'
import {
  setEventSender,
  startTunnel,
  stopTunnel,
  stopAll,
  getRunningStates,
  getLogs,
  clearEndedLogs,
  shutdown,
  restoreRunning
} from './process-manager.js'
import { createTray, destroyTray, isQuitting, setQuitting } from './tray.js'
import {
  setCliEventSender,
  getCloudflaredHome,
  isLogined,
  logout,
  startLogin,
  cancelLogin,
  listTunnels,
  createTunnel,
  deleteCloudTunnel,
  routeDns,
  getVersion
} from './cloudflared-cli.js'

/** 主窗口引用 */
let mainWindow = null

/**
 * 创建主窗口
 * @returns {void}
 */
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1080,
    height: 720,
    minWidth: 860,
    minHeight: 560,
    title: '隧道管家',
    icon: appIcon,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  setEventSender(mainWindow.webContents)
  setCliEventSender(mainWindow.webContents)

  // 关闭行为：设置为 tray 时隐藏到托盘而非退出
  mainWindow.on('close', (e) => {
    const closeAction = getData().settings.closeAction
    if (closeAction === 'tray' && !isQuitting()) {
      e.preventDefault()
      mainWindow.hide()
    }
  })

  // 外部链接一律用系统默认浏览器打开
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  // 开发模式加载 dev server，生产模式加载构建产物
  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'))
  }
}

/**
 * 校验隧道配置是否完整
 * @param {object} tunnel - 隧道配置
 * @returns {string|null} 错误信息，合法返回 null
 */
function validateTunnel(tunnel) {
  if (!tunnel || !tunnel.name || !tunnel.name.trim()) {
    return '隧道名称不能为空'
  }
  if (tunnel.type === 'quick' && !tunnel.port) {
    return '快速隧道必须填写本地端口'
  }
  if (tunnel.type === 'named') {
    if (!tunnel.tunnelId || !tunnel.tunnelId.trim()) {
      return '命名隧道必须填写隧道 ID'
    }
    // 配置了 ingress 规则时凭据写在 config.yml，可不在表单中单独填凭据路径
    const hasIngress = Array.isArray(tunnel.ingress) && tunnel.ingress.length > 0
    if (!hasIngress && (!tunnel.credentialsPath || !tunnel.credentialsPath.trim())) {
      return '命名隧道必须填写凭据文件路径或配置 ingress 规则'
    }
  }
  return null
}

/**
 * 注册全部 IPC 处理器
 * @returns {void}
 */
function registerIpc() {
  ipcMain.handle('tunnel:list', async () => {
    return { tunnels: getData().tunnels, states: getRunningStates() }
  })

  ipcMain.handle('tunnel:add', async (_e, tunnel) => {
    const err = validateTunnel(tunnel)
    if (err) {
      return { ok: false, message: err }
    }
    const item = {
      ...tunnel,
      id: genId(),
      createdAt: Date.now()
    }
    const data = getData()
    data.tunnels.push(item)
    saveTunnels(data.tunnels)
    return { ok: true, tunnel: item }
  })

  ipcMain.handle('tunnel:update', async (_e, { id, patch }) => {
    const data = getData()
    const tunnel = data.tunnels.find((t) => t.id === id)
    if (!tunnel) {
      return { ok: false, message: '隧道不存在' }
    }
    const merged = { ...tunnel, ...patch }
    const err = validateTunnel(merged)
    if (err) {
      return { ok: false, message: err }
    }
    Object.assign(tunnel, merged)
    saveTunnels(data.tunnels)
    return { ok: true, tunnel }
  })

  ipcMain.handle('tunnel:delete', async (_e, id) => {
    // 若在运行先停止
    stopTunnel(id)
    // 清理停止后的日志缓存，防止内存残留
    clearEndedLogs(id)
    const data = getData()
    const index = data.tunnels.findIndex((t) => t.id === id)
    if (index < 0) {
      return { ok: false, message: '隧道不存在' }
    }
    data.tunnels.splice(index, 1)
    saveTunnels(data.tunnels)
    return { ok: true }
  })

  ipcMain.handle('tunnel:start', async (_e, id) => {
    const tunnel = getData().tunnels.find((t) => t.id === id)
    if (!tunnel) {
      return { ok: false, message: '隧道不存在' }
    }
    return startTunnel(tunnel, getData().settings.cloudflaredPath)
  })

  ipcMain.handle('tunnel:stop', async (_e, id) => {
    return stopTunnel(id)
  })

  ipcMain.handle('tunnel:states', async () => {
    return getRunningStates()
  })

  ipcMain.handle('tunnel:export-logs', async (_e, id) => {
    const logs = getLogs(id)
    if (logs.length === 0) {
      return { ok: false, message: '没有可导出的日志' }
    }
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出隧道日志',
      defaultPath: `tunnelmaster-logs-${id}-${Date.now()}.txt`,
      filters: [{ name: '文本文件', extensions: ['txt'] }]
    })
    if (result.canceled || !result.filePath) {
      return { ok: false, message: '已取消' }
    }
    try {
      fs.writeFileSync(result.filePath, logs.join('\n'), 'utf-8')
      return { ok: true, message: `已导出到 ${result.filePath}` }
    } catch (err) {
      return { ok: false, message: `写入失败：${err.message}` }
    }
  })

  ipcMain.handle('tunnel:pick-credentials', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择隧道凭据 JSON 文件',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false }
    }
    return { ok: true, path: result.filePaths[0] }
  })

  ipcMain.handle('settings:get', async () => {
    return getData().settings
  })

  ipcMain.handle('settings:set', async (_e, patch) => {
    const result = updateSettings(patch)
    // 开机自启需要同步系统登录项
    if (patch && typeof patch.launchAtLogin === 'boolean') {
      applyLoginItemSettings(patch.launchAtLogin)
    }
    return result
  })

  ipcMain.handle('settings:pick-cloudflared', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择 cloudflared.exe',
      filters: [{ name: '可执行文件', extensions: ['exe'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false }
    }
    return { ok: true, path: result.filePaths[0] }
  })

  ipcMain.handle('app:version', async () => {
    return app.getVersion()
  })

  // ---------- cloudflared CLI 相关 ----------
  ipcMain.handle('cf:login-status', async () => {
    return { logined: isLogined(), cloudflaredHome: getCloudflaredHome() }
  })

  ipcMain.handle('cf:login', async () => {
    return startLogin(getData().settings.cloudflaredPath)
  })

  ipcMain.handle('cf:login-cancel', async () => {
    cancelLogin()
    return { ok: true }
  })

  ipcMain.handle('cf:logout', async () => {
    return logout()
  })

  ipcMain.handle('cf:list-tunnels', async () => {
    try {
      return await listTunnels(getData().settings.cloudflaredPath)
    } catch (err) {
      return { ok: false, message: `查询失败：${err.message}` }
    }
  })

  ipcMain.handle('cf:create-tunnel', async (_e, name) => {
    try {
      return await createTunnel(getData().settings.cloudflaredPath, name)
    } catch (err) {
      return { ok: false, message: `创建失败：${err.message}` }
    }
  })

  ipcMain.handle('cf:delete-cloud-tunnel', async (_e, tunnelId) => {
    try {
      return await deleteCloudTunnel(getData().settings.cloudflaredPath, tunnelId)
    } catch (err) {
      return { ok: false, message: `删除失败：${err.message}` }
    }
  })

  ipcMain.handle('cf:route-dns', async (_e, { tunnelId, hostname }) => {
    try {
      const res = await routeDns(getData().settings.cloudflaredPath, tunnelId, hostname)
      // 绑定成功后本地记录域名（tunnel list 不返回 DNS 信息，用于界面持久显示）
      if (res.ok) {
        setDomainBinding(tunnelId, hostname)
      }
      return res
    } catch (err) {
      return { ok: false, message: `绑定失败：${err.message}` }
    }
  })

  ipcMain.handle('cf:get-domain-bindings', async () => {
    return getDomainBindings()
  })

  ipcMain.handle('cf:version', async () => {
    try {
      return await getVersion(getData().settings.cloudflaredPath)
    } catch (err) {
      return { ok: false, message: `查询失败：${err.message}` }
    }
  })

  // ---------- 配置导入导出 ----------
  ipcMain.handle('config:export', async () => {
    const data = getData()
    // 导出副本：剥离运行态标记（shouldRun/createdAt 保留无妨，shouldRun 属于本机运行状态）
    const tunnels = data.tunnels.map((t) => {
      const { shouldRun, ...rest } = t
      return rest
    })
    // cloudflaredPath 与本机安装位置相关，不导出
    const { cloudflaredPath, ...exportSettings } = data.settings
    const payload = {
      app: 'tunnelmaster',
      version: 1,
      exportedAt: new Date().toISOString(),
      settings: exportSettings,
      tunnels
    }
    const now = new Date()
    const stamp = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
    const result = await dialog.showSaveDialog(mainWindow, {
      title: '导出隧道配置',
      defaultPath: `tunnelmaster-config-${stamp}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }]
    })
    if (result.canceled || !result.filePath) {
      return { ok: false, message: '已取消' }
    }
    try {
      fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf-8')
      return { ok: true, message: `已导出 ${tunnels.length} 条隧道配置到 ${result.filePath}` }
    } catch (err) {
      return { ok: false, message: `写入失败：${err.message}` }
    }
  })

  ipcMain.handle('config:import', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '导入隧道配置',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile']
    })
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, message: '已取消' }
    }
    let payload
    try {
      payload = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf-8'))
    } catch (err) {
      return { ok: false, message: `文件解析失败：${err.message}` }
    }
    // 结构校验：必须是隧道管家导出的配置文件
    if (!payload || payload.app !== 'tunnelmaster' || !Array.isArray(payload.tunnels)) {
      return { ok: false, message: '不是有效的隧道管家配置文件' }
    }
    const data = getData()
    let added = 0
    let skipped = 0
    for (const tunnel of payload.tunnels) {
      // 逐条校验，不合法的直接跳过
      if (validateTunnel(tunnel)) {
        skipped++
        continue
      }
      // 按 id 去重：已存在则跳过，避免重复导入
      if (data.tunnels.some((t) => t.id === tunnel.id)) {
        skipped++
        continue
      }
      const { shouldRun, ...rest } = tunnel
      data.tunnels.push({ ...rest, createdAt: tunnel.createdAt || Date.now() })
      added++
    }
    if (added > 0) {
      saveTunnels(data.tunnels)
    }
    return { ok: true, added, skipped, message: `导入完成：新增 ${added} 条，跳过 ${skipped} 条` }
  })
}

/**
 * 同步系统登录项（开机自启）
 * @param {boolean} enabled - 是否开机自启
 * @returns {void}
 */
function applyLoginItemSettings(enabled) {
  try {
    app.setLoginItemSettings({
      openAtLogin: enabled,
      path: process.execPath
    })
  } catch (err) {
    console.error('[main] 设置开机自启失败:', err.message)
  }
}

/**
 * 应用就绪：初始化存储、注册 IPC、创建窗口
 */
// 固定数据目录为 %APPDATA%/tunnelmaster：
// productName 已改为中文，Electron 默认的 userData 会跟随变化导致旧配置丢失
app.setPath('userData', path.join(app.getPath('appData'), 'tunnelmaster'))

app.whenReady().then(() => {
  try {
    initStore()
    registerIpc()
    createWindow()
    createTray(mainWindow)
    // 按持久化设置同步开机自启状态
    applyLoginItemSettings(getData().settings.launchAtLogin === true)
    // 启动恢复：自动拉起上次运行中的隧道
    const restored = restoreRunning()
    if (restored.started > 0) {
      console.log(`[main] 已自动恢复 ${restored.started} 条隧道`)
    }
  } catch (err) {
    console.error('[main] 初始化失败:', err)
    app.quit()
  }

  // macOS 惯例：点 Dock 图标且无窗口时重新创建
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

// 非 macOS 平台：窗口全部关闭即退出
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  setQuitting()
  shutdown()
  destroyTray()
})
