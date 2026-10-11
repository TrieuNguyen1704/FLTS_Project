<script setup>
import { ref } from 'vue'

defineProps({ busy: Boolean, progress: { type: Number, default: 0 } })
const emit = defineEmits(['selected'])
const input = ref(null)
const selected = ref(null)
const error = ref('')
const dragging = ref(false)

function choose(files) {
  selected.value = null
  error.value = ''
  if (!files?.length) return
  if (files.length !== 1) { error.value = 'Vui lòng chọn một tài liệu mỗi lần.'; return }
  const file = files[0]
  if (!['pdf', 'doc', 'docx'].includes(file.name.split('.').pop().toLowerCase())) {
    error.value = 'Chỉ chấp nhận PDF, DOC hoặc DOCX.'
  } else if (file.size > 20 * 1024 * 1024) {
    error.value = 'Tài liệu vượt quá giới hạn 20 MB.'
  } else if (!file.size) {
    error.value = 'Tài liệu trống. Vui lòng chọn tệp khác.'
  } else selected.value = file
}

function inputChanged(event) { choose(event.target.files); event.target.value = '' }
function dropped(event, busy) {
  dragging.value = false
  if (!busy) choose(event.dataTransfer.files)
}
</script>

<template>
  <section class="file-dropzone" :class="{ active: dragging }" :aria-busy="busy"
    @dragover.prevent="dragging = !busy" @dragleave.prevent="dragging = false" @drop.prevent="dropped($event, busy)">
    <h3>Tải lên tài liệu giảng dạy</h3>
    <p>Kéo thả tài liệu vào đây hoặc <button type="button" :disabled="busy" @click="input.click()">Chọn tệp</button>.</p>
    <input ref="input" type="file" hidden accept=".pdf,.doc,.docx" :disabled="busy" @change="inputChanged" />
    <small>PDF, DOC, DOCX · Tối đa 20 MB</small>
    <p v-if="error" role="alert">{{ error }}</p>
    <div v-if="selected" aria-live="polite">
      <p><strong>{{ selected.name }}</strong> · {{ (selected.size / 1024).toFixed(1) }} KB</p>
      <button type="button" :disabled="busy" @click="emit('selected', selected)">Tải lên tài liệu</button>
      <button type="button" :disabled="busy" @click="selected = null">Bỏ chọn</button>
    </div>
    <div v-if="busy" role="status" aria-live="polite">
      <progress :value="progress" max="100" aria-label="Tiến trình tải tài liệu" />
      <p>{{ progress < 100 ? `Đang tải: ${progress}%` : 'Đã gửi tệp. Đang chờ hệ thống xác nhận lưu.' }}</p>
    </div>
  </section>
</template>

<style scoped>
.file-dropzone { padding: 1.5rem; border: 2px dashed #94a3b8; border-radius: .75rem; }
.active { border-color: #2563eb; background: #eff6ff; }
button { margin: .3rem; padding: .5rem .8rem; cursor: pointer; }
button:disabled { cursor: wait; opacity: .6; }
[role=alert] { color: #b91c1c; }
progress { width: 100%; }
strong { overflow-wrap: anywhere; }
</style>
