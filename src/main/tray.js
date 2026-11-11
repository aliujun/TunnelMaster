import { Tray, Menu, nativeImage, app } from 'electron'
import iconUrl from '../../resources/icon.png?asset'
import { getData } from './store.js'
import { getRunningStates, startTunnel, stopTunnel, onStateChange } from './process-manager.js'

/** 托盘实例 */
let tray = null

/** 主窗口引用（托盘点击时显示） */
let win = null

/**
 * 状态对应的菜单图标文字（● 绿/红 用文字替代，避免引入额外图标资源）
 */
const STATUS_LABEL = {
  starting: '启动中',
  running: '运行中',
  stopped: '已停止',
  error: '异常'
}

/**
 * 加载托盘图标
 * @returns {Electron.NativeImage} 图标
 */
function loadIcon() {
  const icon = nativeImage.createFromPath(iconUrl)
  // Windows 托盘建议 16x16 大小
  return icon.resize({ width: 16, height: 16 })
}

/**
 * 显示主窗口（托盘点击）
 * @returns {void}
 */
function showMainWindow() {
  if (!win || win.isDestroyed()) {
    return
  }
  if (win.isMinimized()) {
    win.restore()
  }
  win.show()
  win.focus()
}

/**
 * 根据当前隧道状态重建托盘菜单
 * @returns {void}
 */
function rebuildMenu() {
  if (!tray) {
    return
  }
  const tunnels = getData().tunnels
  const states = getRunningStates()

  const tunnelItems = tunnels.map((tunnel) => {
    const state = states[tunnel.id]
    const status = state ? state.status : 'stopped'
    const runningNow = status === 'running' || status === 'starting'
    return {
      label: `${runningNow ? '●' : '○'} ${tunnel.name}（${STATUS_LABEL[status] || status}）`,
      // 点击即切换启停
      click: () => {
        if (runningNow) {
          stopTunnel(tunnel.id)
        } else {
          startTunnel(tunnel, getData().settings.cloudflaredPath)
        }
      }
    }
  })

  const runningCount = Object.values(states).filter(
    (s) => s.status === 'running' || s.status === 'starting'
  ).length

  const menu = Menu.buildFromTemplate([
    { label: '打开隧道管家', click: showMainWindow },
    { type: 'separator' },
    ...(tunnelItems.length > 0
      ? tunnelItems
      : [{ label: '暂无隧道', enabled: false }]),
    { type: 'separator' },
    {
      label: `全部停止${runningCount > 0 ? `（${runningCount}）` : ''}`,
      enabled: runningCount > 0,
      click: () => {
        for (const id of Object.keys(states)) {
          stopTunnel(id)
        }
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        // 标记为主动退出，让关闭行为放行
        setQuitting()
        app.quit()
      }
    }
  ])

  tray.setContextMenu(menu)
  tray.setToolTip(`隧道管家（运行中 ${runningCount}/${tunnels.length}）`)
}

/** 是否正在退出应用（供主窗口 close 事件判断） */
let quitting = false

/**
 * 标记应用正在退出（退出时关闭窗口不再隐藏到托盘）
 * @returns {void}
 */
function setQuitting() {
  quitting = true
}

/**
 * 是否处于退出流程
 * @returns {boolean} 是否正在退出
 */
function isQuitting() {
  return quitting
}

/**
 * 创建系统托盘并注册状态监听
 * @param {Electron.BrowserWindow} mainWindow - 主窗口
 * @returns {void}
 */
function createTray(mainWindow) {
  win = mainWindow
  tray = new Tray(loadIcon())
  rebuildMenu()
  // 隧道状态变化时刷新菜单
  onStateChange(rebuildMenu)
  // Windows 单击托盘图标显示主窗口
  tray.on('click', showMainWindow)
}

/**
 * 销毁托盘（应用退出前调用）
 * @returns {void}
 */
function destroyTray() {
  if (tray) {
    tray.destroy()
    tray = null
  }
}

export { createTray, destroyTray, isQuitting, setQuitting }
