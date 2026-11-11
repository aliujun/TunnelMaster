<script setup>
/**
 * cloudflared 管理页：授权登录、云端隧道列表（导入/绑定域名/删除/新建）
 */
import { ref, onMounted, onUnmounted } from 'vue'
import { useCloudflaredStore } from '../stores/cloudflared.js'

const store = useCloudflaredStore()

/** 新建云端隧道的名称输入 */
const newName = ref('')

/** 绑定域名的弹窗状态 */
const routeModal = ref(null)

/** 绑定域名输入 */
const routeHostname = ref('')

/** 删除云端隧道的确认状态 */
const confirmDeleteId = ref('')

/** 退出登录确认弹窗是否显示 */
const showLogoutModal = ref(false)

/** 操作提示 */
const localMsg = ref('')

/**
 * 展示一次性提示信息
 * @param {string} msg - 提示文本
 * @returns {void}
 */
function showMsg(msg) {
  localMsg.value = msg
  setTimeout(() => {
    if (localMsg.value === msg) {
      localMsg.value = ''
    }
  }, 4000)
}

/**
 * 发起授权登录
 * @returns {Promise<void>}
 */
async function doLogin() {
  const res = await store.login()
  if (!res.ok && !store.loginLoading) {
    showMsg(res.message)
  }
}

/**
 * 打开退出登录确认弹窗
 * @returns {void}
 */
function openLogoutModal() {
  showLogoutModal.value = true
}

/**
 * 确认退出登录：删除授权凭据 cert.pem 并刷新状态
 * @returns {Promise<void>}
 */
async function doLogout() {
  showLogoutModal.value = false
  const res = await store.logout()
  showMsg(res.message)
}

/** 在线状态轮询定时器 */
let refreshTimer = null

/** 轮询间隔（毫秒） */
const REFRESH_INTERVAL = 30000

/**
 * 刷新云端隧道列表
 * @param {boolean} silent - 静默模式（定时轮询时失败不弹提示）
 * @returns {Promise<void>}
 */
async function refresh(silent = false) {
  const res = await store.refreshTunnels()
  if (!res.ok && !silent) {
    showMsg(res.message)
  }
}

onMounted(async () => {
  // 先等授权状态查询完成，再决定是否拉取列表（修复首次进入不刷新）
  await store.init()
  if (store.logined) {
    refresh()
    // 已授权时定时轮询在线状态，静默模式避免网络抖动弹提示
    refreshTimer = setInterval(() => {
      if (store.logined && !store.loading) {
        refresh(true)
      }
    }, REFRESH_INTERVAL)
  }
})

onUnmounted(() => {
  if (refreshTimer) {
    clearInterval(refreshTimer)
    refreshTimer = null
  }
})

/**
 * 创建云端命名隧道
 * @returns {Promise<void>}
 */
async function createCloudTunnel() {
  if (!newName.value.trim()) {
    showMsg('请输入隧道名称')
    return
  }
  const res = await store.createTunnel(newName.value.trim())
  showMsg(res.message)
  if (res.ok) {
    newName.value = ''
  }
}

/**
 * 导入云端隧道到本地列表
 * @param {object} item - 云端隧道对象
 * @returns {Promise<void>}
 */
async function doImport(item) {
  const res = await store.importTunnel(item)
  showMsg(res.message || (res.ok ? '已导入' : '导入失败'))
}

/**
 * 打开绑定域名弹窗（预填已绑定的域名）
 * @param {object} item - 云端隧道对象
 * @returns {void}
 */
function openRouteModal(item) {
  routeModal.value = item
  routeHostname.value = store.domainBindings[item.id] || ''
}

/**
 * 提交绑定域名
 * @returns {Promise<void>}
 */
async function submitRoute() {
  const item = routeModal.value
  if (!item) {
    return
  }
  const res = await store.routeDns(item.id, routeHostname.value)
  showMsg(res.message)
  if (res.ok) {
    routeModal.value = null
  }
}

/**
 * 删除云端隧道（两次点击确认）
 * @param {object} item - 云端隧道对象
 * @returns {Promise<void>}
 */
async function doDelete(item) {
  if (confirmDeleteId.value !== item.id) {
    confirmDeleteId.value = item.id
    setTimeout(() => {
      if (confirmDeleteId.value === item.id) {
        confirmDeleteId.value = ''
      }
    }, 5000)
    return
  }
  confirmDeleteId.value = ''
  const res = await store.deleteCloudTunnel(item.id)
  showMsg(res.message)
}
</script>

<template>
  <div>
    <div class="toolbar">
      <h2>cloudflared 管理</h2>
    </div>

    <div class="panel-card">
      <div class="panel-head">
        <span class="dot" :style="{ background: store.logined ? '#4ade80' : '#ff6b6b' }"></span>
        <b>Cloudflare 授权</b>
        <span class="panel-tip">{{ store.logined ? '已授权' : '未授权' }}（{{ store.cloudflaredHome }}）</span>
        <div class="panel-actions">
          <button v-if="!store.loginLoading" class="btn" :disabled="store.logined" @click="doLogin">
            {{ store.logined ? '已完成授权' : '开始登录授权' }}
          </button>
          <button v-else class="btn btn-stop" @click="store.cancelLogin()">取消登录</button>
          <button
            v-if="store.logined"
            class="btn btn-mini btn-danger"
            title="删除授权凭据 cert.pem，不影响运行中的隧道"
            @click="openLogoutModal"
          >
            退出登录
          </button>
        </div>
      </div>
      <div v-if="store.loginLoading" class="login-tip">
        浏览器已打开 Cloudflare 授权页面，请选择域名完成授权。完成后本页会自动更新。
      </div>
      <div v-if="store.loginFailed && store.loginLogs.length > 0" class="log-box login-log">
        <div v-for="(line, i) in store.loginLogs" :key="i" class="log-line">{{ line }}</div>
      </div>
    </div>

    <div class="panel-card">
      <div class="panel-head">
        <b>账号下的命名隧道</b>
        <div class="panel-actions">
          <input v-model="newName" class="inline-input" placeholder="新隧道名称" @keyup.enter="createCloudTunnel" />
          <button class="btn" @click="createCloudTunnel">创建</button>
          <button class="btn" :disabled="store.loading" @click="refresh">{{ store.loading ? '查询中...' : '刷新' }}</button>
        </div>
      </div>

      <div v-if="!store.logined" class="empty-inline">完成授权后可查看账号下的隧道。</div>
      <div v-else-if="store.cloudTunnels.length === 0" class="empty-inline">暂无隧道，可在上方输入名称创建。</div>

      <table v-else class="tunnel-table">
        <thead>
          <tr>
            <th>名称</th>
            <th>隧道 ID</th>
            <th>连接状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in store.cloudTunnels" :key="item.id">
            <td>
              {{ item.name }}
              <div v-if="store.domainBindings[item.id]" class="bound-domain">
                已绑定：{{ store.domainBindings[item.id] }}
              </div>
            </td>
            <td class="mono">{{ item.id.slice(0, 8) }}...</td>
            <td>
              <span v-if="item.connections && item.connections.length > 0" class="conn-on">在线（{{ item.connections.length }} 条链路）</span>
              <span v-else class="conn-off">离线</span>
            </td>
            <td class="row-actions">
              <button class="btn btn-mini" @click="doImport(item)">导入</button>
              <button
                class="btn btn-mini"
                :title="store.domainBindings[item.id] ? `当前绑定 ${store.domainBindings[item.id]}，重新绑定会覆盖原域名` : '将域名指向该隧道（创建 CNAME 记录）'"
                @click="openRouteModal(item)"
              >
                {{ store.domainBindings[item.id] ? '更换域名' : '绑定域名' }}
              </button>
              <button class="btn btn-mini btn-danger" @click="doDelete(item)">
                {{ confirmDeleteId === item.id ? '确认删除？' : '删除' }}
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <div v-if="localMsg" class="error-msg">{{ localMsg }}</div>

    <div v-if="routeModal" class="modal-mask" @click.self="routeModal = null">
      <div class="modal">
        <h3>绑定域名 — {{ routeModal.name }}</h3>
        <div class="form-row">
          <label>域名（需已托管在该 Cloudflare 账号下）</label>
          <input v-model="routeHostname" placeholder="app.example.com" @keyup.enter="submitRoute" />
        </div>
        <div class="modal-actions">
          <button class="btn" @click="routeModal = null">取消</button>
          <button class="btn btn-primary" @click="submitRoute">绑定</button>
        </div>
      </div>
    </div>

    <div v-if="showLogoutModal" class="modal-mask" @click.self="showLogoutModal = false">
      <div class="modal">
        <h3>确认退出登录？</h3>
        <p class="logout-tip">
          将删除授权凭据 cert.pem（{{ store.cloudflaredHome }}）。<br />
          运行中的隧道不受影响，但创建/删除隧道、绑定域名等管理操作需要重新授权。
        </p>
        <div class="modal-actions">
          <button class="btn" @click="showLogoutModal = false">取消</button>
          <button class="btn btn-danger" @click="doLogout">确认退出</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.panel-card {
  background: #1b1f27;
  border: 1px solid #2a2f3a;
  border-radius: 12px;
  padding: 16px 18px;
  margin-bottom: 16px;
}

.panel-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.panel-head b {
  font-size: 14px;
}

.panel-tip {
  flex: 1;
  font-size: 12px;
  color: #7b8190;
}

.panel-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.inline-input {
  width: 180px;
  background: #12151b;
  border: 1px solid #33383f;
  border-radius: 8px;
  color: #e2e5ea;
  padding: 7px 10px;
  font-size: 13px;
  outline: none;
}

.login-tip {
  margin-top: 10px;
  font-size: 13px;
  color: #fbad41;
  padding-left: 22px;
}

.login-log {
  max-height: 140px;
}

.empty-inline {
  color: #7b8190;
  font-size: 13px;
  padding: 14px 0 4px;
}

.tunnel-table {
  width: 100%;
  border-collapse: collapse;
  margin-top: 12px;
  font-size: 13px;
}

.tunnel-table th {
  text-align: left;
  color: #7b8190;
  font-weight: normal;
  padding: 8px 6px;
  border-bottom: 1px solid #2a2f3a;
}

.tunnel-table td {
  padding: 10px 6px;
  border-bottom: 1px solid #23262f;
}

.mono {
  font-family: Consolas, monospace;
}

.conn-on {
  color: #4ade80;
  font-size: 12px;
}

.conn-off {
  color: #6b7280;
  font-size: 12px;
}

.bound-domain {
  margin-top: 2px;
  font-size: 12px;
  color: #4ade80;
}

.row-actions {
  display: flex;
  gap: 6px;
}

.btn-mini {
  padding: 4px 10px;
  font-size: 12px;
}

.logout-tip {
  margin: 4px 0 0;
  font-size: 13px;
  line-height: 1.7;
  color: #aab0bc;
}
</style>
