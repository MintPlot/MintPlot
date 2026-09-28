import { createApp } from 'vue'
import './main.css'
import App from './App.vue'
import { initMpTheme } from '@/kernel/design/theme'

initMpTheme()
createApp(App).mount('#app')
