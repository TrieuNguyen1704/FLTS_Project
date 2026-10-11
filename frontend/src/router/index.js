import { createRouter, createWebHistory } from 'vue-router'
import HomeView from '../views/HomeView.vue'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/lecturer/courses',
      name: 'course-workspace',
      component: () => import('../views/CourseWorkspaceView.vue'),
    },
    {
      path: '/',
      name: 'home',
      component: HomeView
    }
  ]
})

export default router
