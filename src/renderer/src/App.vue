<script setup>
/**
 * 应用根组件：侧边栏 + 隧道列表主区域
 */
import { ref, onMounted } from 'vue'
import { useTunnelStore } from './stores/tunnels.js'
import TunnelCard from './components/TunnelCard.vue'
import TunnelForm from './components/TunnelForm.vue'
import CloudflaredPanel from './components/CloudflaredPanel.vue'
import SettingsPage from './components/SettingsPage.vue'

const store = useTunnelStore()

/** 当前页面：tunnels 隧道列表，cloudflared cloudflared 管理 */
const activePage = ref('tunnels')

/** 新建/编辑弹窗是否显示 */
const showForm = ref(false)

/** 当前编辑的隧道（null 表示新建） */
const editingTunnel = ref(null)

/**
 * 打开新建隧道弹窗
 * @returns {void}
 */
function openCreate() {
  editingTunnel.value = null
  showForm.value = true
}

/**
 * 打开编辑隧道弹窗
 * @param {object} tunnel - 隧道配置
 * @returns {void}
 */
function openEdit(tunnel) {
  editingTunnel.value = tunnel
  showForm.value = true
}

/**
 * 关闭弹窗
 * @returns {void}
 */
function closeForm() {
  showForm.value = false
  editingTunnel.value = null
}

onMounted(() => {
  store.init()
})
</script>

<template>
  <div class="layout">
    <aside class="sidebar">
      <div class="brand">
        <div class="logo">隧</div>
        <div class="brand-name">隧道管家</div>
        <div class="brand-sub">Cloudflared 隧道管理</div>
      </div>
      <nav class="nav">
        <div class="nav-item" :class="{ active: activePage === 'tunnels' }" @click="activePage = 'tunnels'">
          隧道列表
        </div>
        <div class="nav-item" :class="{ active: activePage === 'cloudflared' }" @click="activePage = 'cloudflared'">
          cloudflared 管理
        </div>
        <div class="nav-item" :class="{ active: activePage === 'settings' }" @click="activePage = 'settings'">
          设置
        </div>
      </nav>
      <div class="sidebar-footer">
        运行中：{{ store.runningCount }} / {{ store.tunnels.length }}
      </div>
    </aside>

    <main class="main">
      <!-- 隧道列表页 -->
      <template v-if="activePage === 'tunnels'">
        <div class="toolbar">
          <h2>隧道列表</h2>
          <button class="btn btn-primary" @click="openCreate">+ 新建隧道</button>
        </div>

        <div v-if="store.tunnels.length === 0" class="empty">
          <p>还没有隧道，点击右上角「新建隧道」创建第一条隧道。</p>
          <p class="empty-tip">快速隧道无需登录 Cloudflare，填一个本地端口即可获得公网地址。</p>
        </div>

        <div v-else class="tunnel-list">
          <TunnelCard
            v-for="tunnel in store.tunnels"
            :key="tunnel.id"
            :tunnel="tunnel"
            @edit="openEdit(tunnel)"
          />
        </div>
      </template>

      <!-- cloudflared 管理页 -->
      <CloudflaredPanel v-else-if="activePage === 'cloudflared'" />

      <!-- 设置页 -->
      <SettingsPage v-else-if="activePage === 'settings'" />
    </main>

    <TunnelForm v-if="showForm" :tunnel="editingTunnel" @close="closeForm" />
  </div>
</template>

<style>
* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

/* 全局滚动条美化：细条深色，hover 高亮 */
::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: #2e3440;
  border-radius: 4px;
}

::-webkit-scrollbar-thumb:hover {
  background: #3f4757;
}

::-webkit-scrollbar-corner {
  background: transparent;
}

/* 按钮全局规则：文字不换行，且在 flex 行内不被输入框挤压 */
button {
  white-space: nowrap;
  flex-shrink: 0;
}


html,
body,
#app {
  height: 100%;
}

body {
  font-family: 'Microsoft YaHei', 'Segoe UI', sans-serif;
  background: #0f1115;
  color: #e2e5ea;
  font-size: 14px;
}

.layout {
  display: flex;
  height: 100%;
}

.sidebar {
  width: 220px;
  background: #161920;
  border-right: 1px solid #23262f;
  display: flex;
  flex-direction: column;
  padding: 20px 14px;
}

.brand {
  margin-bottom: 28px;
}

.logo {
  width: 40px;
  height: 40px;
  border-radius: 10px;
  background: linear-gradient(135deg, #f6821f, #fbad41);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: bold;
  color: #16181d;
  margin-bottom: 10px;
}

.brand-name {
  font-size: 16px;
  font-weight: bold;
}

.brand-sub {
  font-size: 12px;
  color: #7b8190;
  margin-top: 2px;
}

.nav {
  flex: 1;
}

.nav-item {
  padding: 10px 12px;
  border-radius: 8px;
  cursor: pointer;
  color: #aab0bc;
  margin-bottom: 4px;
}

.nav-item.active {
  background: #22262f;
  color: #fff;
}

.nav-item.disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.sidebar-footer {
  font-size: 12px;
  color: #7b8190;
  padding-top: 12px;
  border-top: 1px solid #23262f;
}

.main {
  flex: 1;
  overflow-y: auto;
  padding: 24px 28px;
}

.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
}

.toolbar h2 {
  font-size: 18px;
}

.btn {
  border: 1px solid #33383f;
  background: #22262f;
  color: #e2e5ea;
  padding: 8px 16px;
  border-radius: 8px;
  cursor: pointer;
  font-size: 13px;
}

.btn:hover {
  background: #2a2f3a;
}

.btn-primary {
  background: #f6821f;
  border-color: #f6821f;
  color: #16181d;
  font-weight: bold;
}

.btn-primary:hover {
  background: #fbad41;
}

.btn-danger {
  color: #ff7a7a;
}

.btn-danger:hover {
  background: #3a2530;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.empty {
  text-align: center;
  color: #7b8190;
  padding-top: 120px;
}

.empty-tip {
  font-size: 12px;
  margin-top: 8px;
}

.tunnel-list {
  display: flex;
  flex-direction: column;
  gap: 14px;
}

/* 通用模态遮罩 */
.modal-mask {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}

.modal {
  width: 520px;
  max-height: 92vh;
  overflow-y: auto;
  background: #1b1f27;
  border: 1px solid #2a2f3a;
  border-radius: 12px;
  padding: 20px;
}

.modal h3 {
  margin-bottom: 14px;
}

.form-row {
  margin-bottom: 11px;
}

.form-row label {
  display: block;
  font-size: 12px;
  color: #aab0bc;
  margin-bottom: 6px;
}

.form-row input,
.form-row select {
  width: 100%;
  background: #12151b;
  border: 1px solid #33383f;
  border-radius: 8px;
  color: #e2e5ea;
  padding: 9px 12px;
  font-size: 13px;
  outline: none;
}

/* 下拉框：不显示箭头，保持简洁 */
.form-row select {
  appearance: none;
}

.form-row input:focus,
.form-row select:focus {
  border-color: #f6821f;
}

.form-inline {
  display: flex;
  gap: 10px;
}

.form-inline .form-row {
  flex: 1;
}

/* 勾选框行：勾与文字同行，覆盖 .form-row 的 label/input 通用规则 */
.checkbox-row .checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  color: #e2e5ea;
  margin-bottom: 0;
  cursor: pointer;
}

.checkbox-row input[type='checkbox'] {
  width: auto;
  margin: 0;
  accent-color: #f6821f;
}

.type-group {
  display: flex;
  gap: 10px;
}

.type-option {
  flex: 1;
  border: 1px solid #33383f;
  border-radius: 8px;
  padding: 12px;
  cursor: pointer;
}

.type-option.selected {
  border-color: #f6821f;
  background: rgba(246, 130, 31, 0.08);
}

.type-option b {
  display: block;
  margin-bottom: 4px;
}

.type-option span {
  font-size: 11px;
  color: #7b8190;
}

.modal-actions {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  margin-top: 14px;
}

.error-msg {
  color: #ff7a7a;
  font-size: 12px;
  margin-top: 8px;
}
</style>
