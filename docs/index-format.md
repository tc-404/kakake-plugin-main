# `index.json` 字段规范（v1）

本文件是咔咔珂插件商店数据源 `index.json` 的**权威格式说明**。后端会解析本结构，JSON 语法错误会导致整个「资源」页加载失败，改动前请仔细对照。

> 设计原则：**只保留必要字段**。凡是能由后端默认、或能通过 GitHub API 实时获取的信息（作者名、头像、星数、更新时间、分类等），都不写进 `index.json`，减少手填与出错。

> 建议每次改完 `index.json` 后，用任意 JSON 校验工具（如在线 JSONLint）确认语法合法。

---

## 目录

- [顶层结构](#顶层结构)
- [顶层字段](#顶层字段)
- [plugin 对象](#plugin-对象)
- [自动获取的信息（无需手填）](#自动获取的信息无需手填)
- [完整示例](#完整示例)
- [与咔咔珂后端字段的对应关系](#与咔咔珂后端字段的对应关系)
- [编辑注意事项](#编辑注意事项)

---

## 顶层结构

```json
{
  "format": "kakake-plugins-v1",
  "store_name": "咔咔珂插件商店",
  "notice": "……",
  "categories": [ { "id": 1, "name": "咔咔插件" } ],
  "plugins": [ /* plugin 对象数组 */ ]
}
```

---

## 顶层字段

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `format` | string | ✅ | 固定为 `"kakake-plugins-v1"`，用于校验格式版本。 |
| `store_name` | string | ➖ | 商店显示名，仅用于展示。 |
| `notice` | string | ➖ | **会展示给用户**的商店公告 / 免责声明，可为空。只写面向用户的内容，不要写"图标怎么取、星数怎么获取"这类内部机制说明。 |
| `categories` | array | ➖ | 分类列表，`{ "id": number, "name": string }`。目前只有一个「咔咔插件」；插件默认归入第一个分类，无需在每条插件里再写 `category_id`。 |
| `plugins` | array | ✅ | 插件列表，见 [plugin 对象](#plugin-对象)。可为空 `[]`。 |

---

## plugin 对象

字段已精简到最少。**作者真正要提供的只有插件名（`title`）与 zip 文件**，其余由维护者填一两项、后端补默认值。

| 字段 | 类型 | 必填 | 谁填 | 说明 |
|------|------|------|------|------|
| `id` | number | ✅ | 维护者 | 插件唯一 ID，正整数，**不可重复**。新增取当前最大 + 1。 |
| `title` | string | ✅ | 作者 | 插件显示名。**唯一强制作者提供的展示字段。** |
| `download` | string | ✅ | 维护者 | 插件 zip 直链，**必须是本商店仓库 Release 附件**（非作者外链 / 非作者项目仓库地址）。 |
| `sha256` | string | ➖ | 维护者 | 插件 zip 的 SHA-256 校验值（64 位十六进制，小写）。填了后端会在下载后校验完整性，不一致则拒绝安装，防篡改/防损坏。见 [如何计算 sha256](#如何计算-sha256)。 |
| `version` | string | ➖ | 作者 | 版本号，建议语义化如 `1.0.0`。 |
| `github` | string | ➖ | 维护者 | 作者 GitHub 用户名（login）。用于头像与作者名；从投稿 Issue/PR 提交者自动带入。 |
| `homepage` | string | ➖ | 作者 | 插件源码仓库地址（如 `https://github.com/用户/仓库`）。填了它，后端可**自动获取星数与更新时间**，见下节。 |
| `summary` | string | ➖ | 作者 | 一句话简介，列表卡片展示。 |
| `description` | string | ➖ | 作者 | 详细说明，可含换行 `\n`。 |
| `tags` | string[] | ➖ | 作者 | 标签数组，如 `["工具","天气"]`。 |
| `update_notes` | string | ➖ | 作者 | 本版本更新说明（可选）。 |
| `pinned` | boolean | ➖ | 维护者 | 置顶到商店顶部；**仅需置顶时才加**，默认不置顶。 |

> 已移除的旧字段：`category_id`、`author`、`resource_type`、`sort_order`、`allow_list`、`allow_detail`、`allow_download`、`allow_cover_preview`、`download_block_reason`、`created_at`、`updated_at`、`links.cover`，以及 `links` 外壳（`download` 直接平铺到顶层）。这些统一由后端套默认值或走 API，见下节。

---

## 如何计算 sha256

`sha256` 是插件 zip 文件的指纹，用于校验下载内容未被篡改或损坏。**由维护者在上传 Release 后计算并填入**（64 位十六进制，小写）。计算方式：

- **Windows PowerShell**：`(Get-FileHash 插件.zip -Algorithm SHA256).Hash.ToLower()`
- **Windows CMD**：`certutil -hashfile 插件.zip SHA256`
- **Linux / macOS**：`sha256sum 插件.zip`

把得到的值原样填进 `sha256`。更新插件换新 zip 时，`sha256` 也要跟着换成新文件的值。留空则后端不做完整性校验（仍可正常下载安装）。

---

## 自动获取的信息（无需手填）

以下内容**不写进 `index.json`**，由咔咔珂后端在读取时补上或实时向 GitHub 查询：

| 信息 | 来源 | 说明 |
|------|------|------|
| 插件图标 / 头像 | `https://github.com/{github}.png` | 用 `github` 拼出，`github` 为空则用内置默认图标。 |
| 作者显示名 | `github` | 不再有 `author` 字段，直接显示 GitHub 用户名。 |
| **仓库星数** | `GET https://api.github.com/repos/{owner}/{repo}` 的 `stargazers_count` | 从 `homepage` 解析出 `owner/repo` 后查询；`homepage` 非 GitHub 仓库则无星数。 |
| **更新时间** | 该插件在**本商店仓库 Release** 的 `published_at`（`GET /repos/<商店仓库>/releases`）；或 `homepage` 仓库的 `pushed_at` | 每次更新都新建版本化 Release，其发布时间天然就是"上架/更新时间"。 |
| 分类 | 顶层 `categories` 第一项 | 单分类时插件默认归入。 |
| 类型 / 排序 / 是否允许下载等 | 后端默认值 | 类型默认「野鸡」、排序 0、默认允许列表/详情/下载。 |

**你问的两项的答案：**

- **资源更新时间 → 不用手填**，后端调 GitHub API 取 Release 的 `published_at`（或源码仓库 `pushed_at`）。
- **插件仓库星数 → 不用手填**，后端调 `GET /repos/{owner}/{repo}` 取 `stargazers_count`，前提是条目里填了 `homepage`（指向该插件的 GitHub 仓库）。若插件没有公开 GitHub 仓库，则没有星数。

> ⚠️ **调用频率与缓存**：GitHub API 匿名限 60 次/小时、带 Token 5000 次/小时。给每个插件实时查星数/时间，列表一多就可能触顶。后端应**带缓存**（沿用现有约 60s 列表缓存，或单独缓存星数几分钟到几小时），必要时带 Token。头像用 `github.com/{login}.png` 直链不算 API 调用、不受限。境内访问 `api.github.com` 可能不稳，需要时加代理/镜像兜底。

---

## 完整示例

```json
{
  "format": "kakake-plugins-v1",
  "store_name": "咔咔珂插件商店",
  "notice": "本商店插件均由社区投稿、经维护者审核后收录。第三方插件请自行甄别安全性。",
  "categories": [
    { "id": 1, "name": "咔咔插件" }
  ],
  "plugins": [
    {
      "id": 1,
      "title": "示例天气插件",
      "version": "1.0.0",
      "github": "tc-404",
      "homepage": "https://github.com/tc-404/weather-plugin",
      "summary": "发送「天气 城市名」查询实时天气",
      "description": "支持指令：\n- 天气 北京\n- 天气 上海",
      "tags": ["工具", "天气"],
      "download": "https://github.com/tc-404/kakake-plugin-main/releases/download/weather-v1.0.0/weather-plugin-1.0.0.zip",
      "sha256": "a39821db9d1362cda5a295065230993911366c13cd80c4269c60763925a98226"
    }
  ]
}
```

最小可用条目其实只需要：

```json
{ "id": 2, "title": "某插件", "download": "https://github.com/tc-404/kakake-plugin-main/releases/download/xxx/plugin.zip" }
```

---

## 与咔咔珂后端字段的对应关系

后端从旧的服务器接口切换到 GitHub 时的处理（`src/plugin/plugin-store.service.ts`）：

| 本 `index.json` | 后端处理 | 备注 |
|------------------|----------|------|
| `plugins[]` | 列表资源 | 扁平数组；`pinned: true` 的拆进置顶组 |
| `title` / `version` / `summary` / `description` / `tags` / `update_notes` | 同名字段 | 直接映射 |
| `download` | `links.download` | 平铺字段，读取时包成 `links.download` 或直接用 |
| `sha256` | 下载后完整性校验 | 下载 zip 后计算 SHA-256 与之比对，不一致则拒绝安装；留空则跳过校验 |
| `github` | 头像 + 作者名 | 头像 = `https://github.com/{github}.png`；作者名 = `github`（为空用默认） |
| `homepage` | 星数 + 更新时间来源 | 解析 `owner/repo` → 调 API 取 `stargazers_count` 与时间 |
| 缺失的旧字段 | 后端默认值 | `category_id=1`、`resource_type=野鸡`、`sort_order=0`、`allow_*=1`、统计计数=0 |

后端改造要点：

1. `PLUGIN_STORE_BASE` → 本仓库 `index.json` 的 raw 直链。
2. `fetchList` 改为解析 `kakake-plugins-v1`：读 `plugins[]`、按 `pinned` 拆置顶、对缺失字段套默认值、把 `download` 归一到 `links.download`。
3. 图标：不再有 `cover`；`github` 非空时封面/图标 URL = `https://github.com/{github}.png`。
4. 星数 / 更新时间：从 `homepage` 解析 `owner/repo`，调 `GET /repos/{owner}/{repo}` 取 `stargazers_count`、`pushed_at`；或对本商店仓库 Release 取 `published_at`。**务必加缓存**，避免触发 API 频率限制。
5. 评论接口 GitHub 无对应，先移除评论 UI 或后续接 Discussions。
6. 下载沿用现有 `downloadToTemp`，URL 来源变成本仓库 Release。
7. **完整性校验**：`sha256` 非空时，`downloadToTemp` 下载完对 zip 算 SHA-256 与之比对，不一致抛错、拒绝导入；为空则跳过。

---

## 编辑注意事项

- **JSON 严格语法**：字符串用双引号；对象/数组最后一项后**不能有多余逗号**；换行在字符串里写 `\n`。
- **`id` 唯一且递增**：新增插件取现有最大 `id` + 1，切勿重复。
- **`download` 必须指向本商店仓库 Release**，不要用作者外链或作者项目仓库地址；更新时新建版本化 Release，别覆盖旧文件。
- **改完必校验**：贴到 JSON 校验器确认合法，避免整页崩溃。
