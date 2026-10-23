import { defineComponent } from 'vue'
import type { VueWrapper } from '@vue/test-utils'

/** Tests choose when the CSS lifecycle completes; flushing promises alone
 * does not represent an after-leave event for a retained v-show viewport. */
export const ControlledTransition = defineComponent({
  props: {
    name: { type: String, default: '' },
    mode: { type: String, default: '' },
    persisted: Boolean,
  },
  emits: ['after-leave', 'after-enter'],
  setup: (_props, { slots }) => () => slots.default?.(),
})

export function completeSessionLeave(wrapper: VueWrapper): void {
  const transition = wrapper.findAllComponents(ControlledTransition).find(component => component.props('name') === 'mp-mo-push')
  if (!transition) throw new Error('Session transition was not mounted')
  transition.vm.$emit('after-leave')
}
