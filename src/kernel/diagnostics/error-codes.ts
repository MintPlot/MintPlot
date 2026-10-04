/**
 * Unified error codes (M3-err1) — the human-facing vocabulary of the error
 * hub. Format: `MP-<DOMAIN>-<NNN>`; domains are uppercase mnemonic groups
 * (RUNTIME/NET/STORE/CHAT/CARD/PLUGIN). Codes ride on records, toasts-page
 * projections and exports so a bug report ("MP-NET-001 + one sentence")
 * pinpoints the failure class without any payload inspection.
 *
 * The table lives kernel-side and stays OUT of contracts (open registry:
 * unknown codes are recorded verbatim, the table never gates reporting —
 * plan §6.4). Type-coded errors attach their code at the throw site.
 */

export interface ErrorCodeSpec {
  readonly code: string
  readonly name: string
  readonly description: string
}

/** The kernel-side table. Keep entries grouped by domain, numbered densely. */
export const ERROR_CODES: readonly ErrorCodeSpec[] = [
  { code: 'MP-RUN-001', name: 'vue_error', description: 'Vue 组件渲染或生命周期错误' },
  { code: 'MP-RUN-002', name: 'window_error', description: '未捕获的脚本错误' },
  { code: 'MP-RUN-003', name: 'resource_error', description: '资源加载失败(图片/脚本等)' },
  { code: 'MP-RUN-004', name: 'unhandled_rejection', description: '未被处理的 Promise 拒绝' },
  { code: 'MP-RUN-005', name: 'boot_early_error', description: '应用启动早期(装网前)的错误' },
  { code: 'MP-RUN-006', name: 'bus_handler_threw', description: '事件总线监听器抛错(已隔离)' },
  { code: 'MP-RUN-007', name: 'ledger_subscriber_threw', description: '会话账本订阅者抛错(已隔离)' },
  { code: 'MP-RUN-008', name: 'toast_error', description: '界面以错误 toast 提示的失败' },
  { code: 'MP-NET-001', name: 'request_timeout', description: '请求超时' },
  { code: 'MP-NET-002', name: 'http_status_error', description: '服务端返回错误状态码' },
  { code: 'MP-NET-003', name: 'network_failure', description: '网络请求失败(连接层)' },
  { code: 'MP-NET-004', name: 'unreadable_response', description: '响应不可读(无可读流)' },
  { code: 'MP-CHAT-001', name: 'missing_base_url', description: '未配置 API Base URL' },
  { code: 'MP-CHAT-002', name: 'missing_model', description: '未配置模型' },
  { code: 'MP-STORE-001', name: 'idb_degraded', description: 'IndexedDB 不可用,存储已降级' },
  { code: 'MP-PLUGIN-001', name: 'activate_failed', description: '插件激活失败' },
  { code: 'MP-PLUGIN-002', name: 'deactivate_failed', description: '插件停用未完全撤销' },
  { code: 'MP-CARD-001', name: 'card_script_error', description: '卡内脚本错误(沙箱上报)' },
] as const

const TABLE: ReadonlyMap<string, ErrorCodeSpec> = new Map(ERROR_CODES.map((spec) => [spec.code, spec]))

/** Spec lookup; unknown codes return undefined (open registry — never a gate). */
export function errorCodeSpec(code: string | undefined): ErrorCodeSpec | undefined {
  if (!code) return undefined
  return TABLE.get(code)
}

/** Label for UI surfaces: known codes show their description, unknown stay verbatim. */
export function errorCodeLabel(code: string | undefined): string {
  return errorCodeSpec(code)?.description ?? code ?? ''
}
