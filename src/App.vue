<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import IconChat from '@/kernel/app/assets/tab-icons/IconChat.vue'
import IconSliders from '@/kernel/app/assets/tab-icons/IconSliders.vue'
import IconUser from '@/kernel/app/assets/tab-icons/IconUser.vue'
import IconWrench from '@/kernel/app/assets/tab-icons/IconWrench.vue'
import { registerTab, useTabProjection } from '@/kernel/app/view-registry'
import ChatHomeView from '@/kernel/app/views/ChatHomeView.vue'
import PlaceholderView from '@/kernel/app/views/PlaceholderView.vue'
import SettingsPlaceholderView from '@/kernel/app/views/SettingsPlaceholderView.vue'

// 四 tab 信息架构(spec v1.1 §02)经注册表注册 —— tab 栏是投影,不是硬编码;
// M2+ 起角色卡工坊(角色 tab,首页级)与插件聚合视图走同一条入驻路。
const disposers = [
  registerTab({ id: 'chat', title: '对话', icon: IconChat, component: ChatHomeView, order: 10 }),
  registerTab({
    id: 'characters',
    title: '角色',
    icon: IconUser,
    component: PlaceholderView,
    props: {
      title: '角色',
      note: '角色卡工坊 · 内置插件(首页级视图,M2+ 入驻):导卡 → 进卡 → 在卡内长出剧情',
    },
    order: 20,
  }),
  registerTab({
    id: 'tools',
    title: '工具',
    icon: IconWrench,
    component: PlaceholderView,
    props: {
      title: '工具',
      note: '插件视图聚合页(M2+ 随插件运行时入驻):提示词工程 · 记忆与数据 · 扩展 · 社区内容',
    },
    order: 30,
  }),
  registerTab({
    id: 'settings',
    title: '设置',
    icon: IconSliders,
    component: SettingsPlaceholderView,
    order: 40,
  }),
]
onUnmounted(() => {
  disposers.forEach((dispose) => dispose())
})

const tabs = useTabProjection()
const activeId = ref(tabs.value[0]?.id ?? '')
const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeId.value) ?? tabs.value[0])
</script>

<template>
  <div class="flex h-dvh flex-col bg-bg text-ink">
    <div class="min-h-0 flex-1">
      <component
        :is="activeTab.component"
        v-bind="activeTab.props"
      />
    </div>

    <nav
      class="shrink-0 border-t border-line bg-card"
      aria-label="主导航"
    >
      <div class="mx-auto flex max-w-xl pb-[env(safe-area-inset-bottom)]">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="relative flex min-h-[44px] flex-1 flex-col items-center justify-end gap-0.5 pb-1.5 pt-2 text-xs"
          :class="tab.id === activeId ? 'text-primary' : 'text-ink-3'"
          :aria-current="tab.id === activeId ? 'page' : undefined"
          @click="activeId = tab.id"
        >
          <component
            :is="tab.icon"
            class="h-6 w-6"
          />
          <span>{{ tab.title }}</span>
          <span
            v-if="tab.id === activeId"
            class="absolute inset-x-7 top-0 h-0.5 rounded-full bg-primary"
          />
        </button>
      </div>
    </nav>
  </div>
</template>
