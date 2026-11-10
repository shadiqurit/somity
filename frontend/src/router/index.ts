import { createRouter, createWebHistory } from 'vue-router';
import { useAuthStore } from '../stores/auth';
import AppLayout from '../layouts/AppLayout.vue';
export const router = createRouter({ history: createWebHistory(), routes: [
  { path: '/login', component: () => import('../views/LoginView.vue'), meta: { public: true } },
  { path: '/change-password', component: () => import('../views/PasswordView.vue') },
  { path: '/', component: AppLayout, children: [
    { path: '', component: () => import('../views/DashboardView.vue'), meta: { permission: 'dashboard.read', title: 'Overview' } },
    { path: 'members', component: () => import('../modules/members/MemberList.vue'), meta: { permission: 'members.read', title: 'Members' } },
    { path: 'members/new', redirect: { path: '/members', query: { entry: 'new' } }, meta: { permission: 'members.write' } },
    { path: 'members/:id/edit', redirect: to => ({ path: `/members/${String(to.params.id)}`, query: { entry: 'edit' } }), meta: { permission: 'members.write' } },
    { path: 'members/:id', component: () => import('../modules/members/MemberProfile.vue'), meta: { permission: 'members.read', title: 'Member profile' } },
    { path: 'my-profile', component: () => import('../modules/members/MemberProfile.vue'), meta: { permission: 'profile.read', title: 'My dashboard' } },
    { path: 'societies', component: () => import('../views/SocietiesView.vue'), meta: { permission: 'societies.manage', title: 'Societies' } },
    { path: 'users', component: () => import('../views/UsersView.vue'), meta: { permission: 'users.manage', title: 'Team & access' } },
  ] },
  { path: '/:pathMatch(.*)*', component: () => import('../views/NotFoundView.vue'), meta: { public: true } },
] });
router.beforeEach(async to => {
  const auth = useAuthStore();
  await auth.initialize();
  if (!auth.user && !to.meta.public) return '/login';
  if (auth.user?.mustChangePassword && to.path !== '/change-password') return '/change-password';
  if (auth.user && !auth.user.societyId && auth.user.isSuperAdmin && !['/societies', '/change-password'].includes(to.path)) return '/societies';
  if (auth.user && to.path === '/login') return auth.isStaff ? '/' : '/my-profile';
  if (to.meta.permission && !auth.can(String(to.meta.permission))) return auth.isStaff ? '/' : '/my-profile';
});
