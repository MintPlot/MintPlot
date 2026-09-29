<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import IconChat from '@/kernel/app/assets/tab-icons/IconChat.vue'
import IconBars from '@/kernel/app/assets/tab-icons/IconBars.vue'
import IconUser from '@/kernel/app/assets/tab-icons/IconUser.vue'
import IconWrench from '@/kernel/app/assets/tab-icons/IconWrench.vue'
import { registerTab, useTabProjection } from '@/kernel/app/view-registry'
import { registerSettingsSection } from '@/kernel/app/settings-registry'
import ChatHomeView from '@/kernel/app/views/ChatHomeView.vue'
import PlaceholderView from '@/kernel/app/views/PlaceholderView.vue'
import SettingsView from '@/kernel/app/views/SettingsView.vue'
import AppearanceSection from '@/kernel/app/sections/AppearanceSection.vue'
import PluginManagerSection from '@/kernel/app/sections/PluginManagerSection.vue'
import ToastHost from '@/kernel/ui/ToastHost.vue'

// Four-tab IA (spec v1.1 §02) registered through the view registry — the tab bar is a
// projection of the registry, not hardcoded; from M2+ the card workshop (characters tab,
// home-level) and plugin aggregate views land through the same path.
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
    icon: IconBars,
    component: SettingsView,
    order: 40,
  }),
]

// Kernel-owned settings sections — the settings page is a registry projection;
// plugin sections join through the runtime (settings.section permission).
disposers.push(
  registerSettingsSection('kernel', { id: 'plugins', title: '插件', component: PluginManagerSection }, 10),
  registerSettingsSection('kernel', { id: 'appearance', title: '外观', component: AppearanceSection }, 80),
)

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

    <ToastHost />
  </div>
</template>
