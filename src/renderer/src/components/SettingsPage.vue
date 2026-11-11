<script setup>
/**
 * 设置页：cloudflared 路径、开机自启、启动恢复、关闭行为、配置备份、版本信息
 */
import { ref, onMounted } from 'vue'
import { useTunnelStore } from '../stores/tunnels.js'

const tunnelStore = useTunnelStore()

/** 设置数据（主进程持久化） */
const settings = ref(null)

/** 应用自身版本号 */
const appVersion = ref('')

/** cloudflared 版本（null 表示未查询，'' 表示查询中） */
const cfVersion = ref(null)

/** 提示消息（成功绿色 / 失败红色） */
const toast = ref('')
const toastType = ref('ok')

/** toast 定时器 */
let toastTimer = null

/**
 * 显示一条临时提示
 * @param {string} msg - 提示内容
 * @param {'ok'|'err'} [type] - 提示类型
 * @returns {void}
 */
function showToast(msg, type = 'ok') {
  toast.value = msg
  toastType.value = type
  if (toastTimer) {
    clearTimeout(toastTimer)
  }
  toastTimer = setTimeout(() => {
    toast.value = ''
  }, 3000)
}

/**
 * 加载设置与版本信息
 * @returns {Promise<void>}
 */
async function load() {
  try {
    settings.value = await window.appApi.getSettings()
    appVersion.value = await window.appApi.getVersion()
  } catch (err) {
    showToast(`加载设置失败：${err.message}`, 'err')
  }
}

/**
 * 查询 cloudflared 版本
 * @returns {Promise<void>}
 */
async function queryVersion() {
  cfVersion.value = ''
  try {
    const res = await window.cfApi.getVersion()
    cfVersion.value = res.ok ? res.version : null
    if (!res.ok) {
      showToast(res.message || '版本查询失败', 'err')
    }
  } catch (err) {
    cfVersion.value = null
    showToast(`版本查询失败：${err.message}`, 'err')
  }
}

/**
 * 更新设置项并持久化
 * @param {object} patch - 设置项
 * @returns {Promise<void>}
 */
async function save(patch) {
  try {
    settings.value = await window.appApi.setSettings(patch)
    showToast('设置已保存')
  } catch (err) {
    showToast(`保存失败：${err.message}`, 'err')
  }
}

/**
 * 打开文件选择对话框选择 cloudflared.exe 并保存
 * @returns {Promise<void>}
 */
async function pickCloudflared() {
  try {
    const res = await window.appApi.pickCloudflared()
    if (!res.ok) {
      return
    }
    await save({ cloudflaredPath: res.path })
    // 路径变更后重新检测版本
    queryVersion()
  } catch (err) {
    showToast(`选择失败：${err.message}`, 'err')
  }
}

/**
 * 切换开机自启
 * @returns {Promise<void>}
 */
async function toggleLaunchAtLogin() {
  await save({ launchAtLogin: settings.value.launchAtLogin })
}

/**
 * 切换启动恢复
 * @returns {Promise<void>}
 */
async function toggleRestore() {
  await save({ restoreOnLaunch: settings.value.restoreOnLaunch })
}

/**
 * 切换关闭行为（radio change）
 * @returns {Promise<void>}
 */
async function changeCloseAction() {
  await save({ closeAction: settings.value.closeAction })
}

/**
 * 导出隧道配置到 JSON 文件
 * @returns {Promise<void>}
 */
async function exportConfig() {
  try {
    const res = await window.appApi.exportConfig()
    showToast(res.ok ? res.message : res.message || '已取消', res.ok ? 'ok' : 'err')
  } catch (err) {
    showToast(`导出失败：${err.message}`, 'err')
  }
}

/**
 * 从 JSON 文件导入隧道配置，成功后刷新列表
 * @returns {Promise<void>}
 */
async function importConfig() {
  try {
    const res = await window.appApi.importConfig()
    if (!res.ok) {
      showToast(res.message || '已取消', 'err')
      return
    }
    showToast(res.message, 'ok')
    if (res.added > 0) {
      await tunnelStore.refresh()
    }
  } catch (err) {
    showToast(`导入失败：${err.message}`, 'err')
  }
}

onMounted(async () => {
  await load()
  queryVersion()
})
</script>

<template>
  <div v-if="settings" class="settings-page">
    <div class="toolbar">
      <h2>设置</h2>
      <span v-if="toast" :class="['toast', toastType]">{{ toast }}</span>
    </div>

    <!-- cloudflared -->
    <section class="card">
      <h3>cloudflared</h3>
      <div class="row">
        <span class="row-label">程序路径</span>
        <div class="path-line">
          <input v-model="settings.cloudflaredPath" type="text" placeholder="留空则尝试从 PATH 查找" @change="save({ cloudflaredPath: settings.cloudflaredPath })" />
          <button class="btn" @click="pickCloudflared">浏览…</button>
        </div>
      </div>
      <div class="row">
        <span class="row-label">版本</span>
        <span class="row-value">
          {{ cfVersion === '' ? '检测中…' : cfVersion ? `cloudflared ${cfVersion}` : '未检测到' }}
        </span>
        <button class="btn btn-sm" @click="queryVersion">重新检测</button>
      </div>
    </section>

    <!-- 启动行为 -->
    <section class="card">
      <h3>启动</h3>
      <div class="row">
        <div class="row-text">
          <b>开机自启</b>
          <p>登录 Windows 后自动启动隧道管家</p>
        </div>
        <label class="switch">
          <input v-model="settings.launchAtLogin" type="checkbox" @change="toggleLaunchAtLogin" />
          <span class="slider"></span>
        </label>
      </div>
      <div class="row">
        <div class="row-text">
          <b>启动时恢复隧道</b>
          <p>自动恢复上次退出前正在运行的隧道（含被强制杀进程的情况）</p>
        </div>
        <label class="switch">
          <input v-model="settings.restoreOnLaunch" type="checkbox" @change="toggleRestore" />
          <span class="slider"></span>
        </label>
      </div>
    </section>

    <!-- 关闭行为 -->
    <section class="card">
      <h3>关闭窗口时</h3>
      <label class="radio-line">
        <input v-model="settings.closeAction" type="radio" value="exit" @change="changeCloseAction" />
        <span>直接退出应用并停止全部隧道</span>
      </label>
      <label class="radio-line">
        <input v-model="settings.closeAction" type="radio" value="tray" @change="changeCloseAction" />
        <span>最小化到系统托盘，隧道保持运行（右键托盘图标可退出）</span>
      </label>
    </section>

    <!-- 配置备份 -->
    <section class="card">
      <h3>配置备份</h3>
      <p class="card-tip">将全部隧道配置导出为 JSON 文件备份，或从备份文件导入（按 ID 去重，重复的自动跳过）。</p>
      <div class="row">
        <button class="btn" @click="exportConfig">导出配置…</button>
        <button class="btn" @click="importConfig">导入配置…</button>
      </div>
    </section>

    <!-- 关于 -->
    <section class="card">
      <h3>关于</h3>
      <div class="row">
        <span class="row-label">隧道管家</span>
        <span class="row-value">v{{ appVersion }}</span>
      </div>
    </section>
  </div>
</template>

<style scoped>
.settings-page {
  max-width: 720px;
}

.toolbar {
  display: flex;
  align-items: center;
  gap: 14px;
  margin-bottom: 20px;
}

.toolbar h2 {
  font-size: 18px;
}

.toast {
  font-size: 12px;
  padding: 4px 10px;
  border-radius: 6px;
}

.toast.ok {
  color: #7fd88f;
  background: rgba(88, 200, 120, 0.12);
}

.toast.err {
  color: #ff7a7a;
  background: rgba(255, 90, 90, 0.12);
}

.card {
  background: #1b1f27;
  border: 1px solid #2a2f3a;
  border-radius: 12px;
  padding: 18px 20px;
  margin-bottom: 16px;
}

.card h3 {
  font-size: 14px;
  margin-bottom: 14px;
  color: #fff;
}

.card-tip {
  font-size: 12px;
  color: #7b8190;
  margin: -6px 0 14px;
}

.row {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 12px;
}

.row:last-child {
  margin-bottom: 0;
}

.row-label {
  min-width: 72px;
  color: #aab0bc;
  font-size: 13px;
}

.row-value {
  color: #e2e5ea;
  font-size: 13px;
}

.row-text {
  flex: 1;
}

.row-text b {
  font-size: 13px;
}

.row-text p {
  font-size: 12px;
  color: #7b8190;
  margin-top: 3px;
}

.path-line {
  flex: 1;
  display: flex;
  gap: 10px;
}

.path-line input {
  flex: 1;
  background: #12151b;
  border: 1px solid #33383f;
  border-radius: 8px;
  color: #e2e5ea;
  padding: 8px 12px;
  font-size: 13px;
  outline: none;
}

.path-line input:focus {
  border-color: #f6821f;
}

.btn-sm {
  padding: 5px 12px;
  font-size: 12px;
}

.radio-line {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 13px;
  color: #c9cdd6;
  padding: 6px 0;
  cursor: pointer;
}

/* 开关样式 */
.switch {
  position: relative;
  width: 42px;
  height: 24px;
  flex-shrink: 0;
}

.switch input {
  opacity: 0;
  width: 0;
  height: 0;
}

.slider {
  position: absolute;
  inset: 0;
  background: #33383f;
  border-radius: 24px;
  cursor: pointer;
  transition: background 0.2s;
}

.slider::before {
  content: '';
  position: absolute;
  width: 18px;
  height: 18px;
  left: 3px;
  top: 3px;
  background: #e2e5ea;
  border-radius: 50%;
  transition: transform 0.2s;
}

.switch input:checked + .slider {
  background: #f6821f;
}

.switch input:checked + .slider::before {
  transform: translateX(18px);
}
</style>
