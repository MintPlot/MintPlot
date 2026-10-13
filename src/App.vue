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
import DataBackupSection from '@/kernel/app/sections/DataBackupSection.vue'
import TemplateAnalysisSection from '@/kernel/app/sections/TemplateAnalysisSection.vue'
import PresetSection from '@/kernel/app/sections/PresetSection.vue'
import MemorySettingsSection from '@/kernel/app/sections/MemorySettingsSection.vue'
import ToastHost from '@/kernel/ui/ToastHost.vue'
import ConfirmDialogHost from '@/kernel/ui/ConfirmDialogHost.vue'
import FatalErrorHost from '@/kernel/ui/FatalErrorHost.vue'
import AuroraLayer from '@/kernel/design/AuroraLayer.vue'

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
  // M4-g1: data continuity — full export / restore (RP import joins in M4-g2).
  registerSettingsSection('kernel', { id: 'data-backup', title: '数据与备份', component: DataBackupSection, placement: 'settings' }, 35),
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
  <!-- Theme v3: body carries the solid base; the aurora is a real-DOM layer
       (blurred blobs + grain) pinned behind the shell content. -->
  <div class="flex h-dvh flex-col text-ink">
    <AuroraLayer class="fixed inset-0 z-0" />
    <div class="relative z-10 min-h-0 flex-1">
      <component
        :is="activeTab.component"
        v-bind="activeTab.props"
      />
    </div>

    <!-- Theme v3 floating chrome: the tab bar is an inset glass pill
         (mockup-aligned), not a full-bleed bar. -->
    <nav
      v-show="!chatOverlay"
      class="mp-glass absolute inset-x-3 bottom-[max(env(safe-area-inset-bottom),0.75rem)] z-20 rounded-full"
      aria-label="主导航"
    >
      <div class="mx-auto flex max-w-xl p-1.5">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          class="relative flex min-h-[44px] flex-1 flex-col items-center justify-end gap-0.5 rounded-full pb-1.5 pt-2 text-xs"
          :class="tab.id === activeId ? 'bg-accent-wash text-primary' : 'text-ink-3'"
          :aria-current="tab.id === activeId ? 'page' : undefined"
          @click="activeId = tab.id"
        >
          <component
            :is="tab.icon"
            class="h-6 w-6"
          />
          <span>{{ tab.title }}</span>
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
