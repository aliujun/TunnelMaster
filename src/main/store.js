import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

/** 数据文件名 */
const DATA_FILE = 'tunnelmaster-data.json'

/** 全量数据结构（内存缓存） */
let data = null

/**
 * 获取数据文件绝对路径
 * @returns {string} 数据文件路径
 */
function getDataFilePath() {
  return path.join(app.getPath('userData'), DATA_FILE)
}

/**
 * 提供默认配置，包括自动探测 cloudflared.exe 的候选路径
 * @returns {object} 默认数据结构
 */
function buildDefaultData() {
  const candidates = [
    path.resolve(app.getAppPath(), '../cloudflared/cloudflared.exe'),
    path.resolve(app.getAppPath(), 'cloudflared/cloudflared.exe')
  ]
  const found = candidates.find((p) => fs.existsSync(p))
  return {
    settings: {
      /** cloudflared 可执行文件路径，为空则尝试 PATH */
      cloudflaredPath: found || '',
      /** 关闭窗口时的行为：exit 直接退出，tray 最小化到托盘 */
      closeAction: 'exit',
      /** 是否开机自启 */
      launchAtLogin: false,
      /** 应用启动时是否自动恢复上次运行中的隧道 */
      restoreOnLaunch: true
    },
    tunnels: [],
    /** 云端隧道绑定域名记录：tunnelId -> hostname（tunnel list 不返回 DNS 信息，本地持久化用于显示） */
    domainBindings: {}
  }
}

/**
 * 将数据写入磁盘（先写临时文件再重命名，避免写一半损坏）
 * @param {object} dataToSave - 待持久化的数据
 * @returns {void}
 */
function flush(dataToSave) {
  const filePath = getDataFilePath()
  const tmpPath = filePath + '.tmp'
  fs.writeFileSync(tmpPath, JSON.stringify(dataToSave, null, 2), 'utf-8')
  fs.renameSync(tmpPath, filePath)
}

/**
 * 初始化存储：读取已有数据或生成默认数据
 * @returns {object} 当前全量数据
 */
function initStore() {
  const filePath = getDataFilePath()
  try {
    if (fs.existsSync(filePath)) {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
      // 与默认结构合并，保证新增字段有默认值
      const defaults = buildDefaultData()
      data = {
        settings: { ...defaults.settings, ...raw.settings },
        tunnels: Array.isArray(raw.tunnels) ? raw.tunnels : [],
        domainBindings: raw.domainBindings && typeof raw.domainBindings === 'object' ? raw.domainBindings : {}
      }
      return data
    }
  } catch (err) {
    // 数据文件损坏时回退到默认数据，避免应用无法启动
    console.error('[store] 读取数据文件失败，使用默认数据:', err.message)
  }
  data = buildDefaultData()
  flush(data)
  return data
}

/**
 * 读取全量数据
 * @returns {object} 全量数据（settings + tunnels）
 */
function getData() {
  if (!data) {
    return initStore()
  }
  return data
}

/**
 * 更新设置并持久化
 * @param {object} patch - 要合并的设置项
 * @returns {object} 合并后的完整设置
 */
function updateSettings(patch) {
  data.settings = { ...data.settings, ...patch }
  flush(data)
  return data.settings
}

/**
 * 保存隧道列表并持久化
 * @param {Array<object>} tunnels - 全量隧道数组
 * @returns {void}
 */
function saveTunnels(tunnels) {
  data.tunnels = tunnels
  flush(data)
}

/**
 * 生成新的隧道 ID
 * @returns {string} 唯一 ID
 */
function genId() {
  return `t_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * 记录云端隧道的绑定域名并持久化
 * @param {string} tunnelId - 云端隧道 UUID
 * @param {string} hostname - 绑定的域名
 * @returns {void}
 */
function setDomainBinding(tunnelId, hostname) {
  data.domainBindings[tunnelId] = hostname
  flush(data)
}

/**
 * 获取全部绑定域名记录
 * @returns {Object<string, string>} tunnelId -> hostname
 */
function getDomainBindings() {
  return data.domainBindings
}

export { initStore, getData, updateSettings, saveTunnels, genId, setDomainBinding, getDomainBindings }
