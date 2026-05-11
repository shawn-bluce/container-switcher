# Container Switcher

根据 domain / path / regex 规则自动把页面切换到对应的 Firefox container。
Manifest V3,Firefox 128+。

## 功能

- 三种规则: `domain`(支持 `*.x.com` 通配)、`path`(主机+路径 glob)、`regex`(全 URL 正则)
- 同一规则可写多个 pattern,任一命中即视为该行命中
- 默认 container 兜底 —— 仅作用于「无 container」的 tab,不会覆盖手动选定的 container
- 全局开关临时禁用整个扩展
- 拖拽重排;删除带 5 秒撤销
- 导入 / 导出 JSON,方便备份与跨机迁移
- container 下拉同步 Firefox 容器列表;不存在的 container 在首次命中时自动创建
- 中英文 i18n,跟随 Firefox 语言

## 工作原理

`webRequest.onBeforeRequest` 阻塞监听。每次顶层 `main_frame` 请求:

1. 当前 tab **不在** `firefox-default` 状态(即已被规则、其他扩展或用户「Reopen in Container」放进某个具名 container)→ **放行**,保留用户/前次的选择
2. 规则命中 → 在规则指定的 container 重开 tab,取消原请求
3. 无规则但设置了「默认 container」→ 在默认 container 重开
4. 否则放行

源 tab 仅在内容是 `about:newtab` / `about:blank` 等空白页时关闭,否则保留 —— 避免点链接切换 container 时把已有的浏览历史一并丢掉。

## 目录结构

```
manifest.json          MV3
_locales/{zh_CN,en}/   i18n message catalogs
lib/
  i18n.js              data-i18n / placeholder / title 应用器
  storage.js           browser.storage.local 封装(rules / defaultContainer / enabled)
  matcher.js           三类规则匹配 + 校验
background/
  containers.js        contextualIdentities 查找 / 自动创建
  background.js        webRequest 拦截 + 容器切换
options/               规则 CRUD UI、导入导出、撤销
popup/                 当前 tab 状态 + 全局开关 + 快捷添加规则
icons/                 占位 SVG
```

## 规则语义

| 类型     | 模式示例                          | 含义                                |
|----------|-----------------------------------|-------------------------------------|
| `domain` | `github.com`                      | 主机精确匹配                        |
| `domain` | `*.google.com`                    | 主机或任意子域                      |
| `path`   | `example.com/admin/*`             | 主机+路径 glob(`*` 任意字符)        |
| `regex`  | `^https://[^/]+\.corp\.local/`    | ECMAScript 正则,匹配完整 URL       |

列表顺序即优先级,首条命中决定使用的 container。同一条规则的「模式」字段可换行写多个 pattern,任一命中即视为该条规则命中。

## 已知限制

- 切换 tab 时新建+(可选)关闭原 tab,前向历史会丢
- 仅拦截 `main_frame`,iframe 内导航不切换
- MV3 event page 模型下,扩展空闲一段时间会被 Firefox 卸载,极少数恰好在唤醒前若干毫秒到达的请求可能漏处理(`webRequest` listener 在脚本顶层同步注册以让 Firefox 能正确唤醒)
