/**
 * 叙事风格本地样本（M4-nstyle 预览模式 A）— 根据当前配置**确定性地**拼装
 * 一段示例场景文字，帮助用户直观感受参数方向。
 *
 * 规范 5.5：这是本地模拟，必须与真正的 AI 生成明确区分（面板标注「本地
 * 模拟示例（非 AI 生成）」）。同一配置永远产出同一段文字；不同配置的
 * 差异体现在句子取舍与措辞变体上。
 */

import type { NstyleConfig, NstyleParamKey } from './types'

const isHigh = (value: number): boolean => value >= 60
const isLow = (value: number): boolean => value < 35

const pick = (config: NstyleConfig, key: NstyleParamKey): string =>
  isHigh(config.params[key]) ? 'high' : isLow(config.params[key]) ? 'low' : 'mid'

/** 固定迷你场景：雨夜站台，两名角色（「我」与「她」）。 */
export function buildStyleSample(config: NstyleConfig): string {
  const paragraphs: string[] = []
  const env = pick(config, 'environment')
  const sensory = pick(config, 'sensory')
  const dialogue = pick(config, 'dialogue')
  const psychology = pick(config, 'psychology')
  const emotion = pick(config, 'emotion')
  const action = pick(config, 'action')
  const subtext = pick(config, 'subtext')
  const language = config.narration.language

  const envLine =
    env === 'high'
      ? '末班车后的站台只剩一盏灯。雨顺着顶棚的裂缝漏下来，在水泥地上敲出深色的斑点；风把广告纸吹得哗啦啦响，远处的轨道在夜色里泛着冷光。'
      : env === 'low'
        ? '雨夜的站台，灯还亮着。'
        : '雨刚停，站台的灯在湿漉漉的地面上映出一圈圈光晕。'
  const sensoryLine =
    sensory === 'high'
      ? '空气里混着铁锈和潮湿的气味，指尖能感到栏杆上未干的凉意；远处列车驶过的轰鸣顺着地面传来，微微发麻。'
      : sensory === 'low'
        ? ''
        : '风里带着雨后的潮气，栏杆摸上去冰凉。'
  paragraphs.push([envLine, sensoryLine].filter(Boolean).join(' '))

  if (dialogue !== 'low') {
    const tone = language === 'literary' ? '“这么晚，你还在等什么？”' : '“这么晚了，你还不走？”'
    paragraphs.push(`她先开的口，${tone}`)
    if (dialogue === 'high') {
      paragraphs.push('“等你先回答昨天的问题。”我说。她笑了一下，没有接话，反而往前走了半步，把问题原样丢了回来：“那你呢？”')
    }
  }

  const inner =
    psychology === 'high'
      ? '我心里其实清楚答案，只是不想这么快承认——承认了，就意味着之前所有的绕圈子都白费了。'
      : psychology === 'low'
        ? ''
        : '我犹豫了一下，没接她的话。'
  paragraphs.push(inner)

  if (action !== 'low' || emotion !== 'low') {
    const actionText = action === 'high' ? '她把伞收起来，甩了甩水，动作利落得像在演练过很多次。' : action === 'low' ? '' : '她收了伞，走到我旁边。'
    const emotionText =
      emotion === 'high'
        ? '她的眼睛亮得吓人，里面有什么东西在烧——是委屈，也是不肯认输的倔强。'
        : emotion === 'low'
          ? '她的表情很平静。'
          : '她的语气听起来很平静，但握着伞柄的手指微微收紧了。'
    paragraphs.push([actionText, emotionText].filter(Boolean).join(' '))
  }

  const closing =
    subtext === 'high'
      ? '列车进站的广播响了两遍。谁都没有动。'
      : subtext === 'low'
        ? '我知道，今晚她不会走了，有些话终于可以说出口。'
        : '广播响了，我们都没有动。'
  paragraphs.push(closing)

  const length = config.narration.length
  const text = paragraphs.filter(Boolean).join('\n\n')
  if (length === 'concise') {
    // 简洁：只保留前两段
    return text.split('\n\n').slice(0, 2).join('\n\n')
  }
  if (length === 'detailed' && language === 'literary') {
    return text + '\n\n雨还在下，只是变得更轻，像是把没说完的话都收进了水洼里。'
  }
  return text
}
