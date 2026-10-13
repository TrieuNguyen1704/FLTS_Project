<script setup>
import { ref, computed } from 'vue'
import DashboardLayout from '@/layouts/DashboardLayout.vue'
import StatusBadge from '@/components/StatusBadge.vue'
import AppModal from '@/components/AppModal.vue'
import { useAuthStore } from '@/stores/auth'

const authStore = useAuthStore()
const user = computed(() => authStore.user)

// State Modal Tạo Khóa Học Mới
const showCreateCourseModal = ref(false)
const newCourse = ref({
  code: '',
  name: '',
  description: '',
})

// Dữ liệu mẫu ban đầu cho Giảng viên trong Sprint 1
const stats = [
  { label: 'Khóa học phụ trách', value: '3', icon: 'M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253', color: 'bg-blue-500' },
  { label: 'Tài liệu đã tải lên', value: '12', icon: 'M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z', color: 'bg-indigo-500' },
  { label: 'Đang xử lý AI', value: '2', icon: 'M13 10V3L4 14h7v7l9-11h-7z', color: 'bg-amber-500' },
  { label: 'Bộ câu hỏi đã tạo', value: '45', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', color: 'bg-emerald-500' },
]

const recentCourses = ref([
  { id: 1, code: 'ENG101', name: 'Tiếng Anh Giao Tiếp Cơ Bản', students: 42, documents: 5 },
  { id: 2, code: 'ENG202', name: 'Tiếng Anh Học Thuật & Viết Luận', students: 38, documents: 4 },
  { id: 3, code: 'IELTS-B2', name: 'Luyện thi IELTS Chuyên Sâu B2+', students: 25, documents: 3 },
])

const recentDocuments = ref([
  { id: 101, name: 'Grammar_Unit_1_Present_Tenses.pdf', size: '2.4 MB', course: 'ENG101', status: 'processed', time: '10 phút trước' },
  { id: 102, name: 'Academic_Writing_Task2_Guide.docx', size: '1.8 MB', course: 'ENG202', status: 'processing', time: '25 phút trước' },
  { id: 103, name: 'IELTS_Speaking_Part2_Prompts.pdf', size: '4.1 MB', course: 'IELTS-B2', status: 'uploaded_pending_processing', time: '1 giờ trước' },
])

function handleCreateCourse() {
  if (!newCourse.value.name.trim() || !newCourse.value.code.trim()) return
  recentCourses.value.unshift({
    id: Date.now(),
    code: newCourse.value.code.trim().toUpperCase(),
    name: newCourse.value.name.trim(),
    students: 0,
    documents: 0,
  })
  newCourse.value = { code: '', name: '', description: '' }
  showCreateCourseModal.value = false
}
</script>

<template>
  <DashboardLayout>
    <div class="space-y-6">
      <!-- Welcome Banner -->
      <div class="bg-gradient-to-r from-indigo-700 via-indigo-600 to-blue-600 rounded-2xl p-6 sm:p-8 text-white shadow-lg shadow-indigo-600/10 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <span class="inline-block px-2.5 py-1 rounded-full text-xs font-semibold bg-white/20 backdrop-blur-sm mb-3">
            Khu vực Giảng viên
          </span>
          <h1 class="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Xin chào, {{ user?.name || 'Giảng viên' }}!
          </h1>
          <p class="mt-2 text-indigo-100 text-sm max-w-xl">
            Chào mừng bạn đến với FLTS. Quản lý tài liệu và để AI hỗ trợ tự động trích xuất bài học, sinh câu hỏi trắc nghiệm thông minh.
          </p>
        </div>

        <div class="flex flex-wrap gap-3">
          <button
            type="button"
            class="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white text-indigo-700 font-semibold text-sm hover:bg-indigo-50 shadow-sm transition-all"
            @click="showCreateCourseModal = true"
          >
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 4v16m8-8H4" />
            </svg>
            Tạo khóa học
          </button>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div
          v-for="stat in stats"
          :key="stat.label"
          class="bg-white rounded-2xl p-5 border border-slate-200/80 shadow-sm flex items-center justify-between"
        >
          <div>
            <p class="text-xs font-medium text-slate-500">{{ stat.label }}</p>
            <p class="text-2xl font-bold text-slate-900 mt-1">{{ stat.value }}</p>
          </div>
          <div :class="['w-12 h-12 rounded-xl flex items-center justify-center text-white shadow-sm', stat.color]">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" :d="stat.icon" />
            </svg>
          </div>
        </div>
      </div>

      <!-- Hai cột: Khóa học của tôi & Tài liệu gần đây -->
      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- Khóa học phụ trách -->
        <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col">
          <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 class="font-bold text-slate-900 text-base">Khóa học phụ trách</h2>
            <button
              type="button"
              class="text-xs font-semibold text-indigo-600 hover:text-indigo-700"
              @click="showCreateCourseModal = true"
            >
              + Thêm mới
            </button>
          </div>
          <div class="divide-y divide-slate-100 flex-1">
            <div
              v-for="course in recentCourses"
              :key="course.id"
              class="p-4 hover:bg-slate-50/80 transition-colors flex items-center justify-between"
            >
              <div class="min-w-0 pr-4">
                <div class="flex items-center gap-2">
                  <span class="px-2 py-0.5 rounded text-[11px] font-bold bg-indigo-50 text-indigo-700">
                    {{ course.code }}
                  </span>
                  <h3 class="text-sm font-semibold text-slate-800 truncate">{{ course.name }}</h3>
                </div>
                <p class="text-xs text-slate-500 mt-1">
                  {{ course.students }} sinh viên • {{ course.documents }} tài liệu
                </p>
              </div>
              <button
                type="button"
                class="px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-medium text-slate-700 hover:bg-white hover:border-indigo-400 hover:text-indigo-600 transition-colors shrink-0"
              >
                Chi tiết
              </button>
            </div>
          </div>
        </div>

        <!-- Tài liệu vừa tải lên -->
        <div class="bg-white rounded-2xl border border-slate-200/80 shadow-sm overflow-hidden flex flex-col">
          <div class="px-6 py-4 border-b border-slate-100 flex items-center justify-between">
            <h2 class="font-bold text-slate-900 text-base">Trạng thái xử lý tài liệu AI</h2>
            <span class="text-xs text-slate-500">Tự động cập nhật</span>
          </div>
          <div class="divide-y divide-slate-100 flex-1">
            <div
              v-for="doc in recentDocuments"
              :key="doc.id"
              class="p-4 hover:bg-slate-50/80 transition-colors flex items-center justify-between"
            >
              <div class="min-w-0 pr-4">
                <p class="text-sm font-medium text-slate-900 truncate">{{ doc.name }}</p>
                <div class="flex items-center gap-2 mt-1 text-xs text-slate-500">
                  <span>{{ doc.course }}</span>
                  <span>•</span>
                  <span>{{ doc.size }}</span>
                  <span>•</span>
                  <span>{{ doc.time }}</span>
                </div>
              </div>
              <StatusBadge :status="doc.status" class="shrink-0" />
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Modal Tạo Khóa Học Mới -->
    <AppModal
      :show="showCreateCourseModal"
      title="Tạo khóa học mới"
      @close="showCreateCourseModal = false"
    >
      <form class="space-y-4" @submit.prevent="handleCreateCourse">
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">Mã khóa học *</label>
          <input
            v-model="newCourse.code"
            type="text"
            placeholder="VD: ENG301"
            class="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            required
          />
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">Tên khóa học *</label>
          <input
            v-model="newCourse.name"
            type="text"
            placeholder="VD: Tiếng Anh Thương Mại Quốc Tế"
            class="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            required
          />
        </div>
        <div>
          <label class="block text-xs font-semibold text-slate-700 mb-1">Mô tả khóa học</label>
          <textarea
            v-model="newCourse.description"
            rows="3"
            placeholder="Mô tả mục tiêu đầu ra và nội dung học..."
            class="w-full px-3 py-2 rounded-xl border border-slate-300 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none"
          ></textarea>
        </div>
      </form>
      <template #footer>
        <button
          type="button"
          class="px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold text-xs hover:bg-indigo-700 transition-colors"
          @click="handleCreateCourse"
        >
          Lưu khóa học
        </button>
        <button
          type="button"
          class="px-4 py-2 rounded-xl border border-slate-200 text-slate-700 font-semibold text-xs hover:bg-slate-100 transition-colors"
          @click="showCreateCourseModal = false"
        >
          Hủy bỏ
        </button>
      </template>
    </AppModal>
  </DashboardLayout>
</template>
