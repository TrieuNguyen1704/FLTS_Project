import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './assets/main.css'
// CSS + font của KaTeX cho MathText; import ở đây (một lần) để test node không phải nạp file .css.
import 'katex/dist/katex.min.css'

const app = createApp(App)

app.use(createPinia())
app.use(router)
app.mount('#app')
