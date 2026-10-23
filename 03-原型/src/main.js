import { createApp } from 'vue'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import * as ElementPlusIcons from '@element-plus/icons-vue'

import '@/styles/fonts.css'          // @font-face（DIN 数字字体），最先声明
import 'element-plus/dist/index.css' // 顺序要求：先 EP
import '@/styles/tokens.css'         // 再 tokens，才能覆盖 --el-* 变量
import '@/styles/app.css'            // 最后：布局与业务类

import App from './App.vue'
import router from './router'

const app = createApp(App)

// 全量注册图标，原型阶段便于直接使用 <el-icon><House/></el-icon>
for (const [key, comp] of Object.entries(ElementPlusIcons)) {
  app.component(key, comp)
}

app.use(ElementPlus, { locale: zhCn, size: 'default' })
app.use(router)
app.mount('#app')
