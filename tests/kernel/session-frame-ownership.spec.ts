import { afterEach, describe, expect, it } from 'vitest'
import { activateSessionViewHost } from '@/kernel/app/chat/session-view-host'
import { createExecutableHtmlIframe, EXECUTABLE_FRAME_CHANNEL, setExecutableFrameSlashHandler } from '@/kernel/render/html-frame'

afterEach(() => { setExecutableFrameSlashHandler(null); document.body.replaceChildren() })

describe('session frame command ownership', () => {
  it('rejects an authenticated old frame during overlap and accepts the current page frame', () => {
    const oldPage=document.createElement('div'),newPage=document.createElement('div')
    const oldFrame=createExecutableHtmlIframe('<p>old</p>'),newFrame=createExecutableHtmlIframe('<p>new</p>')
    oldPage.append(oldFrame);newPage.append(newFrame);document.body.append(oldPage,newPage)
    const oldMessages:string[]=[],newMessages:string[]=[]
    const releaseOld=activateSessionViewHost(null,null,command=>oldMessages.push(command),frame=>oldPage.contains(frame))
    const releaseNew=activateSessionViewHost(null,null,command=>newMessages.push(command),frame=>newPage.contains(frame))
    releaseOld()
    const post=(frame:HTMLIFrameElement,command:string)=>window.dispatchEvent(new MessageEvent('message',{source:frame.contentWindow,data:{source:EXECUTABLE_FRAME_CHANNEL,type:'slash',command}}))
    post(oldFrame,'old command')
    expect(oldFrame.isConnected&&newFrame.isConnected).toBe(true)
    expect(oldMessages).toEqual([])
    expect(newMessages).toEqual([])
    post(newFrame,'new command')
    expect(newMessages).toEqual(['new command'])
    releaseNew();post(newFrame,'after departure')
    expect(newMessages).toEqual(['new command'])
  })
})
