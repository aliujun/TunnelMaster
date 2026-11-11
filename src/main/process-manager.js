import { spawn } from 'node:child_process'
import { getData, saveTunnels } from './store.js'
import { generateIngressConfig } from './cloudflared-cli.js'

/**
 * 每条日志缓冲区保留的最大行数（超出即丢弃最旧行，防止内存无限增长）
 */
const MAX_LOG_LINES = 1000

/**
 * 崩溃自动重启的默认参数
 */
const DEFAULT_MAX_RETRIES = 5
const DEFAULT_RETRY_DELAY = 3000

/**
 * 运行态：tunnelId -> 运行上下文
 * @type {Map<string, object>}
 */
const running = new Map()

/**
 * 结束日志缓存：tunnelId -> 日志数组（隧道停止/异常退出后保留，供导出）
 * @type {Map<string, string[]>}
 */
const endedLogs = new Map()

/** 事件推送目标窗口（webContents） */
let eventSender = null

/** 是否正在退出应用（退出过程中不再修改 shouldRun 标记，保留以便下次启动恢复） */
let shuttingDown = false

/** 状态变化回调列表（托盘菜单刷新用） */
const stateChangeCallbacks = []

/**
 * 注册状态变化监听器
 * @param {Function} cb - 回调函数，无参数，收到后需自行拉取快照
 * @returns {void}
 */
function onStateChange(cb) {
  stateChangeCallbacks.push(cb)
}

/**
 * 通知所有状态变化监听器
 * @returns {void}
 */
function notifyStateChange() {
  for (const cb of stateChangeCallbacks) {
    try {
      cb()
    } catch (err) {
      console.error('[process] 状态回调执行失败:', err.message)
    }
  }
}

/**
 * 将"期望运行"标记持久化到隧道配置
 * @param {object} tunnel - 隧道配置
 * @param {boolean} shouldRun - 是否期望在应用启动时自动运行
 * @returns {void}
 */
function persistShouldRun(tunnel, shouldRun) {
  if (shuttingDown || !tunnel) {
    return
  }
  tunnel.shouldRun = shouldRun
  saveTunnels(getData().tunnels)
}

/**
 * 绑定事件推送目标，用于向渲染进程转发状态与日志
 * @param {Electron.WebContents} webContents - 主窗口 webContents
 * @returns {void}
 */
function setEventSender(webContents) {
  eventSender = webContents
}

/**
 * 向渲染进程推送事件
 * @param {string} channel - IPC 频道名
 * @param {object} payload - 事件数据
 * @returns {void}
 */
function sendEvent(channel, payload) {
  if (eventSender && !eventSender.isDestroyed()) {
    try {
      eventSender.send(channel, payload)
    } catch (err) {
      console.error('[process] 推送事件失败:', err.message)
    }
  }
}

/**
 * 推送隧道状态变化（附带边缘连接数）
 * @param {object} state - 运行态
 * @param {string} status - 新状态：starting/running/stopped/error
 * @param {string} [publicUrl] - 快速隧道解析出的公网地址
 * @returns {void}
 */
function emitStatus(state, status, publicUrl) {
  state.status = status
  sendEvent('tunnel:event', {
    tunnelId: state.config.id,
    status,
    publicUrl,
    connCount: state.conns.size
  })
  notifyStateChange()
}

/**
 * 推送一行日志到渲染进程并写入环形缓冲区
 * @param {object} state - 运行态
 * @param {string} line - 日志行
 * @returns {void}
 */
function pushLog(state, line) {
  state.logs.push(line)
  if (state.logs.length > MAX_LOG_LINES) {
    state.logs.shift()
  }
  sendEvent('tunnel:log', { tunnelId: state.config.id, line })
}

/**
 * 解析快速隧道输出中的 trycloudflare 公网地址
 * @param {string} line - cloudflared 日志行
 * @returns {string|null} 解析出的 URL，未匹配返回 null
 */
function parseQuickUrl(line) {
  const match = line.match(/https:\/\/[a-z0-9][a-z0-9-]*\.trycloudflare\.com/i)
  return match ? match[0] : null
}

/**
 * 解析边缘连接注册/注销事件，维护连接数
 * @param {object} state - 运行态
 * @param {string} line - cloudflared 日志行
 * @returns {boolean} 本行是否包含连接事件
 */
function trackConnection(state, line) {
  const reg = line.match(/Registered tunnel connection connIndex=(\d+)/i)
  if (reg) {
    state.conns.add(reg[1])
    if (state.status !== 'running') {
      emitStatus(state, 'running')
    }
    emitStatus(state, state.status)
    return true
  }
  const unreg = line.match(/Unregistered tunnel connection connIndex=(\d+)/i)
  if (unreg) {
    state.conns.delete(unreg[1])
    emitStatus(state, state.status)
    return true
  }
  return false
}

/**
 * 根据隧道配置构造 cloudflared 启动参数
 * @param {object} tunnel - 隧道配置
 * @returns {{ok: boolean, args?: string[], message?: string}} 参数构造结果
 */
function buildArgs(tunnel) {
  if (tunnel.type === 'quick') {
    const target = `${tunnel.proto || 'http'}://${tunnel.host || 'localhost'}:${tunnel.port}`
    const args = ['tunnel', '--url', target]
    // https 本地服务通常使用自签证书，追加跳过校验参数
    if ((tunnel.proto || 'http') === 'https') {
      args.push('--no-tls-verify')
    }
    return { ok: true, args }
  }
  // 命名隧道：配置了 ingress 规则则生成 config.yml 运行
  // 注意：--config 是 tunnel 命令的选项，必须放在 run 子命令之前
  if (Array.isArray(tunnel.ingress) && tunnel.ingress.length > 0) {
    const gen = generateIngressConfig(tunnel)
    if (!gen.ok) {
      return { ok: false, message: gen.message }
    }
    return { ok: true, args: ['tunnel', '--config', gen.configPath, 'run', tunnel.tunnelId] }
  }
  // 命名隧道兜底：凭据文件 + 单条本地服务映射
  if (!tunnel.tunnelId || !tunnel.credentialsPath) {
    return { ok: false, message: '命名隧道需要填写隧道 ID 和凭据文件路径' }
  }
  const args = ['tunnel', 'run', '--credfile', tunnel.credentialsPath, tunnel.tunnelId]
  if (tunnel.port) {
    args.push('--url', `${tunnel.proto || 'http'}://${tunnel.host || 'localhost'}:${tunnel.port}`)
  }
  return { ok: true, args }
}

/**
 * 处理子进程退出：区分手动停止与异常退出，异常时按配置自动重启
 * @param {object} tunnel - 隧道配置
 * @param {object} state - 运行态
 * @param {number} code - 退出码
 * @returns {void}
 */
function handleExit(tunnel, state, code) {
  state.proc = null
  // 清空边缘连接计数（进程退出后旧连接全部失效），避免界面残留
  state.conns.clear()
  const isError = code !== 0 && code !== null

  // 手动停止：taskkill /F 强杀退出码为 1，但这是预期行为，应显示"已停止"
  if (state.manualStop) {
    state.status = 'stopped'
    pushLog(state, '[隧道管家] 已手动停止')
    emitStatus(state, 'stopped')
    persistShouldRun(tunnel, false)
    endedLogs.set(tunnel.id, state.logs.slice())
    running.delete(tunnel.id)
    return
  }

  // 未启用自动重启（仅显式关闭时生效，旧配置默认开启）或正常退出（退出码 0）
  if (tunnel.autoRestart === false || !isError) {
    state.status = isError ? 'error' : 'stopped'
    pushLog(state, `[隧道管家] 进程已退出，退出码：${code}`)
    emitStatus(state, state.status)
    persistShouldRun(tunnel, false)
    endedLogs.set(tunnel.id, state.logs.slice())
    running.delete(tunnel.id)
    return
  }

  const maxRetries = tunnel.maxRetries || DEFAULT_MAX_RETRIES
  // 重试次数已用完：标记异常
  if (state.retries >= maxRetries) {
    state.status = 'error'
    pushLog(state, `[隧道管家] 自动重启次数已达上限（${maxRetries} 次），停止重启`)
    emitStatus(state, 'error')
    persistShouldRun(tunnel, false)
    endedLogs.set(tunnel.id, state.logs.slice())
    running.delete(tunnel.id)
    return
  }

  // 计划一次自动重启
  state.retries++
  const delay = tunnel.retryDelay || DEFAULT_RETRY_DELAY
  pushLog(state, `[隧道管家] 进程异常退出（退出码 ${code}），${delay / 1000} 秒后自动重启（第 ${state.retries}/${maxRetries} 次）`)
  emitStatus(state, 'starting')

  setTimeout(() => {
    // 重启前校验：未被手动停止、未被删除、仍是同一个运行上下文
    const current = running.get(tunnel.id)
    if (!current || current !== state || current.manualStop) {
      return
    }
    const bin = getData().settings.cloudflaredPath || 'cloudflared'
    spawnProc(tunnel, state, bin)
  }, delay)
}

/**
 * 将 cloudflared 子进程拉起并挂接到运行态（启动与自动重启共用）
 * @param {object} tunnel - 隧道配置
 * @param {object} state - 运行态
 * @param {string} bin - cloudflared 可执行文件路径
 * @returns {{ok: boolean, message: string}} 启动结果
 */
function spawnProc(tunnel, state, bin) {
  const prepared = buildArgs(tunnel)
  if (!prepared.ok) {
    running.delete(tunnel.id)
    emitStatus(state, 'error')
    return { ok: false, message: prepared.message }
  }

  let proc
  try {
    proc = spawn(bin, prepared.args, { windowsHide: true })
  } catch (err) {
    running.delete(tunnel.id)
    emitStatus(state, 'error')
    return { ok: false, message: `启动失败：${err.message}` }
  }

  state.proc = proc
  state.pid = proc.pid
  state.manualStop = false

  proc.on('error', (err) => {
    pushLog(state, `[隧道管家] 进程错误：${err.message}`)
  })

  // 按行拆分 stdout / stderr（cloudflared 日志主要输出到 stderr）
  for (const stream of [proc.stdout, proc.stderr]) {
    let buffer = ''
    stream.on('data', (chunk) => {
      buffer += chunk.toString()
      let idx
      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim()
        buffer = buffer.slice(idx + 1)
        if (!line) {
          continue
        }
        pushLog(state, line)
        // 快速隧道：解析出公网地址即视为运行中
        const url = parseQuickUrl(line)
        if (tunnel.type === 'quick' && url) {
          state.publicUrl = url
          state.retries = 0
          emitStatus(state, 'running', url)
          continue
        }
        // 连接事件：维护连接数，首个连接注册即视为运行中
        trackConnection(state, line)
      }
    })
  }

  proc.on('close', (code) => handleExit(tunnel, state, code))

  pushLog(state, `[隧道管家] 已启动进程，PID：${proc.pid}`)
  return { ok: true, message: '启动成功' }
}

/**
 * 启动一条隧道
 * @param {object} tunnel - 隧道配置（含 id/type/port 等）
 * @param {string} cloudflaredPath - cloudflared 可执行文件路径
 * @returns {{ok: boolean, message: string, status?: string}} 启动结果
 */
function startTunnel(tunnel, cloudflaredPath) {
  if (running.has(tunnel.id)) {
    return { ok: false, message: '该隧道已在运行中' }
  }
  const hasIngress = Array.isArray(tunnel.ingress) && tunnel.ingress.length > 0
  if (tunnel.type === 'named' && !tunnel.tunnelId) {
    return { ok: false, message: '命名隧道需要填写隧道 ID' }
  }
  if (tunnel.type === 'named' && !hasIngress && !tunnel.credentialsPath) {
    return { ok: false, message: '命名隧道需要填写凭据文件路径或配置 ingress 规则' }
  }
  const bin = cloudflaredPath || 'cloudflared'
  // 重新启动后旧的结束日志不再有意义，清空缓存
  endedLogs.delete(tunnel.id)

  const state = {
    config: tunnel,
    proc: null,
    pid: null,
    status: 'starting',
    logs: [],
    publicUrl: null,
    startedAt: Date.now(),
    retries: 0,
    manualStop: false,
    conns: new Set()
  }
  running.set(tunnel.id, state)
  emitStatus(state, 'starting')

  const result = spawnProc(tunnel, state, bin)
  // 启动成功后记录"期望运行"标记，供下次启动恢复
  if (result.ok) {
    persistShouldRun(tunnel, true)
  }
  return result
}

/**
 * 停止一条隧道（Windows 下使用 taskkill 终止整棵进程树）
 * @param {string} tunnelId - 隧道 ID
 * @returns {{ok: boolean, message: string}} 停止结果
 */
function stopTunnel(tunnelId) {
  const state = running.get(tunnelId)
  if (!state || !state.proc) {
    return { ok: false, message: '该隧道未在运行' }
  }
  // 标记手动停止，抑制自动重启
  state.manualStop = true
  // 清除"期望运行"标记（退出过程中跳过，保留给下次启动恢复）
  persistShouldRun(getData().tunnels.find((t) => t.id === tunnelId), false)
  const pid = state.pid
  try {
    // /T 终止子进程树，/F 强制终止
    const killer = spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true })
    killer.on('error', () => {
      // taskkill 失败时退回直接 kill
      state.proc?.kill()
    })
  } catch (err) {
    state.proc?.kill()
    console.error('[process] 停止进程失败:', err.message)
  }
  return { ok: true, message: '停止命令已发送' }
}

/**
 * 停止全部运行中的隧道
 * @returns {void}
 */
function stopAll() {
  for (const tunnelId of running.keys()) {
    stopTunnel(tunnelId)
  }
}

/**
 * 获取全部运行态快照（供渲染进程刷新）
 * @returns {Object<string, object>} tunnelId -> 运行态
 */
function getRunningStates() {
  const snapshot = {}
  for (const [tunnelId, state] of running.entries()) {
    snapshot[tunnelId] = {
      status: state.status,
      publicUrl: state.publicUrl,
      logs: state.logs,
      pid: state.pid,
      startedAt: state.startedAt,
      connCount: state.conns.size,
      retries: state.retries
    }
  }
  return snapshot
}

/**
 * 获取指定隧道的日志副本（用于导出）
 * @param {string} tunnelId - 隧道 ID
 * @returns {string[]} 日志行数组
 */
function getLogs(tunnelId) {
  const state = running.get(tunnelId)
  if (state) {
    return state.logs.slice()
  }
  // 隧道已停止：回退到结束日志缓存
  return endedLogs.get(tunnelId) || []
}

/**
 * 清除指定隧道的结束日志缓存（删除隧道时调用，防止内存残留）
 * @param {string} tunnelId - 隧道 ID
 * @returns {void}
 */
function clearEndedLogs(tunnelId) {
  endedLogs.delete(tunnelId)
}

/**
 * 应用退出前清理：终止全部子进程，保留 shouldRun 标记供下次启动恢复
 * @returns {void}
 */
function shutdown() {
  shuttingDown = true
  stopAll()
}

/**
 * 应用启动时恢复上次运行中的隧道（根据 shouldRun 标记）
 * @returns {{started: number}} 本次恢复启动的隧道数量
 */
function restoreRunning() {
  const data = getData()
  if (data.settings.restoreOnLaunch === false) {
    return { started: 0 }
  }
  let started = 0
  for (const tunnel of data.tunnels) {
    if (tunnel.shouldRun !== true) {
      continue
    }
    if (running.has(tunnel.id)) {
      continue
    }
    const result = startTunnel(tunnel, data.settings.cloudflaredPath)
    if (result.ok) {
      started++
    } else {
      // 恢复失败时清除标记，避免每次启动都重复尝试
      persistShouldRun(tunnel, false)
      console.error(`[process] 恢复隧道失败（${tunnel.name}）:`, result.message)
    }
  }
  return { started }
}

export { setEventSender, startTunnel, stopTunnel, stopAll, getRunningStates, getLogs, clearEndedLogs, shutdown, restoreRunning, onStateChange }
