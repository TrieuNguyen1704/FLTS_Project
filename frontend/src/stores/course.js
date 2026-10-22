import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import api from '@/services/api'

/**
 * Store quản lý khóa học, tài liệu và RAG Workbench (Sprint 2 — HUNG).
 * Quản lý danh sách tài liệu theo khóa học, trạng thái xử lý AI,
 * và tương tác RAG (hỏi đáp kèm dẫn chứng).
 */
export const useCourseStore = defineStore('course', () => {
  // --- State ---
  const currentCourse = ref(null)
  const documents = ref([])
  const isLoading = ref(false)
  const isProcessing = ref(false)
  const error = ref(null)

  // RAG Workbench state
  const ragQuery = ref('')
  const ragAnswer = ref(null)
  const ragSources = ref([])
  const isRagLoading = ref(false)
  const ragError = ref(null)

  // --- Getters ---
  const pendingDocuments = computed(() =>
    documents.value.filter((d) => d.status === 'uploaded_pending_processing'),
  )
  const processingDocuments = computed(() =>
    documents.value.filter((d) => d.status === 'processing'),
  )
  const processedDocuments = computed(() =>
    documents.value.filter((d) => d.status === 'processed'),
  )
  const failedDocuments = computed(() =>
    documents.value.filter((d) => d.status === 'failed'),
  )

  // --- Actions ---

  /**
   * Lấy chi tiết khóa học theo ID — gọi GET /api/courses/{id}
   * @param {number|string} courseId
   */
  async function fetchCourse(courseId) {
    isLoading.value = true
    error.value = null
    try {
      const response = await api.get(`/courses/${courseId}`)
      currentCourse.value = response.data.data || response.data
    } catch (err) {
      error.value =
        err.response?.data?.message ||
        'Không thể tải thông tin khóa học. Vui lòng thử lại.'
      // Fallback dữ liệu mẫu khi backend chưa sẵn sàng
      currentCourse.value = getMockCourse(courseId)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Lấy danh sách tài liệu của khóa học — gọi GET /api/courses/{courseId}/documents
   * @param {number|string} courseId
   */
  async function fetchDocuments(courseId) {
    isLoading.value = true
    error.value = null
    try {
      const response = await api.get(`/courses/${courseId}/documents`)
      documents.value = response.data.data || response.data
    } catch {
      // Fallback dữ liệu mẫu khi backend chưa sẵn sàng
      documents.value = getMockDocuments(courseId)
    } finally {
      isLoading.value = false
    }
  }

  /**
   * Bắt đầu xử lý AI cho một tài liệu — gọi POST /api/documents/{id}/process
   * @param {number} documentId
   */
  async function startAiProcessing(documentId) {
    isProcessing.value = true
    error.value = null
    try {
      await api.post(`/documents/${documentId}/process`)
      // Cập nhật trạng thái local ngay lập tức
      const doc = documents.value.find((d) => d.id === documentId)
      if (doc) doc.status = 'processing'
    } catch (err) {
      // Demo: cập nhật trạng thái local ngay cả khi API chưa sẵn sàng
      const doc = documents.value.find((d) => d.id === documentId)
      if (doc) doc.status = 'processing'
      // Simulate chuyển sang processed sau 3 giây
      setTimeout(() => {
        const d = documents.value.find((dd) => dd.id === documentId)
        if (d && d.status === 'processing') {
          d.status = 'processed'
          d.processed_at = new Date().toLocaleString('vi-VN')
        }
      }, 3000)
    } finally {
      isProcessing.value = false
    }
  }

  /**
   * Thử lại xử lý AI cho tài liệu bị lỗi — gọi POST /api/documents/{id}/retry
   * @param {number} documentId
   */
  async function retryProcessing(documentId) {
    isProcessing.value = true
    error.value = null
    try {
      await api.post(`/documents/${documentId}/retry`)
      const doc = documents.value.find((d) => d.id === documentId)
      if (doc) doc.status = 'processing'
    } catch {
      // Demo: cập nhật trạng thái local
      const doc = documents.value.find((d) => d.id === documentId)
      if (doc) doc.status = 'processing'
      setTimeout(() => {
        const d = documents.value.find((dd) => dd.id === documentId)
        if (d && d.status === 'processing') {
          d.status = 'processed'
          d.processed_at = new Date().toLocaleString('vi-VN')
        }
      }, 3000)
    } finally {
      isProcessing.value = false
    }
  }

  /**
   * Gửi câu hỏi RAG — gọi POST /api/courses/{courseId}/rag/query
   * @param {number|string} courseId
   * @param {string} query
   */
  async function sendRagQuery(courseId, query) {
    if (!query.trim()) return
    isRagLoading.value = true
    ragError.value = null
    ragAnswer.value = null
    ragSources.value = []
    try {
      const response = await api.post(`/courses/${courseId}/rag/query`, {
        question: query,
      })
      ragAnswer.value = response.data.answer
      ragSources.value = response.data.sources || []
    } catch {
      // Demo fallback khi API chưa sẵn sàng
      ragAnswer.value = getMockRagAnswer(query)
      ragSources.value = getMockRagSources()
    } finally {
      isRagLoading.value = false
    }
  }

  /**
   * Reset RAG Workbench state
   */
  function clearRag() {
    ragQuery.value = ''
    ragAnswer.value = null
    ragSources.value = []
    ragError.value = null
  }

  // --- Dữ liệu mẫu (Demo) ---

  function getMockCourse(courseId) {
    const courses = {
      1: {
        id: 1,
        code: 'ENG101',
        name: 'Tiếng Anh Giao Tiếp Cơ Bản',
        description:
          'Khóa học giúp sinh viên nắm vững nền tảng giao tiếp tiếng Anh qua các chủ đề thực tế hàng ngày.',
        students_count: 42,
        documents_count: 5,
      },
      2: {
        id: 2,
        code: 'ENG202',
        name: 'Tiếng Anh Học Thuật & Viết Luận',
        description:
          'Phát triển kỹ năng viết học thuật, đọc hiểu tài liệu chuyên ngành và trình bày ý tưởng nghiên cứu.',
        students_count: 38,
        documents_count: 4,
      },
      3: {
        id: 3,
        code: 'IELTS-B2',
        name: 'Luyện thi IELTS Chuyên Sâu B2+',
        description:
          'Luyện thi IELTS toàn diện 4 kỹ năng: Listening, Reading, Writing, Speaking đạt mục tiêu 6.0–7.0.',
        students_count: 25,
        documents_count: 3,
      },
    }
    return courses[courseId] || courses[1]
  }

  function getMockDocuments(courseId) {
    const docSets = {
      1: [
        {
          id: 101,
          file_name: 'Grammar_Unit_1_Present_Tenses.pdf',
          mime_type: 'application/pdf',
          file_size: 2516582,
          status: 'processed',
          created_at: '2026-10-18 14:30:00',
          processed_at: '2026-10-18 14:35:12',
        },
        {
          id: 102,
          file_name: 'Vocabulary_Daily_Routines.docx',
          mime_type:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          file_size: 1887436,
          status: 'processing',
          created_at: '2026-10-19 09:15:00',
          processed_at: null,
        },
        {
          id: 103,
          file_name: 'Listening_Comprehension_Unit1.pdf',
          mime_type: 'application/pdf',
          file_size: 4298137,
          status: 'uploaded_pending_processing',
          created_at: '2026-10-20 10:00:00',
          processed_at: null,
        },
        {
          id: 104,
          file_name: 'Speaking_Practice_Dialogues.pdf',
          mime_type: 'application/pdf',
          file_size: 3145728,
          status: 'failed',
          created_at: '2026-10-19 16:45:00',
          processed_at: null,
          error_message: 'Không thể trích xuất nội dung: file bị bảo vệ mật khẩu.',
        },
        {
          id: 105,
          file_name: 'Reading_Passage_Travel_Topics.docx',
          mime_type:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          file_size: 1572864,
          status: 'processed',
          created_at: '2026-10-17 08:20:00',
          processed_at: '2026-10-17 08:26:45',
        },
      ],
      2: [
        {
          id: 201,
          file_name: 'Academic_Writing_Task2_Guide.docx',
          mime_type:
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
          file_size: 1887436,
          status: 'processed',
          created_at: '2026-10-18 11:00:00',
          processed_at: '2026-10-18 11:04:33',
        },
        {
          id: 202,
          file_name: 'Research_Paper_Structure.pdf',
          mime_type: 'application/pdf',
          file_size: 5242880,
          status: 'uploaded_pending_processing',
          created_at: '2026-10-20 14:20:00',
          processed_at: null,
        },
      ],
      3: [
        {
          id: 301,
          file_name: 'IELTS_Speaking_Part2_Prompts.pdf',
          mime_type: 'application/pdf',
          file_size: 4194304,
          status: 'processing',
          created_at: '2026-10-20 08:10:00',
          processed_at: null,
        },
        {
          id: 302,
          file_name: 'IELTS_Writing_Task1_Charts.pdf',
          mime_type: 'application/pdf',
          file_size: 3670016,
          status: 'processed',
          created_at: '2026-10-16 15:30:00',
          processed_at: '2026-10-16 15:37:21',
        },
      ],
    }
    return docSets[courseId] || docSets[1]
  }

  function getMockRagAnswer(query) {
    return `## Câu trả lời từ AI

Dựa trên tài liệu giảng dạy đã tải lên, đây là phân tích cho câu hỏi: **"${query}"**

**Nội dung chính:**

Theo tài liệu *Grammar Unit 1*, thì Present Simple được sử dụng để diễn tả:
- Thói quen, hành động lặp đi lặp lại
- Sự thật hiển nhiên, chân lý khoa học
- Lịch trình, thời gian biểu cố định

**Cấu trúc:**
- Khẳng định: \`S + V(s/es) + O\`
- Phủ định: \`S + do/does + not + V + O\`
- Nghi vấn: \`Do/Does + S + V + O?\`

> **Lưu ý:** Động từ thêm "es" khi chủ ngữ là ngôi thứ 3 số ít (he, she, it) và động từ kết thúc bằng -s, -sh, -ch, -x, -o.`
  }

  function getMockRagSources() {
    return [
      {
        document_name: 'Grammar_Unit_1_Present_Tenses.pdf',
        page: 3,
        excerpt:
          'The Present Simple tense is used for habits, routines, and general truths. It is formed by using the base form of the verb, adding -s or -es for third person singular subjects.',
      },
      {
        document_name: 'Grammar_Unit_1_Present_Tenses.pdf',
        page: 5,
        excerpt:
          'Negative sentences are formed using "do not" (don\'t) or "does not" (doesn\'t) before the base verb. Questions use "Do" or "Does" at the beginning.',
      },
      {
        document_name: 'Vocabulary_Daily_Routines.docx',
        page: 1,
        excerpt:
          'Daily routine vocabulary includes: wake up, get dressed, have breakfast, go to work/school, have lunch, come home, have dinner, go to bed. These are typically expressed using Present Simple.',
      },
    ]
  }

  return {
    // State
    currentCourse,
    documents,
    isLoading,
    isProcessing,
    error,
    ragQuery,
    ragAnswer,
    ragSources,
    isRagLoading,
    ragError,
    // Getters
    pendingDocuments,
    processingDocuments,
    processedDocuments,
    failedDocuments,
    // Actions
    fetchCourse,
    fetchDocuments,
    startAiProcessing,
    retryProcessing,
    sendRagQuery,
    clearRag,
  }
})
