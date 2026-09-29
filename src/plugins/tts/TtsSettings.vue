<script setup lang="ts">
// 语音设置分区 — ported from the decoupling-line tts organ's TtsSettings
// (baseline 81ef0b8), restyled to MP mint tokens; settings is the manifest
// settingsScope whitelist projection (v-model binds directly, writes land in
// the host settings store and the apiKey rides the secret channel).
import { computed } from 'vue'
import { getTtsService } from './service-instance'

const service = computed(() => getTtsService())
</script>

<template>
  <div
    v-if="service"
    class="px-4 py-4"
  >
    <div class="mb-4 flex items-center justify-between">
      <div>
        <p class="text-sm font-bold text-ink">
          启用语音朗读
        </p>
        <p class="mt-0.5 text-[10px] text-ink-3">
          使用语音引擎朗读角色回复。
        </p>
      </div>
      <label class="inline-flex cursor-pointer items-center">
        <input
          v-model="service.settings.ttsEnabled"
          type="checkbox"
          class="sr-only"
        >
        <span
          class="relative inline-block h-6 w-11 rounded-full transition-colors"
          :class="service.settings.ttsEnabled ? 'bg-primary' : 'bg-line-strong'"
        >
          <span
            class="absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all"
            :class="service.settings.ttsEnabled ? 'left-[22px]' : 'left-0.5'"
          />
        </span>
      </label>
    </div>

    <div
      v-if="service.settings.ttsEnabled"
      class="flex flex-col gap-4"
    >
      <div>
        <p class="mb-2 ml-1 text-xs font-bold uppercase tracking-wider text-ink-3">
          语音引擎
        </p>
        <div class="grid grid-cols-2 gap-2">
          <button
            v-for="option in service.ttsServiceOptions"
            :key="option.id"
            type="button"
            class="rounded-input border-2 p-3 text-left transition-all"
            :class="service.settings.ttsService === option.id
              ? 'border-primary bg-accent-wash'
              : 'border-line hover:border-line-strong'"
            @click="service.selectTtsService(option.id)"
          >
            <span
              class="text-sm font-bold"
              :class="service.settings.ttsService === option.id ? 'text-primary' : 'text-ink'"
            >{{ option.name }}</span>
            <span class="mt-0.5 block text-[10px] text-ink-3">{{ option.desc }}</span>
          </button>
        </div>
      </div>

      <div>
        <p class="mb-2 ml-1 text-xs font-bold uppercase tracking-wider text-ink-3">
          引擎设置
        </p>
        <div
          v-if="service.settings.ttsService === 'system'"
          class="rounded-input border border-line bg-bg p-3"
        >
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-ink-3">引擎状态</span>
            <span
              class="text-xs font-bold"
              :class="service.ttsStatus.value.available ? 'text-primary' : 'text-danger'"
            >{{ service.ttsStatusLabel.value }}</span>
          </div>
        </div>
        <div
          v-else
          class="flex flex-col gap-3 rounded-input border border-line bg-bg p-3"
        >
          <div class="flex items-center justify-between">
            <span class="text-xs font-medium text-ink-3">引擎状态</span>
            <span
              class="text-xs font-bold"
              :class="service.ttsStatus.value.available ? 'text-primary' : 'text-danger'"
            >{{ service.ttsStatusLabel.value }}</span>
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-3">服务商</label>
            <select
              v-model="service.settings.ttsCloudProviderId"
              class="w-full rounded-input border border-line bg-card px-2 py-1.5 text-xs text-ink"
              @change="service.onTtsCloudProviderChange()"
            >
              <option
                v-for="provider in service.ttsCloudProviderOptions"
                :key="provider.id"
                :value="provider.id"
              >
                {{ provider.name }}
              </option>
            </select>
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-3">Base URL</label>
            <input
              v-model.trim="service.settings.ttsCloudBaseUrl"
              type="text"
              placeholder="https://api.example.com/v1"
              class="w-full rounded-input border border-line bg-card px-2 py-1.5 text-xs text-ink"
            >
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-3">API Key</label>
            <input
              v-model="service.settings.ttsCloudApiKey"
              type="password"
              autocomplete="off"
              placeholder="sk-...（留空表示无密钥端点）"
              class="w-full rounded-input border border-line bg-card px-2 py-1.5 text-xs text-ink"
            >
            <p class="mt-0.5 text-[10px] text-ink-3">
              密钥经系统安全存储加密，不入备份。
            </p>
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-3">模型</label>
            <select
              v-if="service.ttsCloudModelOptions.value.length"
              v-model="service.settings.ttsCloudModel"
              class="w-full rounded-input border border-line bg-card px-2 py-1.5 text-xs text-ink"
            >
              <option
                v-for="model in service.ttsCloudModelOptions.value"
                :key="model"
                :value="model"
              >
                {{ model }}
              </option>
            </select>
            <input
              v-else
              v-model.trim="service.settings.ttsCloudModel"
              type="text"
              placeholder="tts-1"
              class="w-full rounded-input border border-line bg-card px-2 py-1.5 text-xs text-ink"
            >
          </div>
          <div>
            <label class="mb-1 block text-xs font-medium text-ink-3">音色</label>
            <select
              v-if="service.ttsCloudVoiceOptions.value.length"
              v-model="service.settings.ttsCloudVoice"
              class="w-full rounded-input border border-line bg-card px-2 py-1.5 text-xs text-ink"
            >
              <option
                v-for="voice in service.ttsCloudVoiceOptions.value"
                :key="voice"
                :value="voice"
              >
                {{ voice }}
              </option>
            </select>
            <input
              v-else
              v-model.trim="service.settings.ttsCloudVoice"
              type="text"
              placeholder="音色 id，取决于服务商"
              class="w-full rounded-input border border-line bg-card px-2 py-1.5 text-xs text-ink"
            >
            <p class="mt-0.5 text-[10px] text-ink-3">
              角色设置里的「角色音色」填写相同格式的音色 id 可按角色覆盖。
            </p>
          </div>
          <div>
            <div class="mb-1.5 flex items-center justify-between">
              <label class="text-xs font-medium text-ink-3">语速</label>
              <span class="rounded border border-line bg-accent-wash px-1.5 py-0.5 font-mono text-xs text-primary">{{ (Number(service.settings.ttsCloudSpeed) || 1).toFixed(2) }}</span>
            </div>
            <input
              v-model.number="service.settings.ttsCloudSpeed"
              type="range"
              min="0.25"
              max="4"
              step="0.05"
              class="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-line-strong accent-primary"
            >
          </div>
          <p class="text-[10px] leading-relaxed text-ink-3">
            通过 OpenAI 兼容的 /audio/speech 接口合成，按句分段请求、顺序播放；合成失败自动回落系统语音。
          </p>
        </div>
      </div>

      <div class="flex flex-col gap-4">
        <p class="mb-2 ml-1 text-xs font-bold uppercase tracking-wider text-ink-3">
          朗读偏好
        </p>
        <div class="flex items-center justify-between">
          <div>
            <p class="text-sm font-bold text-ink">
              自动朗读
            </p>
            <p class="mt-0.5 text-[10px] text-ink-3">
              角色回复生成完成后自动朗读，新发送消息时自动停止。
            </p>
          </div>
          <label class="inline-flex cursor-pointer items-center">
            <input
              v-model="service.settings.ttsAutoPlay"
              type="checkbox"
              class="sr-only"
            >
            <span
              class="relative inline-block h-6 w-11 rounded-full transition-colors"
              :class="service.settings.ttsAutoPlay ? 'bg-primary' : 'bg-line-strong'"
            >
              <span
                class="absolute top-0.5 h-5 w-5 rounded-full bg-card shadow transition-all"
                :class="service.settings.ttsAutoPlay ? 'left-[22px]' : 'left-0.5'"
              />
            </span>
          </label>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <div class="mb-1.5 flex items-center justify-between">
              <label class="text-xs font-medium text-ink-3">语速</label>
              <span class="rounded border border-line bg-accent-wash px-1.5 py-0.5 font-mono text-xs text-primary">{{ (Number(service.settings.ttsRate) || 1).toFixed(2) }}</span>
            </div>
            <input
              v-model.number="service.settings.ttsRate"
              type="range"
              min="0.5"
              max="2"
              step="0.05"
              class="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-line-strong accent-primary"
            >
          </div>
          <div>
            <div class="mb-1.5 flex items-center justify-between">
              <label class="text-xs font-medium text-ink-3">音调</label>
              <span class="rounded border border-line bg-accent-wash px-1.5 py-0.5 font-mono text-xs text-primary">{{ (Number(service.settings.ttsPitch) || 1).toFixed(2) }}</span>
            </div>
            <input
              v-model.number="service.settings.ttsPitch"
              type="range"
              min="0.5"
              max="2"
              step="0.05"
              :disabled="service.settings.ttsService === 'cloud'"
              :class="['h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-line-strong accent-primary', service.settings.ttsService === 'cloud' ? 'opacity-40' : '']"
            >
            <p
              v-if="service.settings.ttsService === 'cloud'"
              class="mt-0.5 text-[10px] text-ink-3"
            >
              云端引擎不支持音调调节。
            </p>
          </div>
        </div>
        <div class="grid grid-cols-2 gap-4">
          <div>
            <label class="mb-2 ml-1 block text-xs font-bold uppercase tracking-wider text-ink-3">朗读内容</label>
            <select
              v-model="service.ttsReadMode.value"
              class="w-full rounded-input border border-line bg-bg px-3 py-2.5 text-sm text-ink"
            >
              <option value="full">
                全文朗读
              </option>
              <option value="dialogue">
                只读台词（引号内容）
              </option>
            </select>
          </div>
          <div>
            <label class="mb-2 ml-1 block text-xs font-bold uppercase tracking-wider text-ink-3">最长朗读字数</label>
            <div class="flex items-center gap-2">
              <input
                v-model.number="service.settings.ttsMaxChars"
                type="number"
                min="100"
                max="5000"
                step="100"
                class="w-full rounded-input border border-line bg-bg px-3 py-2.5 text-sm text-ink"
              >
              <span class="text-[10px] text-ink-3">字</span>
            </div>
          </div>
        </div>
        <label class="flex cursor-pointer items-center rounded-input border-2 border-transparent p-3 transition-all hover:border-line hover:bg-bg">
          <input
            v-model="service.settings.ttsSkipActions"
            type="checkbox"
            class="mr-2.5 accent-primary"
          >
          <span class="text-sm font-medium text-ink-2">跳过动作叙述（*…* 行）</span>
        </label>
        <div class="flex items-center justify-between rounded-input border border-line bg-bg p-3">
          <span class="text-xs text-ink-3">朗读效果受所选引擎与语速音调影响。</span>
          <button
            type="button"
            class="rounded-input bg-primary px-3 py-1.5 text-xs font-bold text-on-primary shadow-sm transition-all active:scale-95"
            @click="service.testTtsVoice()"
          >
            测试朗读
          </button>
        </div>
      </div>
    </div>
  </div>
  <p
    v-else
    class="px-4 py-6 text-center text-xs text-ink-3"
  >
    语音设置服务未激活
  </p>
</template>
