import { describe, expect, it } from 'vitest'
import { isProxy, reactive } from 'vue'
import {
  getRegisteredTab,
  registerTab,
  unregisterTab,
  useTabProjection,
} from '@/kernel/app/view-registry'

// 函数式组件桩(注册表只存引用,不渲染)
const FakeView = () => null
const FakeIcon = () => null

const descriptor = (id: string, order: number) => ({
  id,
  title: id,
  icon: FakeIcon,
  component: FakeView,
  order,
})

describe('kernel/app/view-registry(M0-d 雏形)', () => {
  it('keeps component definitions raw while forwarding reactive props', () => {
    const component = { render: () => null }
    const icon = { render: () => null }
    const props = reactive({ title: 'before' })
    const dispose = registerTab({ id: 'raw', title: 'Raw', order: 1, component, icon, props })
    const registered = getRegisteredTab('raw')!
    expect(registered.component).toBe(component)
    expect(registered.icon).toBe(icon)
    expect(isProxy(registered.component)).toBe(false)
    props.title = 'after'
    expect(registered.props?.title).toBe('after')
    dispose()
  })
  it('投影按 order 升序;同值按注册次序(稳定)', () => {
    registerTab(descriptor('proj-a', 20))
    registerTab(descriptor('proj-b', 10))
    registerTab(descriptor('proj-c', 20))

    expect(useTabProjection().value.map((tab) => tab.id)).toEqual(['proj-b', 'proj-a', 'proj-c'])

    unregisterTab('proj-a')
    unregisterTab('proj-b')
    unregisterTab('proj-c')
  })

  it('重复 id 注册抛错', () => {
    registerTab(descriptor('dup', 1))
    expect(() => registerTab(descriptor('dup', 2))).toThrow(/\[view-registry\] 重复注册 tab id: dup/)
    unregisterTab('dup')
  })

  it('disposer 反注册可逆', () => {
    const dispose = registerTab(descriptor('rev', 1))
    expect(getRegisteredTab('rev')).toBeDefined()

    dispose()
    expect(getRegisteredTab('rev')).toBeUndefined()
  })
})
