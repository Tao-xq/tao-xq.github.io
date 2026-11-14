# Rest Mode

海边的 ACGN 闲谈与日常随笔。正式地址：https://tao-xq.github.io/

前端在 GitHub Pages，访客帖子、短留言、图片、浏览量和按需翻译在 Supabase。沿用已确认的平涂手绘界面和 52 张清晰动作帧。旧原型和原始素材保存在本机上一级项目归档，不随网站发布。

## 发布个人内容

- `content/owner.json`：昵称、头像、`about.zh` / `about.en` / `about.ja` 和友链。三语 About 当前留空，等待主人正式文案；不会自动编造或翻译。
- `content/daily/*.md`：只有仓库维护者可以写个人随笔。添加下面格式的文件，提交到 main 后自动构建发布。`draft: true` 不公开。`id` 必须以 `daily-` 开头、每篇唯一，之后保持不变。
- 图片放 `web/assets/`，文章封面建议先裁成 A4 竖版。上传示例、私人文件和密钥不会自动发布。

```markdown
---
id: daily-my-first-note
title: 一点日常
cover: assets/my-cover.jpg
publishedAt: 2026-11-14T12:00:00Z
lang: zh
draft: true
---
正文，支持 **加粗**、列表、链接、图片、引用和代码块。
```

可选校对译文：同名的 `my-first-note.en.md`、`.ja.md`，包含 `title:` frontmatter 和译文正文。读者点击翻译后优先显示该版本，并标注已校对译文；没有校对稿时才调用机器翻译。

## 访客与后台

阅读无需会话；访客第一次上传或留言时建立 Supabase 匿名会话，无需注册界面。作者身份来自 Auth 校验，不来自昵称。保存草稿只保存在自己的浏览器。匿名帖的编辑权绑定该浏览器，清除数据或换设备无法自动找回。GitHub 登录目前不作为发布门槛，也未额外开通 OAuth App。

社区按发布时间倒序，关键词或作者在服务器搜索、24 篇一页；短留言单独存储、50 条一页。无点赞或帖子评论。浏览量按服务端匿名网络标识每天去重，是近似阅读次数，同一网络可能合并，不代表精确独立人数。原始 IP 不落库。

所有表启用 RLS，anon/authenticated 没有直接读写权限。公开读和写都经过 `supabase/functions/rest-api/index.ts`；写操作使用 `auth.getUser` 验证真实会话并检查归属。封面 420×594，图片仅 JPG/PNG、2MB、实际文件头与尺寸校验；图片归属也在服务器验证。正文净化、长度/频率/并发版本检查均在服务器执行。

管理内容：在 Supabase Table Editor，把 `community_posts` 或 `short_notes` 的 `status` 改为 `hidden` 可隐藏内容，改回 `published` 可恢复。个人随笔只能通过 GitHub 内容源修改。

## 免费额度与翻译

Supabase Free：500MB 数据库、1GB 图片存储、约 5GB 出站流量、50,000 MAU；闲置项目可能暂停。本站没有启用收费升级。匿名会话只在需要写入时创建。

DeepL API Developer：累计 1,000,000 免费字符、不按月重置。本站数据库 `translation_budget` 的累计上限默认 900,000，超限停止新翻译；失败尝试也保守计入，缓存仍可读取。不会自动切换到付费服务。`DEEPL_API_KEY` 仅放 Supabase Secrets，任何密钥均不能写入 GitHub/前端。

只有点击翻译才调用 DeepL。先在服务器读取规范原帖，核对版本及每段原文，避免成为任意文本代理；按原帖版本和目标语言缓存、合并并发。保留原文中的图片、链接、代码和排版，仅替换文本节点，译文标注机器生成。

## 开发与部署

Node 24；`npm ci --ignore-scripts`、`npm test`、`npm run build`。`dist/` 是可独立发布目录，不提交构建产物。GitHub Actions 在 main 更新时测试、构建、发布 Pages。`web/config.js` 只含公开项目 URL 和 publishable key。

Supabase 项目 `vhzcitczgjzpriuevhwx`，区域 eu-west-1。初始化迁移在 `supabase/migrations/`。Edge Function 用固定版本官方 npm 库；网关旧 JWT 校验关闭，由函数明确校验写入会话（已获主人授权）。用新式服务密钥环境变量，不把管理员密钥传给浏览器。后台代码更新需部署 rest-api，GitHub Pages 构建不会自动修改数据库或函数。

本机预览：`node scripts/serve.mjs`，http://127.0.0.1:4173/。服务只绑定本机；`/setup/` 两个辅助端点只用于部署源码，公网构建不包含它们。

上线验收：`node scripts/live-check.mjs` 会创建两个独立匿名测试会话和明确测试内容，输出待隐藏的帖子/留言 ID；它不在 CI 中运行。不要把测试内容当正式社区帖子。

维护时可定期清理过期 `api_limits` 和旧 `post_view_receipts`。未发布图片会占存储，可按 `uploads.created_at` 与已发布正文引用人工核实后清理。不要批量删除仍被帖子引用的图片。额度不足时服务返回明确错误，不回退为“假发布到本机”。
