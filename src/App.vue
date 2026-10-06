<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'
import IconChat from '@/kernel/app/assets/tab-icons/IconChat.vue'
import IconBars from '@/kernel/app/assets/tab-icons/IconBars.vue'
import IconUser from '@/kernel/app/assets/tab-icons/IconUser.vue'
import IconWrench from '@/kernel/app/assets/tab-icons/IconWrench.vue'
import { registerTab, useTabProjection } from '@/kernel/app/view-registry'
import { registerSettingsSection } from '@/kernel/app/settings-registry'
import { useChatRoute } from '@/kernel/app/chat-router'
import ChatHomeView from '@/kernel/app/views/ChatHomeView.vue'
import ChatSessionView from '@/kernel/app/views/ChatSessionView.vue'
import CharactersView from '@/kernel/app/views/CharactersView.vue'
import ToolsView from '@/kernel/app/views/ToolsView.vue'
import SettingsView from '@/kernel/app/views/SettingsView.vue'
import ApiConfigSection from '@/kernel/app/sections/ApiConfigSection.vue'
import AppearanceSection from '@/kernel/app/sections/AppearanceSection.vue'
import UserPersonaSection from '@/kernel/app/sections/UserPersonaSection.vue'
import DiagnosticsSection from '@/kernel/app/sections/DiagnosticsSection.vue'
import TemplateAnalysisSection from '@/kernel/app/sections/TemplateAnalysisSection.vue'
import PresetSection from '@/kernel/app/sections/PresetSection.vue'
import MemorySettingsSection from '@/kernel/app/sections/MemorySettingsSection.vue'
import StorySettings from '@/kernel/app/sections/StorySettings.vue'
import ToastHost from '@/kernel/ui/ToastHost.vue'
import ConfirmDialogHost from '@/kernel/ui/ConfirmDialogHost.vue'
import FatalErrorHost from '@/kernel/ui/FatalErrorHost.vue'

// Four-tab IA (spec v1.2 §02) registered through the view registry — the tab bar is a
// projection of the registry, not hardcoded; from M2+ the card workshop (characters tab)
// and plugin aggregate views land through the same path.
const disposers = [
  registerTab({ id: 'chat', title: '对话', icon: IconChat, component: ChatHomeView, order: 10 }),
  registerTab({
    id: 'characters',
    title: '角色',
    icon: IconUser,
    component: CharactersView,
    order: 20,
  }),
  registerTab({
    id: 'tools',
    title: '工具',
    icon: IconWrench,
    component: ToolsView,
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

// Kernel-owned settings sections (M3-h): the settings page is a registry
// projection; kernel page sections declare placement 'settings' explicitly —
// the panel default is a plugin's own tools-tab entry. The plugin area (entry
// rows + switches) lives on the tools tab, not in this registry.
disposers.push(
  registerSettingsSection('kernel', { id: 'persona', title: '用户设定', component: UserPersonaSection, placement: 'settings' }, 10),
  registerSettingsSection('kernel', { id: 'api', title: 'API 连接与服务', component: ApiConfigSection, placement: 'settings' }, 20),
  registerSettingsSection('kernel', { id: 'appearance', title: '通用设置', component: AppearanceSection, placement: 'settings' }, 30),
  // M3-err2: the error hub's troubleshooting face — export is manual only.
  registerSettingsSection('kernel', { id: 'diagnostics', title: '诊断', component: DiagnosticsSection, placement: 'settings' }, 40),
  // M3-w followups: 变量分析 / 提示词预设 fold into their plugin's tools-area
  // entry (user call). The HOST registers these under the plugins' ids — the
  // section components live kernel-side and the red line forbids plugins
  // importing kernel modules, so the composition root is the legitimate
  // registration site.
  registerSettingsSection('variables', { id: 'variables-analysis', title: '变量分析', component: TemplateAnalysisSection, placement: 'plugin' }, 10),
  registerSettingsSection('presets', { id: 'presets', title: '预设设置', component: PresetSection, placement: 'plugin' }, 10),
  // M4-e: the memory engine's settings face folds into the 记忆系统 plugin's
  // tools-area entry (same host-registered shape as 变量分析 / 预设设置).
  registerSettingsSection('memory', { id: 'memory-settings', title: '记忆设置', component: MemorySettingsSection, placement: 'plugin' }, 10),
  // M4-e 故事引擎:叙事原则 + 关系阶段表,面板挂在 story 插件的工具区条目下。
  registerSettingsSection('story', { id: 'story-config', title: '故事设置', component: StorySettings, placement: 'plugin' }, 10),
)

onUnmounted(() => {
  disposers.forEach((dispose) => dispose())
})

const tabs = useTabProjection()
const activeId = ref(tabs.value[0]?.id ?? '')
const activeTab = computed(() => tabs.value.find((tab) => tab.id === activeId.value) ?? tabs.value[0])

// Full-screen chat page: the tab bar hides while a conversation is open.
// M3-i: the route kind picks the domain — one session-page skeleton serves
// chatbox and card conversations alike.
const chatRoute = useChatRoute()
const chatOverlay = computed(() => (chatRoute.value.view === 'chat' ? chatRoute.value : null))
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
      v-show="!chatOverlay"
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

    <ChatSessionView
      v-if="chatOverlay"
      :key="`${chatOverlay.kind}:${chatOverlay.conversationId}`"
      :domain="chatOverlay.kind"
      :conversation-id="chatOverlay.conversationId"
    />

    <ToastHost />
    <ConfirmDialogHost />
    <FatalErrorHost />
  </div>
</template>
