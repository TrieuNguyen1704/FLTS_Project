import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    // Trang chủ — redirect theo trạng thái đăng nhập
    {
      path: '/lecturer/courses',
      name: 'course-workspace',
      component: () => import('../views/CourseWorkspaceView.vue'),
      meta: { requiresAuth: true, role: 'lecturer' },
    },
    {
      path: '/courses/:id',
      name: 'course-detail',
      component: () => import('../views/CourseWorkspaceView.vue'),
      meta: { requiresAuth: true, role: 'lecturer' },
    },
    // Sprint 3: trình chỉnh sửa Quiz của Giảng viên (FAST-05)
    {
      path: '/lecturer/courses/:courseId/quizzes/:learningObjectId/edit',
      name: 'lecturer-quiz-edit',
      component: () => import('@/views/QuizEditorView.vue'),
      meta: { requiresAuth: true, role: 'lecturer' },
    },
    {
      path: '/',
      name: 'home',
      redirect: () => {
        const token = localStorage.getItem('flts_token')
        const user = JSON.parse(localStorage.getItem('flts_user') || 'null')
        if (!token) return { name: 'login' }
        if (user?.role === 'lecturer') return { name: 'lecturer-dashboard' }
        if (user?.role === 'admin') return { name: 'admin-dashboard' }
        return { name: 'student-dashboard' }
      },
    },

    // --- Auth ---
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/auth/LoginView.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/register',
      name: 'register',
      component: () => import('@/views/auth/RegisterView.vue'),
      meta: { guestOnly: true },
    },
    {
      path: '/forgot-password',
      name: 'forgot-password',
      component: () => import('@/views/auth/ForgotPasswordView.vue'),
      meta: { guestOnly: true },
    },

    // --- Dashboard (yêu cầu đăng nhập) ---
    {
      path: '/dashboard/lecturer',
      name: 'lecturer-dashboard',
      component: () => import('@/views/dashboard/LecturerDashboardView.vue'),
      meta: { requiresAuth: true, role: 'lecturer' },
    },
    {
      path: '/dashboard/student',
      name: 'student-dashboard',
      component: () => import('@/views/dashboard/StudentDashboardView.vue'),
      meta: { requiresAuth: true, role: 'student' },
    },

    // --- Student: khóa học và Quiz (Sprint 3) ---
    {
      path: '/student/courses',
      name: 'student-courses',
      component: () => import('@/views/student/StudentCoursesView.vue'),
      meta: { requiresAuth: true, role: 'student' },
    },
    {
      path: '/student/courses/:courseId',
      name: 'student-course',
      component: () => import('@/views/student/StudentCourseView.vue'),
      meta: { requiresAuth: true, role: 'student' },
    },
    {
      path: '/student/courses/:courseId/quizzes/:learningObjectId',
      name: 'student-quiz',
      component: () => import('@/views/student/StudentQuizPlayerView.vue'),
      meta: { requiresAuth: true, role: 'student' },
    },
    {
      path: '/dashboard/admin',
      name: 'admin-dashboard',
      component: () => import('@/views/dashboard/AdminDashboardView.vue'),
      meta: { requiresAuth: true, role: 'admin' },
    },

    // --- 404 ---
    {
      path: '/:pathMatch(.*)*',
      name: 'not-found',
      component: () => import('@/views/NotFoundView.vue'),
    },
  ],
})

/**
 * Navigation Guard toàn cục:
 * - requiresAuth: chặn người chưa đăng nhập
 * - guestOnly: chặn người đã đăng nhập vào trang Login/Register
 * - role: kiểm tra đúng vai trò mới cho vào
 */
router.beforeEach((to, _from) => {
  const token = localStorage.getItem('flts_token')
  const user = JSON.parse(localStorage.getItem('flts_user') || 'null')

  // Trang chỉ dành cho khách — redirect về dashboard nếu đã đăng nhập
  if (to.meta.guestOnly && token) {
    if (user?.role === 'lecturer') return { name: 'lecturer-dashboard' }
    if (user?.role === 'admin') return { name: 'admin-dashboard' }
    return { name: 'student-dashboard' }
  }

  // Trang yêu cầu đăng nhập — redirect về login nếu chưa có token
  if (to.meta.requiresAuth && !token) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  // Kiểm tra đúng vai trò
  if (to.meta.role && user?.role !== to.meta.role) {
    if (user?.role === 'lecturer') return { name: 'lecturer-dashboard' }
    if (user?.role === 'admin') return { name: 'admin-dashboard' }
    return { name: 'student-dashboard' }
  }
})

export default router
