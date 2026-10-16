<script setup>
import { onMounted, reactive, ref } from 'vue'
import FileDropzone from '../components/FileDropzone.vue'
import { courseDocuments } from '../services/courseDocuments'

const courses = ref([])
const selectedCourse = ref(null)
const documents = ref([])
const courseMeta = ref({ current_page: 1, last_page: 1 })
const documentMeta = ref({ current_page: 1, last_page: 1 })
const form = reactive({ name: '', code: '', description: '' })
const loading = ref(false)
const uploading = ref(false)
const progress = ref(0)
const error = ref('')
const message = ref('')
const dropzoneKey = ref(0)
const hasSession = Boolean(localStorage.getItem('flts_token'))

async function loadCourses(page = 1) {
  loading.value = true
  error.value = ''
  try {
    const data = await courseDocuments.listCourses(page)
    courses.value = data.courses
    courseMeta.value = data.meta
  } catch (e) { error.value = e.message } finally { loading.value = false }
}
async function openCourse(course) {
  error.value = ''
  try {
    selectedCourse.value = (await courseDocuments.course(course.id)).course
    await loadDocuments()
  } catch (e) { error.value = e.message }
}
async function loadDocuments(page = 1) {
  const data = await courseDocuments.listDocuments(selectedCourse.value.id, page)
  documents.value = data.documents
  documentMeta.value = data.meta
}
async function documentPage(page) {
  try { await loadDocuments(page) } catch (e) { error.value = e.message }
}
async function createCourse() {
  loading.value = true
  error.value = ''
  try {
    const { course } = await courseDocuments.createCourse({ name: form.name.trim(), code: form.code.trim(), description: form.description.trim() || null })
    Object.assign(form, { name: '', code: '', description: '' })
    await loadCourses()
    await openCourse(course)
    message.value = 'Đã tạo khóa học.'
  } catch (e) { error.value = e.message } finally { loading.value = false }
}
async function upload(file) {
  if (uploading.value) return
  uploading.value = true
  progress.value = 0
  error.value = ''
  message.value = ''
  try {
    await courseDocuments.upload(selectedCourse.value.id, file, (value) => { progress.value = value })
    dropzoneKey.value++
    message.value = 'Đã lưu tài liệu. Trạng thái: Chờ xử lý.'
    await loadDocuments()
  } catch (e) { error.value = e.message } finally { uploading.value = false }
}
onMounted(() => { if (hasSession) loadCourses() })
</script>

<template>
  <main class="course-workspace">
    <h1>Khóa học và tài liệu giảng dạy</h1>
    <p v-if="!hasSession">Vui lòng đăng nhập bằng tài khoản giảng viên để sử dụng chức năng này.</p>
    <template v-else>
      <p v-if="error" role="alert">{{ error }}</p>
      <p v-if="message" role="status">{{ message }}</p>
      <form @submit.prevent="createCourse">
        <h2>Tạo khóa học</h2>
        <label>Tên khóa học <input v-model="form.name" required maxlength="160" /></label>
        <label>Mã khóa học <input v-model="form.code" required maxlength="50" /></label>
        <label>Mô tả <textarea v-model="form.description" maxlength="2000" /></label>
        <button :disabled="loading || uploading">Tạo khóa học</button>
      </form>
      <h2>Khóa học của tôi</h2>
      <p v-if="loading">Đang tải...</p>
      <p v-else-if="!courses.length">Chưa có khóa học.</p>
      <ul><li v-for="course in courses" :key="course.id"><button :disabled="uploading" @click="openCourse(course)">{{ course.code }} — {{ course.name }}</button></li></ul>
      <nav aria-label="Phân trang khóa học">
        <button :disabled="loading || uploading || courseMeta.current_page <= 1" @click="loadCourses(courseMeta.current_page - 1)">Trước</button>
        <span>Trang {{ courseMeta.current_page }} / {{ courseMeta.last_page }}</span>
        <button :disabled="loading || uploading || courseMeta.current_page >= courseMeta.last_page" @click="loadCourses(courseMeta.current_page + 1)">Sau</button>
      </nav>
      <section v-if="selectedCourse">
        <h2>{{ selectedCourse.name }}</h2>
        <p>{{ selectedCourse.description }}</p>
        <FileDropzone :key="dropzoneKey" :busy="uploading" :progress="progress" @selected="upload" />
        <h3>Tài liệu đã lưu</h3>
        <ul><li v-for="doc in documents" :key="doc.id">{{ doc.original_name }} · {{ (doc.file_size / 1024).toFixed(1) }} KB · {{ doc.processing_status === 'uploaded_pending_processing' ? 'Chờ xử lý' : doc.processing_status }}</li></ul>
        <nav aria-label="Phân trang tài liệu">
          <button :disabled="uploading || documentMeta.current_page <= 1" @click="documentPage(documentMeta.current_page - 1)">Trước</button>
          <span>Trang {{ documentMeta.current_page }} / {{ documentMeta.last_page }}</span>
          <button :disabled="uploading || documentMeta.current_page >= documentMeta.last_page" @click="documentPage(documentMeta.current_page + 1)">Sau</button>
        </nav>
      </section>
    </template>
  </main>
</template>

<style scoped>
.course-workspace { max-width: 900px; margin: auto; padding: 2rem 1rem; }
label { display: grid; gap: .4rem; margin: .8rem 0; }
input, textarea, button { padding: .6rem; }
nav { display: flex; gap: 1rem; align-items: center; margin: 1rem 0; }
li { margin: .5rem 0; overflow-wrap: anywhere; }
[role=alert] { color: #b91c1c; }
</style>
