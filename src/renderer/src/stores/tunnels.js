import { defineStore } from 'pinia'

/**
 * 单条隧道日志在渲染进程内存中保留的最大行数
 */
const MAX_LOG_LINES = 500

/**
 * 隧道状态中文标签
 */
export const STATUS_TEXT = {
  starting: '启动中',
  running: '运行中',
  stopped: '已停止',
  error: '异常'
}

/**
 * 隧道管理全局状态
 */
export const useTunnelStore = defineStore('tunnels', {
  state: () => ({
    /** 隧道配置列表（持久化数据） */
    tunnels: [],
    /** 运行态：tunnelId -> { status, publicUrl, logs, pid, startedAt } */
    states: {},
    /** 是否已完成首次加载 */
    loaded: false
  }),

  getters: {
    /**
     * 运行中的隧道数量
     * @param {object} state - store 状态
     * @returns {number} 运行中数量
     */
    runningCount(state) {
      return Object.values(state.states).filter((s) => s.status === 'running' || s.status === 'starting').length
    }
  },

  actions: {
    /**
     * 初始化：加载列表、订阅主进程事件
     * @returns {Promise<void>}
     */
    async init() {
      try {
        await this.refresh()
      } catch (err) {
        console.error('加载隧道列表失败:', err)
      }
      window.tunnelApi.onTunnelEvent((payload) => {
        this.applyEvent(payload)
      })
      window.tunnelApi.onTunnelLog((payload) => {
        this.appendLog(payload.tunnelId, payload.line)
      })
      this.loaded = true
    },

    /**
     * 从主进程拉取最新列表与状态
     * @returns {Promise<void>}
     */
    async refresh() {
      const data = await window.tunnelApi.list()
      this.tunnels = data.tunnels
      // 合并状态：保留本地已有的日志内容
      for (const [id, s] of Object.entries(data.states)) {
        const local = this.states[id]
        this.states[id] = { ...s, logs: local ? local.logs : s.logs || [] }
      }
    },

    /**
     * 应用主进程推送的状态事件
     * @param {{tunnelId: string, status: string, publicUrl?: string, connCount?: number}} payload - 事件数据
     * @returns {void}
     */
    applyEvent(payload) {
      const { tunnelId, status, publicUrl, connCount } = payload
      const exist = this.states[tunnelId]
      if (exist) {
        exist.status = status
        if (publicUrl) {
          exist.publicUrl = publicUrl
        }
        if (connCount !== undefined) {
          exist.connCount = connCount
        }
        return
      }
      // 渲染进程尚未记录该状态（例如刚启动），补一条
      this.states[tunnelId] = {
        status,
        publicUrl: publicUrl || null,
        logs: [],
        pid: null,
        startedAt: Date.now(),
        connCount: connCount || 0
      }
    },

    /**
     * 追加一行日志（超出上限丢弃最旧行）
     * @param {string} tunnelId - 隧道 ID
     * @param {string} line - 日志行
     * @returns {void}
     */
    appendLog(tunnelId, line) {
      let state = this.states[tunnelId]
      if (!state) {
        state = { status: 'starting', publicUrl: null, logs: [], pid: null, startedAt: Date.now() }
        this.states[tunnelId] = state
      }
      state.logs.push(line)
      if (state.logs.length > MAX_LOG_LINES) {
        state.logs.shift()
      }
    },

    /**
     * 新增隧道
     * @param {object} tunnel - 隧道配置
     * @returns {Promise<{ok: boolean, message?: string}>} 结果
     */
    async add(tunnel) {
      try {
        const res = await window.tunnelApi.add(tunnel)
        if (res.ok) {
          this.tunnels.push(res.tunnel)
        }
        return res
      } catch (err) {
        return { ok: false, message: `添加失败：${err.message}` }
      }
    },

    /**
     * 更新隧道配置
     * @param {string} id - 隧道 ID
     * @param {object} patch - 变更项
     * @returns {Promise<{ok: boolean, message?: string}>} 结果
     */
    async update(id, patch) {
      try {
        const res = await window.tunnelApi.update(id, patch)
        if (res.ok) {
          const index = this.tunnels.findIndex((t) => t.id === id)
          if (index >= 0) {
            this.tunnels[index] = res.tunnel
          }
        }
        return res
      } catch (err) {
        return { ok: false, message: `更新失败：${err.message}` }
      }
    },

    /**
     * 删除隧道（运行中会先停止）
     * @param {string} id - 隧道 ID
     * @returns {Promise<{ok: boolean, message?: string}>} 结果
     */
    async remove(id) {
      try {
        const res = await window.tunnelApi.remove(id)
        if (res.ok) {
          this.tunnels = this.tunnels.filter((t) => t.id !== id)
          delete this.states[id]
        }
        return res
      } catch (err) {
        return { ok: false, message: `删除失败：${err.message}` }
      }
    },

    /**
     * 启动隧道
     * @param {string} id - 隧道 ID
     * @returns {Promise<{ok: boolean, message?: string}>} 结果
     */
    async start(id) {
      try {
        return await window.tunnelApi.start(id)
      } catch (err) {
        return { ok: false, message: `启动失败：${err.message}` }
      }
    },

    /**
     * 停止隧道
     * @param {string} id - 隧道 ID
     * @returns {Promise<{ok: boolean, message?: string}>} 结果
     */
    async stop(id) {
      try {
        return await window.tunnelApi.stop(id)
      } catch (err) {
        return { ok: false, message: `停止失败：${err.message}` }
      }
    }
  }
})
