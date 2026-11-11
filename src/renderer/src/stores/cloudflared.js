import { defineStore } from 'pinia'
import { useTunnelStore } from './tunnels.js'

/**
 * cloudflared CLI 管理状态：授权、云端隧道列表
 */
export const useCloudflaredStore = defineStore('cloudflared', {
  state: () => ({
    /** 是否已完成 cloudflare 授权（cert.pem 存在） */
    logined: false,
    /** .cloudflared 配置目录 */
    cloudflaredHome: '',
    /** 云端命名隧道列表（tunnel list 原始数据） */
    cloudTunnels: [],
    /** 登录流程进行中标记 */
    loginLoading: false,
    /** 登录过程日志行 */
    loginLogs: [],
    /** 登录失败标记（失败时才展示过程日志） */
    loginFailed: false,
    /** 通用操作提示 */
    message: '',
    /** 列表查询中标记 */
    loading: false,
    /** 云端隧道绑定域名记录：tunnelId -> hostname */
    domainBindings: {}
  }),

  actions: {
    /**
     * 初始化：查询授权状态并订阅 CLI 事件
     * @returns {Promise<void>}
     */
    async init() {
      try {
        const res = await window.cfApi.loginStatus()
        this.logined = res.logined
        this.cloudflaredHome = res.cloudflaredHome
      } catch (err) {
        console.error('查询授权状态失败:', err)
      }
      try {
        this.domainBindings = await window.cfApi.getDomainBindings() || {}
      } catch (err) {
        console.error('查询绑定域名记录失败:', err)
      }
      window.cfApi.onEvent((payload) => {
        this.applyEvent(payload)
      })
    },

    /**
     * 应用主进程推送的 CLI 事件
     * @param {{type: string, lines?: string[], ok?: boolean}} payload - 事件数据
     * @returns {void}
     */
    applyEvent(payload) {
      if (payload.type === 'login-log') {
        this.loginLogs = this.loginLogs.concat(payload.lines || []).slice(-50)
        return
      }
      if (payload.type === 'login-done') {
        this.loginLoading = false
        this.logined = payload.ok === true
        // 仅登录失败时保留并展示过程日志，成功则清空
        if (payload.ok === true) {
          this.loginFailed = false
          this.loginLogs = []
          // 授权成功后自动刷新账号下的命名隧道
          this.refreshTunnels()
        } else {
          this.loginFailed = true
        }
      }
    },

    /**
     * 发起浏览器授权登录
     * @returns {Promise<{ok: boolean, message?: string}>} 结果
     */
    async login() {
      if (this.loginLoading) {
        return { ok: false, message: '登录流程进行中' }
      }
      this.loginLoading = true
      this.loginLogs = []
      this.loginFailed = false
      try {
        const res = await window.cfApi.login()
        // startLogin 授权成功时同步返回，此处状态已在事件中更新
        if (!res.ok) {
          this.loginLoading = false
        }
        this.message = res.message || ''
        return res
      } catch (err) {
        this.loginLoading = false
        return { ok: false, message: `登录失败：${err.message}` }
      }
    },

    /**
     * 取消登录流程
     * @returns {Promise<void>}
     */
    async cancelLogin() {
      try {
        await window.cfApi.loginCancel()
      } catch (err) {
        console.error('取消登录失败:', err)
      }
      this.loginLoading = false
    },

    /**
     * 退出登录：删除授权凭据 cert.pem 并刷新状态
     * @returns {Promise<{ok: boolean, message?: string}>} 结果
     */
    async logout() {
      try {
        const res = await window.cfApi.logout()
        if (res.ok) {
          this.logined = false
          this.cloudTunnels = []
        }
        return res
      } catch (err) {
        return { ok: false, message: `退出失败：${err.message}` }
      }
    },

    /**
     * 刷新云端隧道列表
     * @returns {Promise<{ok: boolean, message?: string}>} 结果
     */
    async refreshTunnels() {
      this.loading = true
      try {
        const res = await window.cfApi.listTunnels()
        if (res.ok) {
          this.cloudTunnels = res.tunnels
        } else {
          this.message = res.message
        }
        return res
      } catch (err) {
        return { ok: false, message: `刷新失败：${err.message}` }
      } finally {
        this.loading = false
      }
    },

    /**
     * 在云端创建命名隧道并刷新列表
     * @param {string} name - 隧道名称
     * @returns {Promise<{ok: boolean, message?: string, tunnel?: object}>} 结果
     */
    async createTunnel(name) {
      try {
        const res = await window.cfApi.createTunnel(name)
        if (res.ok) {
          await this.refreshTunnels()
        }
        return res
      } catch (err) {
        return { ok: false, message: `创建失败：${err.message}` }
      }
    },

    /**
     * 删除云端隧道并刷新列表
     * @param {string} tunnelId - 隧道 UUID
     * @returns {Promise<{ok: boolean, message?: string}>} 结果
     */
    async deleteCloudTunnel(tunnelId) {
      try {
        const res = await window.cfApi.deleteCloudTunnel(tunnelId)
        if (res.ok) {
          await this.refreshTunnels()
        }
        return res
      } catch (err) {
        return { ok: false, message: `删除失败：${err.message}` }
      }
    },

    /**
     * 为云端隧道绑定 DNS 路由
     * @param {string} tunnelId - 隧道 UUID
     * @param {string} hostname - 域名
     * @returns {Promise<{ok: boolean, message?: string}>} 结果
     */
    async routeDns(tunnelId, hostname) {
      try {
        const res = await window.cfApi.routeDns(tunnelId, hostname)
        // 绑定成功后同步本地记录，列表即时显示
        if (res.ok) {
          this.domainBindings = { ...this.domainBindings, [tunnelId]: hostname }
        }
        return res
      } catch (err) {
        return { ok: false, message: `绑定失败：${err.message}` }
      }
    },

    /**
     * 把云端隧道导入到本地隧道列表（默认生成指向 localhost:8080 的占位规则）
     * @param {object} cloudTunnel - tunnel list 返回的隧道对象
     * @returns {Promise<{ok: boolean, message?: string}>} 结果
     */
    async importTunnel(cloudTunnel) {
      const tunnelStore = useTunnelStore()
      const exists = tunnelStore.tunnels.some((t) => t.tunnelId === cloudTunnel.id)
      if (exists) {
        return { ok: false, message: '该隧道已在列表中' }
      }
      return tunnelStore.add({
        name: cloudTunnel.name,
        type: 'named',
        proto: 'http',
        host: 'localhost',
        port: 8080,
        tunnelId: cloudTunnel.id,
        credentialsPath: cloudTunnel.credentialsPath || '',
        domain: '',
        ingress: [{ hostname: '', service: 'http://localhost:8080' }]
      })
    }
  }
})
