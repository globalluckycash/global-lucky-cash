import { createRouter, createWebHistory } from 'vue-router'

const routes = [
  { path: '/',           component: () => import('@/views/HomeView.vue') },
  { path: '/rules',      component: () => import('@/views/RulesView.vue') },
  { path: '/results',    component: () => import('@/views/ResultsView.vue') },
  { path: '/my-tickets', component: () => import('@/views/MyTicketsView.vue') },
  { path: '/donate',     component: () => import('@/views/DonateView.vue') },
  { path: '/draw-process', component: () => import('@/views/DrawProcessView.vue') },
  { path: '/faq',        component: () => import('@/views/FaqView.vue') },
  { path: '/whitepaper', component: () => import('@/views/WhitepaperView.vue') },
  { path: '/terms',      component: () => import('@/views/TermsView.vue') },
  { path: '/verify',     component: () => import('@/views/VerifyView.vue') },
  { path: '/:pathMatch(.*)*', redirect: '/' },
]

export const router = createRouter({
  history: createWebHistory(),
  routes,
})
