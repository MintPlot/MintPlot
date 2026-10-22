import type { CardBackdrop } from '@/kernel/sessions/card-session-store'

export interface SessionPageBackground {
  cover: string
  backdrop: CardBackdrop
}

export const SESSION_PENDING_FEEDBACK_TRIAL_KEY = 'mp_session_pending_feedback_trial'
export function pendingSessionFeedbackTrialEnabled(): boolean {
  try { return localStorage.getItem(SESSION_PENDING_FEEDBACK_TRIAL_KEY) === '1' }
  catch { return false }
}
