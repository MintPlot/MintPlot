# MintPlot

[![CI](https://github.com/MintPlot/MintPlot/actions/workflows/ci.yml/badge.svg)](https://github.com/MintPlot/MintPlot/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)

本地优先的 Android AI 角色扮演应用——你的卡、你的会话、你的密钥,都只在你自己的设备上。

## MintPlot 是什么

MintPlot 是一款 AI 角色扮演(RP)对话应用:导入社区角色卡,接上任意 OpenAI 兼容的模型端点,即可开始扮演。无需注册账号,没有官方服务器——应用只直连你自己配置的 API,全部数据保存在设备本地。

**兼容社区生态:**

- **角色卡**:PNG 卡(SillyTavern ccv3 / chara 规范)与 JSON 卡,点卡即入对话,卡封面自动提取。
- **资产迁移**:Roleplayhub 整包备份导入(卡片、聊天记录、记忆、预设);酒馆(SillyTavern)世界书、正则脚本、预设导入,散装分享的世界书/正则文件也支持挂载到卡片。
- **模型端点**:任意 OpenAI 兼容 API。内置 DeepSeek / OpenRouter / SiliconFlow / 阿里百炼 / 智谱 五家预设一键填址;也支持 LM Studio 等本地模型与自建端点(局域网明文 HTTP 已放行)。

## 下载

从 [Releases](https://github.com/MintPlot/MintPlot/releases) 页面下载最新 APK。

- 系统要求:Android 6.0+
- 首次安装需在系统里允许「安装未知应用」
- 升级请使用本仓库发布的 APK(签名一致才能覆盖升级;换渠道的 APK 签名不同,需先卸载,数据会丢失)

## 快速开始

1. **配端点**:设置 → API 连接与服务 → 新建档案,选预设或手填 Base URL 与 API Key,点「拉取模型」选择模型。
2. **导卡**:角色页 → 导入,选择 PNG / JSON 角色卡文件。
3. **开聊**:点卡片进入对话,开场白自动上楼,直接输入即可。

进阶玩法(世界书、变量面板、预设、思维链、记忆等)都是独立开关,在工具页按需启停。

## 功能特性

### 聊天体验

- 流式回复、随时中止(保留已生成部分)、超时与用量捕获
- Swipe 候选:同一楼层多版本回复,左右切换,变量状态跟随候选回放
- 楼层编辑 / 删除(连带其后楼层)、重新生成
- 语音朗读(TTS,可接云端与本地双引擎)
- 思维链折叠卡:解析 `<think>` / `<cot>` 标签,支持 DeepSeek 等模型的原生思考流;思考内容默认折叠,不入请求、不进朗读
- 图片理解:视觉模型直发图片;聊天模型不支持视觉时自动走识图模型生成描述

### 生态玩法

- **世界书**:常驻条目 + 关键词绿灯(子串/正则/大小写)、蓝灯强制注入,扫描深度与 token 预算可调;每轮注入/丢弃/未触发条目数在面板可见
- **变量系统**:识别模型输出的 `<setvars>` / `<StatData>` / 模板更新协议,数值增量/绝对赋值/JSON 状态树深合并;每楼「⚙ 变量 ×N」胶囊可查变更明细,面板支持手动改值
- **UI 模板面板**:卡自带状态面板直接渲染在聊天流里,支持数据绑定、循环、按钮触发发话;状态按楼层快照回放,切换 swipe 候选不串状态
- **正则脚本**:显示美化与提示词改写双通道,支持酒馆双字段族格式
- **提示词预设**:内置 17 条(破限类默认停用),分组互斥、导入导出、宏展开
- **HTML 富文本卡**:社区「HTML 卡」整文档在沙箱 iframe 内渲染,支持卡内脚本与按钮交互;沙箱无同源权限,卡脚本碰不到你的聊天库与密钥
- **开场白瘦身**:完整 HTML 文档楼层在请求里自动替换为省略标记,13 万字开场白也能正常对话

### 记忆与上下文

- 滚动摘要记忆:自动巡逻总结旧楼层为长期/短期摘要与人物档案,注入 `<role_memory>`;上下文窗口自动裁剪,可配独立记忆模型
- 世界书、预设、变量状态、思维链协议在发送前层层装配进最终请求

### 数据与隐私

- **无账号、无遥测、无云端**:应用只与你配置的 API 端点通信
- 全部数据(卡、会话、变量、设置)存设备本地 IndexedDB
- API 密钥存入 Android 系统安全存储(AndroidKeyStore AES-GCM 加密),永不入库、不随备份导出
- 全量备份导出 / 恢复(.zip),换机迁移不丢数据
- 用量统计:按会话与模型的 token 账本,输入/输出/缓存分别记账

### 外观

8 套配色(薄荷 / 海蓝 / 青碧 / 森绿 / 琥珀 / 绯红·宣纸 / 玫粉 / 黛紫)× 浅色 / 深色 / 跟随系统。

### 插件化内核

变量系统、世界书、正则、预设、思维链、记忆等玩法子系统以插件形态入驻,可独立启停,停用只休眠对应能力层、数据保留。内核与插件之间以公开契约(manifest / 生命周期 / 扩展点)解耦。

## 从源码构建

环境:Node 22;Android 构建需 JDK 21。

```bash
npm ci
npm run lint    # ESLint,含架构红线
npm test        # Vitest
npm run build   # vue-tsc 类型检查 + vite build
npx cap sync android
android/gradlew assembleDebug   # JAVA_HOME 需指向 JDK 21
```

详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 参与贡献

欢迎 issue 与 PR,分支命名、提交门槛、评审流程见 [CONTRIBUTING.md](CONTRIBUTING.md)。约定:标识符 / 注释 / 提交信息用英文,界面文案用中文。

## 许可证

代码以 [Apache License 2.0](LICENSE) 授权。Copyright © 2026 Litishs。

「MintPlot」名称与吉祥物 MintCat 形象不在代码许可授予范围内:fork 与再分发请使用你自己的项目名与形象。

由 AI 生成的对话内容不代表本项目立场;角色卡等用户素材的内容与版权责任归其作者。
