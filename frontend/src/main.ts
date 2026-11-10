import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import { router } from './router/index';
import './style.css';
import './entry-forms.css';
import './modules/finance/finance.css';
createApp(App).use(createPinia()).use(router).mount('#app');
