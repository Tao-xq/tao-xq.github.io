# Rest Mode 维护说明

这里记录更新个人内容、管理社区和维护后台时会用到的方法。网站入口和功能介绍见 [README](../README.md)。

## 个人资料与友链

编辑 [content/owner.json](../content/owner.json)：

- `nickname` 是显示昵称，`avatar` 是头像路径，`github` 是 About 中的 GitHub 主页链接。
- `about.zh`、`about.en`、`about.ja` 分别保存三种语言的自我介绍。读者切换界面语言时，网站会显示对应版本。
- `friends` 中每项包含 `nickname`、`url`、`avatar` 和 `bio`，分别对应友链的昵称、网址、头像与简介。

本地图片放在 `web/assets/`，资料中填写 `assets/文件名.jpg` 这样的路径。

## 发布个人随笔

在 [content/daily/](../content/daily/) 添加 Markdown 文件，例如 `my-first-note.md`：

```markdown
---
id: daily-my-first-note
title: 一点日常
cover: assets/my-cover.jpg
publishedAt: 2026-11-15T12:00:00Z
lang: zh
draft: true
---

这里是正文，支持 **加粗**、列表、链接、图片、引用和代码块。
```

`draft: true` 表示暂不公开；准备好后改成 `false` 或移除这一行。每篇文章的 `id` 必须唯一、以 `daily-` 开头，发布后请保持不变。标题最多 28 个字符，封面建议裁成 A4 竖版。

如果准备了译文，可以添加 `my-first-note.en.md` 或 `my-first-note.ja.md`，文件开头用 frontmatter 填写译文 `title`，下面写译文正文。读者点击翻译时会优先看到这份校对稿；没有校对稿时才请求机器翻译。

提交到 `main` 后，GitHub Actions 会运行测试、构建并发布 GitHub Pages。个人随笔只从仓库发布，不开放给社区访客编辑。

## 社区内容与匿名身份

访客阅读时无需建立会话，打开写作区或留言表单时才创建匿名身份。昵称只是展示文字，发帖、编辑和头像设置的权限由后台验证会话及内容归属。

匿名身份保存在浏览器中，不能靠填写同一个昵称找回。清除数据或换设备后，原有内容的编辑权限暂时无法自动恢复。草稿也只保存在当前浏览器。

访客头像与 About 中的个人头像分别维护。上传的头像会裁为 256 × 256，最多 512 KB；未设置时从八个默认图案中分配。更换头像后，同一身份之前的帖子和留言也会显示新头像。

社区帖子按发布时间倒序显示，每页 24 篇；留言每页 50 条。浏览量是按网络标识每天去重后的近似次数，同一网络的阅读可能被合并，不能当作精确的独立访客数。后台不保存原始 IP。

## 管理帖子、留言和图片

在 Supabase 的 Table Editor 中，将 `community_posts` 或 `short_notes` 对应记录的 `status` 改为 `hidden` 可以隐藏内容，改回 `published` 可以恢复。个人随笔仍通过 GitHub 修改。

当前社区上传支持 JPG、PNG，单张最多 2 MB；封面裁为 420 × 594。后台会检查实际文件格式、尺寸、图片归属和正文内容，也会限制提交频率。帖子标题最多 28 字，昵称最多 24 字，正文纯文本最多 50,000 字，短留言最多 280 字。

可以定期清理过期的 `api_limits` 和旧的 `post_view_receipts`。未发布的图片也会占用存储；清理前先结合 `uploads.created_at`、封面和正文引用核实，保留仍在使用的图片。

## 翻译与服务额度

翻译只在读者点击后执行，按原帖版本和目标语言缓存；原文更新后使用新版本译文。图片、链接、代码和正文排版会保留，机器译文有明确标记。

`DEEPL_API_KEY` 只保存在 Supabase Secrets 中。本站的 `translation_budget` 累计上限默认设为 900,000 字符，失败的请求也会保守计入；达到上限后停止新翻译，已有缓存仍可阅读。网站不会自动转用付费服务。

Supabase 和 DeepL 的免费额度、用量与暂停规则以各自控制台为准。维护时留意数据库、图片存储、流量和翻译用量，避免因为额度不足影响访问。

## 代码与部署

| 目录 | 用途 |
| --- | --- |
| `web/` | 页面、样式、前端脚本和美术素材 |
| `content/` | 个人资料、文章和界面翻译 |
| `scripts/` | 构建、本地预览和手动检查工具 |
| `tests/` | 自动测试 |
| `supabase/migrations/` | 数据库结构与权限迁移 |
| `supabase/functions/rest-api/` | 社区与翻译接口 |
| `dist/` | 自动生成的静态网站，不提交到 Git |

前端的 `web/config.js` 只放公开项目地址和 publishable key。服务端密钥、翻译密钥和其他凭据都不能放进前端或提交到 GitHub。

数据库表启用了 RLS，访客不能绕过 API 直接读写。`rest-api` 在函数内调用 Supabase Auth 校验写入会话，并检查内容归属；当前部署关闭网关的 legacy JWT 校验，部署函数时需要保留这项配置。

修改数据库结构后需单独应用迁移，修改后台代码后需单独部署 `rest-api`。更新 GitHub Pages 只发布前端，不会自动更新 Supabase。

本地预览命令见 [README](../README.md#本地运行)。预览服务只监听 `127.0.0.1:4173`，`/setup/` 下的部署辅助入口仅供本机使用，不包含在公开网站构建中。

`npm test` 运行本地自动测试。`node scripts/live-check.mjs` 和 `node scripts/avatar-live-check.mjs` 会连接真实后台、创建测试身份与内容，不在 CI 中自动运行；使用后请根据输出检查并隐藏测试帖子和留言。
