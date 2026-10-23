import type { ActiveCardSessionProjection, HostSessionProjection } from '@/kernel/sessions/session-projection'
import { getExecutableFrameSlashHandler, setExecutableFrameSlashHandler, startExecutableFrameHost } from '@/kernel/render/html-frame'

const owners = new WeakMap<HostSessionProjection, symbol>()

/** Enter and leave can overlap. Only the page that installed a host value may clear it. */
export function activateSessionViewHost(
  projection: HostSessionProjection | null,
  active: ActiveCardSessionProjection | null,
  handler: (command: string) => void,
  ownsFrame?: (frame: HTMLIFrameElement) => boolean,
): () => void {
  const owner = Symbol('session-view')
  if (projection) {
    owners.set(projection, owner)
    projection.setActiveCardSession(active)
  }
  startExecutableFrameHost()
  setExecutableFrameSlashHandler(handler, ownsFrame)
  return () => {
    if (getExecutableFrameSlashHandler() === handler) setExecutableFrameSlashHandler(null)
    if (projection && owners.get(projection) === owner) {
      owners.delete(projection)
      projection.setActiveCardSession(null)
    }
  }
}
