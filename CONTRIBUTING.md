# CONTRIBUTING — MintPlot 协作约定

MintPlot 是本地优先的 AI 角色扮演对话应用:Vue 3 + Vite + TypeScript strict + Tailwind + Vitest,Capacitor 7 打包 Android 单端;界面文案中文,数据只存设备本地。

## 黄金法则

**永远不要直接 push main 分支。** 所有代码改动一律走 PR:从最新 main 切主题分支 → 开发 → push 分支 → 开 PR → CI 全绿 → 维护者审查合并。合并进 main 的操作只由维护者执行。

## 分支与提交

- 分支命名:`mp-<主题>`,例如 `mp-tts-config-fix`。
- 一片一 PR:一个 PR 只解决一件事,合成一个内聚提交。
- 提交信息用英文,一句话说清改动,建议 `fix(域): 说明` / `feat(域): 说明` 的风格,例如 `fix(chat): abort streaming without losing partial reply`。最终进 main 的提交信息由维护者 squash 合并时统一整理,不必纠结格式完美。
- 标识符、注释、提交信息用英文;UI 文案用中文。

## 提交门槛(开 PR 前本地全绿)

```bash
npm run lint    # ESLint,含架构红线
npm test        # Vitest
npm run build   # vue-tsc 类型检查 + vite build
```

触及 `contracts/` 时加跑 `npm run build:contracts`。改行为必须同步改测试;PR 描述写清:改了什么、为什么、怎么验证的(验证截图直接贴在 PR 里)。

## 评审与合并流程

1. 开 PR 后 CI 自动跑两个任务:`web`(lint + test + contracts + build)和 `android`(debug APK)。红了自己修,绿了才进入评审。
2. 维护者审查,可能留行内评论;往同一分支继续 push 新提交,PR 自动更新。
3. 维护者以 **Squash and merge** 合入(保持 main 线性、一片一提交),随后删除分支。
4. 开工前先 `git fetch` 并把分支 rebase 到最新 main,避免长期分叉。

## 架构红线(ESLint 已拦截,违反即 CI 红)

- `kernel/` 只依赖公开插件 API,不 import 任何插件;插件经注册表反向入驻。
- 插件只走 `@contracts` barrel(深路径、相对路径绕行同禁)。
- `contracts/` 是插件契约的单一来源,不 import `src/`。
- 源码字面量禁止出现 `sta1n` / `rp_hub_` / `RPH`。

## 数据与秘密

- 密钥、令牌、签名材料、`.env*`、个人数据文件一律不入库。
- 用户数据(卡、会话、配置)只落设备本地库,不进 git。

## Android 身份参数(冻结,不可逆)

- applicationId:`com.mintplot.app`。
- versionCode 自 1 单调递增(dev 构建也占号);versionName 变更由维护者拍板。
- 涉及原生壳、签名、版本号的改动必须真机验证。

## 设计决策

设计与规划文档不在本仓库内。大改动(新器官、契约变更、架构调整)先开 issue 或 draft PR 说明思路,与维护者对齐后再动手,避免闷头大改后返工。

## 环境速查

- Node 22;Android 构建需 JDK 21(Capacitor 7 要求)。
- 本地开发:`npm run dev`;安卓命令行构建:`android/gradlew assembleDebug`。
