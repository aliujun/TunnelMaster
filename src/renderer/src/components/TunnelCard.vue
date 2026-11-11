<script setup>
/**
 * 隧道卡片：状态、目标地址、公网地址、边缘连接数，日志搜索/导出/着色，启停与编辑
 */
import { computed, ref, nextTick, watch } from 'vue'
import { useTunnelStore, STATUS_TEXT } from '../stores/tunnels.js'

const props = defineProps({
  /** 隧道配置 */
  tunnel: {
    type: Object,
    required: true
  }
})

const emit = defineEmits(['edit'])

const store = useTunnelStore()

/** 日志面板是否展开 */
const showLogs = ref(false)

/** 日志容器 DOM 引用（用于自动滚动到底部） */
const logBox = ref(null)

/** 删除前的二次确认状态 */
const confirmDelete = ref(false)

/** 操作提示信息 */
const actionMsg = ref('')

/** 日志搜索关键词 */
const searchTerm = ref('')

/** 用户是否滚动到底部附近（决定是否自动跟随滚动） */
const pinnedBottom = ref(true)

/**
 * 当前运行态（无则视为已停止）
 * @returns {object} 运行态对象
 */
const runtime = computed(() => {
  return (
    store.states[props.tunnel.id] || {
      status: 'stopped',
      publicUrl: null,
      logs: [],
      connCount: 0,
      retries: 0
    }
  )
})

/**
 * 状态圆点颜色
 * @returns {string} CSS 颜色值
 */
const statusColor = computed(() => {
  const map = { running: '#4ade80', starting: '#facc15', stopped: '#6b7280', error: '#ff6b6b' }
  return map[runtime.value.status] || '#6b7280'
})

/**
 * 隧道目标描述：命名隧道显示 ingress 规则摘要，快速隧道显示本地服务地址
 * @returns {string} 描述文本
 */
const targetText = computed(() => {
  if (props.tunnel.type === 'named') {
    const rules = (props.tunnel.ingress || []).filter((r) => r && r.service)
    if (rules.length === 0) {
      return '未配置 ingress 规则，请编辑添加'
    }
    return rules
      .map((r) => (r.hostname ? `${r.hostname} → ${r.service}` : `${r.service}`))
      .join('  |  ')
  }
  if (!props.tunnel.port) {
    return '未指定本地端口'
  }
  return `${props.tunnel.proto || 'http'}://${props.tunnel.host || 'localhost'}:${props.tunnel.port}`
})

/**
 * 状态中文文本
 * @returns {string} 状态文本
 */
const statusText = computed(() => {
  if (runtime.value.status === 'starting' && runtime.value.retries > 0) {
    return `重启中（第 ${runtime.value.retries} 次）`
  }
  return STATUS_TEXT[runtime.value.status] || '未知'
})

/**
 * 过滤后的日志列表（按关键词过滤，大小写不敏感）
 * @returns {string[]} 过滤后的日志行
 */
const filteredLogs = computed(() => {
  const keyword = searchTerm.value.trim().toLowerCase()
  if (!keyword) {
    return runtime.value.logs
  }
  return runtime.value.logs.filter((line) => line.toLowerCase().includes(keyword))
})

/**
 * 判断日志行的展示级别（着色用）
 * @param {string} line - 日志行
 * @returns {string} 级别：error/warn/info
 */
function lineLevel(line) {
  if (/\bERR\b|\berror\b|failed|fatal/i.test(line)) {
    return 'error'
  }
  if (/\bWARN\b|\bwarn\b/i.test(line)) {
    return 'warn'
  }
  return 'info'
}

/**
 * 滚动日志到指定位置（底部）
 * @returns {Promise<void>}
 */
async function scrollToBottom() {
  await nextTick()
  if (logBox.value) {
    logBox.value.scrollTop = logBox.value.scrollHeight
  }
}

/**
 * 用户滚动时更新 pinnedBottom 标记
 * @returns {void}
 */
function onLogScroll() {
  const el = logBox.value
  if (!el) {
    return
  }
  pinnedBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 30
}

// 日志新增时，若用户停留底部则自动跟随
watch(
  () => runtime.value.logs.length,
  () => {
    if (showLogs.value && pinnedBottom.value && !searchTerm.value) {
      scrollToBottom()
    }
  }
)

/**
 * 启动或停止隧道
 * @returns {Promise<void>}
 */
async function toggleRun() {
  actionMsg.value = ''
  const id = props.tunnel.id
  if (runtime.value.status === 'running' || runtime.value.status === 'starting') {
    const res = await store.stop(id)
    if (!res.ok) {
      actionMsg.value = res.message
    }
    return
  }
  const res = await store.start(id)
  if (!res.ok) {
    actionMsg.value = res.message
  }
}

/**
 * 切换日志面板展开状态，展开后滚动到底部
 * @returns {Promise<void>}
 */
async function toggleLogs() {
  showLogs.value = !showLogs.value
  if (!showLogs.value) {
    return
  }
  pinnedBottom.value = true
  await scrollToBottom()
}

/**
 * 复制公网地址到剪贴板
 * @returns {Promise<void>}
 */
async function copyUrl() {
  const url = runtime.value.publicUrl
  if (!url) {
    return
  }
  try {
    await navigator.clipboard.writeText(url)
    actionMsg.value = '公网地址已复制'
  } catch (err) {
    actionMsg.value = `复制失败：${err.message}`
  }
}

/**
 * 导出日志到本地文件
 * @returns {Promise<void>}
 */
async function exportLogs() {
  actionMsg.value = ''
  try {
    const res = await window.tunnelApi.exportLogs(props.tunnel.id)
    actionMsg.value = res.message
  } catch (err) {
    actionMsg.value = `导出失败：${err.message}`
  }
}

/**
 * 删除隧道（第一次点击进入确认态，再次点击才真正删除）
 * @returns {Promise<void>}
 */
async function doDelete() {
  if (!confirmDelete.value) {
    confirmDelete.value = true
    // 5 秒内未确认则取消确认态
    setTimeout(() => {
      confirmDelete.value = false
    }, 5000)
    return
  }
  await store.remove(props.tunnel.id)
  confirmDelete.value = false
}
</script>

<template>
  <div class="card">
    <div class="card-head">
      <span class="dot" :style="{ background: statusColor }"></span>
      <div class="card-title">
        <b>{{ tunnel.name }}</b>
        <span class="badge" :class="tunnel.type">{{ tunnel.type === 'quick' ? '快速隧道' : '命名隧道' }}</span>
      </div>
      <div class="card-actions">
        <button
          class="btn"
          :class="runtime.status === 'running' || runtime.status === 'starting' ? 'btn-stop' : 'btn-start'"
          @click="toggleRun"
        >
          {{ runtime.status === 'running' || runtime.status === 'starting' ? '停止' : '启动' }}
        </button>
        <button class="btn" @click="emit('edit')">编辑</button>
        <button class="btn btn-danger" @click="doDelete">
          {{ confirmDelete ? '确认删除？' : '删除' }}
        </button>
        <button class="btn" @click="toggleLogs">{{ showLogs ? '收起日志' : '日志' }}</button>
      </div>
    </div>

    <div class="card-body">
      <div class="meta">
        <span class="meta-label">{{ statusText }}</span>
        <span class="meta-target">本地：{{ targetText }}</span>
        <span
          v-if="runtime.connCount > 0"
          class="meta-conn"
          title="与 Cloudflare 边缘网络建立的高可用链路数（默认 4 条，支持冗余容灾，非访客连接数）"
        >边缘链路：{{ runtime.connCount }}/4</span>
        <span v-if="runtime.pid" class="meta-pid">PID：{{ runtime.pid }}</span>
      </div>
      <div v-if="runtime.publicUrl" class="public-url">
        <a :href="runtime.publicUrl" target="_blank">{{ runtime.publicUrl }}</a>
        <button class="btn btn-mini" @click="copyUrl">复制</button>
      </div>
      <div v-if="actionMsg" class="error-msg">{{ actionMsg }}</div>
    </div>

    <div v-if="showLogs" class="log-panel">
      <div class="log-toolbar">
        <input v-model="searchTerm" class="log-search" placeholder="搜索日志..." @scroll.stop />
        <button class="btn btn-mini" @click="exportLogs">导出</button>
      </div>
      <div ref="logBox" class="log-box" @scroll="onLogScroll">
        <div v-if="filteredLogs.length === 0" class="log-empty">
          {{ searchTerm ? '无匹配日志' : '暂无日志' }}
        </div>
        <div v-for="(line, i) in filteredLogs" :key="i" class="log-line" :class="lineLevel(line)">
          {{ line }}
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.card {
  background: #1b1f27;
  border: 1px solid #2a2f3a;
  border-radius: 12px;
  padding: 16px 18px;
}

.card-head {
  display: flex;
  align-items: center;
  gap: 12px;
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
}

.card-title {
  flex: 1;
  display: flex;
  align-items: center;
  gap: 8px;
}

.badge {
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 20px;
  background: #22262f;
  color: #aab0bc;
}

.badge.quick {
  color: #7cc6ff;
}

.badge.named {
  color: #fbad41;
}

.card-actions {
  display: flex;
  gap: 8px;
}

.btn-start {
  background: #1d3a2a;
  border-color: #2c5e3f;
  color: #4ade80;
}

.btn-stop {
  background: #3a2530;
  border-color: #6e3a4a;
  color: #ff9a9a;
}

.card-body {
  margin-top: 10px;
  padding-left: 22px;
}

.meta {
  display: flex;
  gap: 18px;
  font-size: 12px;
  color: #7b8190;
  flex-wrap: wrap;
}

.meta-label {
  color: #e2e5ea;
}

.meta-conn {
  color: #4ade80;
}

.public-url {
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 10px;
}

.public-url a {
  color: #7cc6ff;
  text-decoration: none;
  font-family: Consolas, monospace;
  font-size: 13px;
}

.public-url a:hover {
  text-decoration: underline;
}

.btn-mini {
  padding: 3px 10px;
  font-size: 12px;
}

.log-panel {
  margin-top: 12px;
}

.log-toolbar {
  display: flex;
  gap: 8px;
  margin-bottom: 8px;
}

.log-search {
  flex: 1;
  background: #12151b;
  border: 1px solid #33383f;
  border-radius: 8px;
  color: #e2e5ea;
  padding: 6px 10px;
  font-size: 12px;
  outline: none;
}

.log-search:focus {
  border-color: #f6821f;
}

.log-box {
  background: #0c0e12;
  border: 1px solid #23262f;
  border-radius: 8px;
  padding: 10px 12px;
  max-height: 240px;
  overflow-y: auto;
  font-family: Consolas, monospace;
  font-size: 12px;
  line-height: 1.6;
}

.log-line {
  color: #8b93a1;
  word-break: break-all;
  white-space: pre-wrap;
}

.log-line.error {
  color: #ff7a7a;
}

.log-line.warn {
  color: #fbad41;
}

.log-empty {
  color: #555c68;
}
</style>
