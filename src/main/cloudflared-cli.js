import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app } from 'electron'
import { getData, saveTunnels } from './store.js'

/** login 授权检测的轮询间隔（毫秒） */
const LOGIN_POLL_INTERVAL = 1000

/** login 授权检测的最长等待时间（毫秒） */
const LOGIN_POLL_MAX = 10 * 60 * 1000

/**
 * 当前正在执行的 login 进程（同一时间只允许一个）
 */
let loginProc = null

/** login 事件推送目标窗口 */
let cliSender = null

/**
 * 绑定事件推送目标
 * @param {Electron.WebContents} webContents - 主窗口 webContents
 * @returns {void}
 */
function setCliEventSender(webContents) {
  cliSender = webContents
}

/**
 * 向渲染进程推送 login 相关事件
 * @param {object} payload - 事件数据
 * @returns {void}
 */
function sendCliEvent(payload) {
  if (cliSender && !cliSender.isDestroyed()) {
    try {
      cliSender.send('cf:event', payload)
    } catch (err) {
      console.error('[cli] 推送事件失败:', err.message)
    }
  }
}

/**
 * 获取 .cloudflared 目录路径（证书与凭据默认所在目录）
 * @returns {string} 目录绝对路径
 */
function getCloudflaredHome() {
  return path.join(os.homedir(), '.cloudflared')
}

/**
 * 检测是否已完成 cloudflare login 授权
 * @returns {boolean} cert.pem 是否存在
 */
function isLogined() {
  return fs.existsSync(path.join(getCloudflaredHome(), 'cert.pem'))
}

/**
 * 退出登录：删除授权凭据 cert.pem
 * 不影响已创建隧道及其凭据 JSON，仅失去管理操作能力（创建/删除/绑定 DNS）
 * @returns {{ok: boolean, message: string}} 删除结果
 */
function logout() {
  const certPath = path.join(getCloudflaredHome(), 'cert.pem')
  if (!fs.existsSync(certPath)) {
    return { ok: false, message: '当前未登录' }
  }
  try {
    fs.rmSync(certPath)
    return { ok: true, message: '已退出登录' }
  } catch (err) {
    return { ok: false, message: `退出失败：${err.message}` }
  }
}

/**
 * 执行一次性 cloudflared 命令并收集输出
 * @param {string} bin - cloudflared 可执行文件路径
 * @param {string[]} args - 参数数组
 * @returns {Promise<{code: number, stdout: string, stderr: string}>} 执行结果
 */
function runCli(bin, args) {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let proc
    try {
      proc = spawn(bin, args, { windowsHide: true })
    } catch (err) {
      return resolve({ code: -1, stdout: '', stderr: err.message })
    }
    proc.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })
    proc.on('error', (err) => {
      resolve({ code: -1, stdout, stderr: stderr + err.message })
    })
    proc.on('close', (code) => {
      resolve({ code: code ?? -1, stdout, stderr })
    })
  })
}

/**
 * 发起浏览器授权登录：打开浏览器，轮询等待 cert.pem 出现
 * @param {string} bin - cloudflared 可执行文件路径
 * @returns {Promise<{ok: boolean, message: string, logLines?: string[]}>} 结果
 */
function startLogin(bin) {
  if (loginProc) {
    return Promise.resolve({ ok: false, message: '已有登录流程进行中' })
  }
  if (isLogined()) {
    return Promise.resolve({ ok: true, message: '已完成授权，无需重复登录' })
  }

  return new Promise((resolve) => {
    let collected = []
    try {
      loginProc = spawn(bin, ['tunnel', 'login'], { windowsHide: true })
    } catch (err) {
      loginProc = null
      return resolve({ ok: false, message: `启动登录失败：${err.message}` })
    }

    // 收集登录过程中的日志供前端展示
    for (const stream of [loginProc.stdout, loginProc.stderr]) {
      stream.on('data', (chunk) => {
        const lines = chunk.toString().split('\n').map((s) => s.trim()).filter(Boolean)
        collected = collected.concat(lines).slice(-50)
        sendCliEvent({ type: 'login-log', lines })
      })
    }

    loginProc.on('close', () => {
      if (!loginProc) {
        return
      }
      loginProc = null
      if (!isLogined()) {
        sendCliEvent({ type: 'login-done', ok: false })
      }
    })

    // 轮询等待用户在浏览器完成授权
    const startedAt = Date.now()
    const timer = setInterval(() => {
      const expired = Date.now() - startedAt > LOGIN_POLL_MAX
      if (isLogined()) {
        clearInterval(timer)
        const proc = loginProc
        loginProc = null
        // 授权完成后 login 进程会自行退出，这里提前断开引用避免触发失败事件
        if (proc) {
          proc.removeAllListeners('close')
          proc.kill()
        }
        sendCliEvent({ type: 'login-done', ok: true })
        resolve({ ok: true, message: '授权成功', logLines: collected })
        return
      }
      if (expired || !loginProc) {
        clearInterval(timer)
        resolve({ ok: false, message: '登录超时或被取消' })
      }
    }, LOGIN_POLL_INTERVAL)

    // resolve 后轮询定时器仍可能残留，超时兜底清理
    setTimeout(() => {
      clearInterval(timer)
    }, LOGIN_POLL_MAX + 5000)
  })
}

/**
 * 取消进行中的登录流程
 * @returns {void}
 */
function cancelLogin() {
  if (!loginProc) {
    return
  }
  const proc = loginProc
  loginProc = null
  proc.removeAllListeners('close')
  proc.kill()
  sendCliEvent({ type: 'login-done', ok: false })
}

/**
 * 查询账号下的全部命名隧道
 * @param {string} bin - cloudflared 可执行文件路径
 * @returns {Promise<{ok: boolean, message?: string, tunnels?: Array<object>}>} 隧道列表
 */
async function listTunnels(bin) {
  if (!isLogined()) {
    return { ok: false, message: '尚未完成 cloudflare 授权' }
  }
  const res = await runCli(bin, ['tunnel', 'list', '--output', 'json'])
  if (res.code !== 0) {
    return { ok: false, message: `查询失败：${res.stderr || res.stdout}` }
  }
  try {
    const tunnels = JSON.parse(res.stdout)
    // JSON 输出不含凭据路径，按约定位置补充（存在才填）
    for (const item of tunnels) {
      const credPath = path.join(getCloudflaredHome(), `${item.id}.json`)
      if (fs.existsSync(credPath)) {
        item.credentialsPath = credPath
      }
    }
    return { ok: true, tunnels }
  } catch (err) {
    return { ok: false, message: `解析输出失败：${err.message}` }
  }
}

/**
 * 创建命名隧道（凭据文件默认生成在 ~/.cloudflared/<id>.json）
 * @param {string} bin - cloudflared 可执行文件路径
 * @param {string} name - 隧道名称
 * @returns {Promise<{ok: boolean, message: string, tunnel?: object}>} 创建结果
 */
async function createTunnel(bin, name) {
  if (!isLogined()) {
    return { ok: false, message: '请先在「cloudflared 管理」页完成授权登录' }
  }
  if (!name || !name.trim()) {
    return { ok: false, message: '隧道名称不能为空' }
  }
  const res = await runCli(bin, ['tunnel', 'create', '--output', 'json', name.trim()])
  if (res.code !== 0) {
    return { ok: false, message: `创建失败：${res.stderr || res.stdout}` }
  }
  try {
    const created = JSON.parse(res.stdout)
    const credentialsPath = path.join(getCloudflaredHome(), `${created.id}.json`)
    return { ok: true, message: '创建成功', tunnel: { id: created.id, name: created.name, credentialsPath } }
  } catch (err) {
    return { ok: false, message: `解析输出失败：${err.message}` }
  }
}

/**
 * 删除命名隧道
 * @param {string} bin - cloudflared 可执行文件路径
 * @param {string} tunnelId - 隧道 UUID
 * @returns {Promise<{ok: boolean, message: string}>} 结果
 */
async function deleteCloudTunnel(bin, tunnelId) {
  if (!isLogined()) {
    return { ok: false, message: '尚未完成 cloudflare 授权' }
  }
  const res = await runCli(bin, ['tunnel', 'delete', '-f', tunnelId])
  if (res.code !== 0) {
    return { ok: false, message: `删除失败：${res.stderr || res.stdout}` }
  }
  return { ok: true, message: '删除成功' }
}

/**
 * 为隧道绑定 DNS 路由（CNAME 指向隧道）
 * @param {string} bin - cloudflared 可执行文件路径
 * @param {string} tunnelId - 隧道 UUID
 * @param {string} hostname - 绑定的域名
 * @returns {Promise<{ok: boolean, message: string}>} 结果
 */
async function routeDns(bin, tunnelId, hostname) {
  if (!isLogined()) {
    return { ok: false, message: '尚未完成 cloudflare 授权' }
  }
  if (!hostname || !hostname.trim()) {
    return { ok: false, message: '域名不能为空' }
  }
  const res = await runCli(bin, ['tunnel', 'route', 'dns', tunnelId, hostname.trim()])
  if (res.code !== 0) {
    return { ok: false, message: `绑定失败：${res.stderr || res.stdout}` }
  }
  return { ok: true, message: `已绑定 ${hostname.trim()}` }
}

/**
 * 检测 cloudflared 版本（执行 --version 并解析）
 * @param {string} bin - cloudflared 可执行文件路径
 * @returns {Promise<{ok: boolean, version?: string, message?: string}>} 版本信息
 */
async function getVersion(bin) {
  const res = await runCli(bin, ['--version'])
  if (res.code !== 0) {
    return { ok: false, message: `版本查询失败：${res.stderr || res.stdout}` }
  }
  // 输出形如 "cloudflared version 2024.10.0 (built ...)"
  const match = (res.stdout || '').match(/version\s+(\S+)/i)
  if (!match) {
    return { ok: false, message: `无法解析版本号：${res.stdout || res.stderr}` }
  }
  return { ok: true, version: match[1] }
}

/**
 * 生成命名隧道使用的 config.yml 并写入应用数据目录
 * @param {object} tunnel - 隧道配置（含 id/tunnelId/credentialsPath/ingress）
 * @returns {{ok: boolean, message: string, configPath?: string}} 生成结果
 */
function generateIngressConfig(tunnel) {
  const rules = Array.isArray(tunnel.ingress) ? tunnel.ingress.filter((r) => r && r.service) : []
  if (rules.length === 0) {
    return { ok: false, message: '至少需要一条 ingress 规则' }
  }
  const lines = [`tunnel: ${tunnel.tunnelId}`]
  if (tunnel.credentialsPath) {
    lines.push(`credentials-file: '${tunnel.credentialsPath}'`)
  }
  lines.push('ingress:')
  for (const rule of rules) {
    if (rule.hostname) {
      lines.push(`  - hostname: ${rule.hostname}`)
    }
    lines.push(`    service: ${rule.service}`)
  }
  // cloudflared 要求最后一条为兜底规则
  const last = rules[rules.length - 1]
  if (last.hostname || !last.service.startsWith('http_status')) {
    lines.push('  - service: http_status:404')
  }

  const dir = path.join(app.getPath('userData'), 'tunnel-configs')
  try {
    fs.mkdirSync(dir, { recursive: true })
    const configPath = path.join(dir, `${tunnel.id}.yml`)
    fs.writeFileSync(configPath, lines.join('\n'), 'utf-8')
    return { ok: true, message: '生成成功', configPath }
  } catch (err) {
    return { ok: false, message: `写入配置失败：${err.message}` }
  }
}

export {
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
  generateIngressConfig,
  getVersion
}
