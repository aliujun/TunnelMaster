<script setup>
/**
 * 新建/编辑隧道表单弹窗：支持快速隧道与命名隧道（ingress 多规则编辑）
 */
import { ref, reactive, computed, onMounted } from 'vue'
import { useTunnelStore } from '../stores/tunnels.js'
import { useCloudflaredStore } from '../stores/cloudflared.js'

const props = defineProps({
  /** 待编辑的隧道，null 表示新建 */
  tunnel: {
    type: Object,
    default: null
  }
})

const emit = defineEmits(['close'])

const tunnelStore = useTunnelStore()
const cfStore = useCloudflaredStore()

/**
 * 把 service 字符串解析回结构化字段
 * @param {{hostname?: string, service: string}} rule - ingress 规则
 * @returns {{hostname: string, proto: string, host: string, port: string}} 结构化行
 */
function parseRule(rule) {
  const match = (rule.service || '').match(/^(https?|ssh|rdp):\/\/([^:]+):(\d+)$/)
  if (!match) {
    return { hostname: rule.hostname || '', proto: 'http', host: 'localhost', port: '' }
  }
  return { hostname: rule.hostname || '', proto: match[1], host: match[2], port: match[3] }
}

/** 表单数据 */
const form = reactive({
  name: props.tunnel?.name || '',
  type: props.tunnel?.type || 'quick',
  proto: props.tunnel?.proto || 'http',
  host: props.tunnel?.host || 'localhost',
  port: props.tunnel?.port || '',
  tunnelId: props.tunnel?.tunnelId || '',
  credentialsPath: props.tunnel?.credentialsPath || '',
  domain: props.tunnel?.domain || '',
  autoRestart: props.tunnel?.autoRestart !== false
})

/** ingress 结构化规则行 */
const ingressRows = reactive(
  ((props.tunnel?.ingress || []).filter((r) => r && r.service)).map(parseRule)
)

/** 提交中的错误信息 */
const errorMsg = ref('')

/** 创建/导入操作进行中标记 */
const busy = ref(false)

/** 从账号导入的选择列表是否展开 */
const showImportList = ref(false)

/** 是否编辑模式 */
const isEdit = computed(() => Boolean(props.tunnel))

/**
 * 添加一条空的 ingress 规则行
 * @returns {void}
 */
function addRule() {
  ingressRows.push({ hostname: '', proto: 'http', host: 'localhost', port: '' })
}

/**
 * 删除指定 ingress 规则行
 * @param {number} index - 行索引
 * @returns {void}
 */
function removeRule(index) {
  ingressRows.splice(index, 1)
}

/**
 * 把结构化行转成 cloudflared ingress 规则
 * @returns {Array<{hostname: string, service: string}>} 规则数组
 */
function buildIngress() {
  const rules = []
  for (const row of ingressRows) {
    if (!row.port || !row.host) {
      continue
    }
    rules.push({
      hostname: row.hostname.trim(),
      service: `${row.proto}://${row.host}:${row.port}`
    })
  }
  return rules
}

/**
 * 提交表单：区分新增与更新
 * @returns {Promise<void>}
 */
async function submit() {
  errorMsg.value = ''
  const ingress = form.type === 'named' ? buildIngress() : []
  if (form.type === 'named' && ingress.length === 0 && !form.credentialsPath) {
    errorMsg.value = '命名隧道至少添加一条 ingress 规则，或填写凭据文件路径'
    return
  }
  const payload = {
    ...form,
    port: Number(form.port) || form.port,
    ingress
  }
  let res
  if (isEdit.value) {
    res = await tunnelStore.update(props.tunnel.id, payload)
  } else {
    res = await tunnelStore.add(payload)
  }
  if (!res.ok) {
    errorMsg.value = res.message
    return
  }
  emit('close')
}

/**
 * 打开文件选择器选择命名隧道凭据 JSON
 * @returns {Promise<void>}
 */
async function chooseCredentials() {
  errorMsg.value = ''
  const res = await window.tunnelApi.pickCredentials()
  if (res.ok) {
    form.credentialsPath = res.path
  }
}

/**
 * 在云端一键创建隧道并回填 ID 与凭据路径
 * @returns {Promise<void>}
 */
async function createCloudTunnel() {
  errorMsg.value = ''
  if (!form.name.trim()) {
    errorMsg.value = '请先填写隧道名称'
    return
  }
  busy.value = true
  const res = await cfStore.createTunnel(form.name.trim())
  busy.value = false
  if (!res.ok) {
    errorMsg.value = res.message
    return
  }
  form.tunnelId = res.tunnel.id
  form.credentialsPath = res.tunnel.credentialsPath
  errorMsg.value = `已创建云端隧道「${res.tunnel.name}」并自动回填信息`
}

/**
 * 加载账号隧道列表用于导入
 * @returns {Promise<void>}
 */
async function openImportList() {
  errorMsg.value = ''
  if (!cfStore.logined) {
    const status = await window.cfApi.loginStatus()
    cfStore.logined = status.logined
    if (!status.logined) {
      errorMsg.value = '尚未完成授权，请先到「cloudflared 管理」页登录'
      return
    }
  }
  busy.value = true
  const res = await cfStore.refreshTunnels()
  busy.value = false
  if (!res.ok) {
    errorMsg.value = res.message
    return
  }
  showImportList.value = true
}

/**
 * 选择账号下已有隧道并回填
 * @param {object} item - 云端隧道对象
 * @returns {void}
 */
function pickCloudTunnel(item) {
  form.tunnelId = item.id
  form.credentialsPath = item.credentialsPath || ''
  if (!form.name) {
    form.name = item.name
  }
  showImportList.value = false
}

onMounted(() => {
  cfStore.init()
})
</script>

<template>
  <div class="modal-mask" @click.self="emit('close')">
    <div class="modal">
      <h3>{{ isEdit ? '编辑隧道' : '新建隧道' }}</h3>

      <div class="form-row">
        <label>隧道名称</label>
        <input v-model="form.name" placeholder="例如：本地博客" />
      </div>

      <div class="form-row">
        <label>隧道类型</label>
        <div class="type-group">
          <div class="type-option" :class="{ selected: form.type === 'quick' }" @click="form.type = 'quick'">
            <b>快速隧道</b>
            <span>无需登录，自动获得 trycloudflare 随机公网地址</span>
          </div>
          <div class="type-option" :class="{ selected: form.type === 'named' }" @click="form.type = 'named'">
            <b>命名隧道</b>
            <span>绑定自有域名，稳定固定访问地址</span>
          </div>
        </div>
      </div>

      <!-- 快速隧道：单条本地服务映射 -->
      <div v-if="form.type === 'quick'" class="form-inline">
        <div class="form-row">
          <label>协议</label>
          <select v-model="form.proto">
            <option value="http">HTTP</option>
            <option value="https">HTTPS</option>
          </select>
        </div>
        <div class="form-row">
          <label>本地主机</label>
          <input v-model="form.host" placeholder="localhost" />
        </div>
        <div class="form-row">
          <label>本地端口（必填）</label>
          <input v-model="form.port" placeholder="8080" />
        </div>
      </div>

      <!-- 命名隧道：云端隧道 + ingress 规则 -->
      <template v-if="form.type === 'named'">
        <div class="form-row">
          <label>云端隧道（ID）</label>
          <div class="form-inline">
            <input v-model="form.tunnelId" placeholder="隧道 UUID" />
            <button class="btn" :disabled="busy" @click="createCloudTunnel">一键创建</button>
            <button class="btn" :disabled="busy" @click="openImportList">从账号导入</button>
          </div>
        </div>
        <div class="form-row">
          <label>凭据 JSON 文件路径（一键创建/导入后自动回填）</label>
          <div class="form-inline">
            <input v-model="form.credentialsPath" placeholder="C:\Users\...\~\.cloudflared\xxx.json" />
            <button class="btn" @click="chooseCredentials">选择文件</button>
          </div>
        </div>

        <div class="form-row">
          <label>ingress 规则（域名 → 本地服务映射，可多条）</label>
          <div v-for="(row, i) in ingressRows" :key="i" class="rule-row">
            <input v-model="row.hostname" class="rule-hostname" placeholder="子域名.example.com（留空 = 所有主机名）" />
            <select v-model="row.proto" class="rule-proto">
              <option value="http">HTTP</option>
              <option value="https">HTTPS</option>
              <option value="ssh">SSH</option>
              <option value="rdp">RDP</option>
            </select>
            <input v-model="row.host" class="rule-host" placeholder="localhost" />
            <input v-model="row.port" class="rule-port" placeholder="端口" />
            <button class="btn btn-mini btn-danger" @click="removeRule(i)">删除</button>
          </div>
          <button class="btn btn-mini add-rule" @click="addRule">+ 添加规则</button>
        </div>
      </template>

      <div class="form-row checkbox-row">
        <label class="checkbox-label">
          <input v-model="form.autoRestart" type="checkbox" />
          进程异常退出时自动重启（最多 5 次，恢复运行后计数清零）
        </label>
      </div>

      <div v-if="errorMsg" class="error-msg">{{ errorMsg }}</div>

      <div class="modal-actions">
        <button class="btn" @click="emit('close')">取消</button>
        <button class="btn btn-primary" :disabled="busy" @click="submit">
          {{ isEdit ? '保存' : '创建' }}
        </button>
      </div>
    </div>

    <!-- 从账号导入的选择弹窗 -->
    <div v-if="showImportList" class="modal-mask inner-mask" @click.self="showImportList = false">
      <div class="modal">
        <h3>选择账号下的隧道</h3>
        <div v-if="cfStore.cloudTunnels.length === 0" class="empty-inline">账号下暂无隧道，可先「一键创建」。</div>
        <div
          v-for="item in cfStore.cloudTunnels"
          :key="item.id"
          class="import-item"
          @click="pickCloudTunnel(item)"
        >
          <b>{{ item.name }}</b>
          <span class="mono">{{ item.id.slice(0, 12) }}...</span>
        </div>
        <div class="modal-actions">
          <button class="btn" @click="showImportList = false">取消</button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.rule-row {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
}

.rule-hostname {
  flex: 2.4;
}

.rule-proto {
  flex: 0.8 !important;
  width: auto !important;
  /* 窄框文字居中，避免左对齐导致左右留白不对称 */
  text-align: center;
  text-align-last: center;
}

.rule-host {
  flex: 1.2;
}

.rule-port {
  flex: 0.8;
}

.rule-row input,
.rule-row select {
  background: #12151b;
  border: 1px solid #33383f;
  border-radius: 8px;
  color: #e2e5ea;
  padding: 8px 10px;
  font-size: 13px;
  outline: none;
}

.add-rule {
  margin-top: 4px;
}

.inner-mask {
  z-index: 200;
}

.import-item {
  padding: 10px 12px;
  border: 1px solid #33383f;
  border-radius: 8px;
  margin-bottom: 8px;
  cursor: pointer;
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 10px;
}

.import-item:hover {
  border-color: #f6821f;
}

.mono {
  font-family: Consolas, monospace;
  font-size: 12px;
  color: #7b8190;
}

.empty-inline {
  color: #7b8190;
  font-size: 13px;
  padding: 8px 0;
}
</style>
