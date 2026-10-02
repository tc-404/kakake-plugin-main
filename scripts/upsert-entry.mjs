#!/usr/bin/env node
/**
 * 把一条插件条目写进 index.json（存在则合并更新，不存在则追加）。
 *
 * 被"批准收录"工作流调用：下载 zip、算 sha256、建 Release 之后的"回填"这一步由它完成。
 * 维护者不需要手写任何 JSON —— 条目内容直接来自作者在 PR 里写的那一条。
 *
 * 环境变量：
 *   ENTRY_JSON   必填。一条 plugin 对象的 JSON（字符串），来自 PR。
 *   DOWNLOAD_URL 必填。本仓库 Release 附件直链，会覆盖 ENTRY_JSON 里的 download。
 *   SHA256       可选。实际算出的 sha256，覆盖 ENTRY_JSON 里的值。
 *
 * 合并策略（更新已有条目时）：
 *   作者提供的字段覆盖旧的；作者没写的字段（pinned / type / min_kakake / name 等维护者字段）
 *   保留原值，避免作者漏填就把维护者的设置冲掉。
 */

import { readFileSync, writeFileSync } from 'node:fs';

const INDEX_FILE = 'index.json';
const ALLOWED_TYPES = new Set(['野生', '官方', '微信', '其他']);

function fail(msg) {
  console.log(`::error file=index.json::${msg}`);
  process.exit(1);
}

const entryRaw = process.env.ENTRY_JSON;
const downloadUrl = process.env.DOWNLOAD_URL;
const sha256 = process.env.SHA256;

if (!entryRaw) fail('缺少 ENTRY_JSON');
if (!downloadUrl) fail('缺少 DOWNLOAD_URL');
if (!downloadUrl.startsWith('https://github.com/')) {
  fail(`DOWNLOAD_URL 必须指向本仓库 Release，当前是 ${downloadUrl}`);
}

let incoming;
try {
  incoming = JSON.parse(entryRaw);
} catch (e) {
  fail(`ENTRY_JSON 不是合法 JSON：${e.message}`);
}

if (typeof incoming !== 'object' || incoming === null || Array.isArray(incoming)) {
  fail('ENTRY_JSON 必须是一个 JSON 对象');
}
if (!incoming.title || typeof incoming.title !== 'string' || !incoming.title.trim()) {
  fail('ENTRY_JSON 必须包含非空的 title');
}

const data = JSON.parse(readFileSync(INDEX_FILE, 'utf8'));
if (!Array.isArray(data.plugins)) fail('index.json 的 plugins 不是数组');

const keyOf = (p) => {
  if (p && typeof p.plugin_id === 'string' && p.plugin_id.trim()) {
    return `id:${p.plugin_id.trim().toLowerCase()}`;
  }
  return `title:${String((p && p.title) || '').trim().toLowerCase().replace(/\s+/g, '')}`;
};

const target = keyOf(incoming);
const idx = data.plugins.findIndex((p) => keyOf(p) === target);

const incomingKeys = new Set(Object.keys(incoming));
const maintained = {};

if (idx >= 0) {
  const before = data.plugins[idx];
  for (const [k, v] of Object.entries(before)) {
    if (!incomingKeys.has(k)) maintained[k] = v;
  }
  data.plugins[idx] = { ...maintained, ...incoming, download: downloadUrl };
  if (sha256) data.plugins[idx].sha256 = sha256;
  console.log(
    `已更新条目：「${before.title}」${before.version || '(无版本)'} -> ${incoming.version || '(无版本)'}`
  );
  if (Object.keys(maintained).length > 0) {
    console.log(`保留了作者未提供的维护者字段：${Object.keys(maintained).join(', ')}`);
  }
} else {
  const fresh = { ...incoming, download: downloadUrl };
  if (sha256) fresh.sha256 = sha256;
  if (!fresh.type) fresh.type = '其他';
  data.plugins.push(fresh);
  console.log(`已新增条目：「${fresh.title}」${fresh.version || '(无版本)'}`);
}

if (sha256) {
  console.log(`sha256 已写入：${sha256}`);
}

for (const p of data.plugins) {
  if (p.type !== undefined && !ALLOWED_TYPES.has(p.type)) {
    fail(`写入后 type 非法：「${p.title}」的 type 是 ${JSON.stringify(p.type)}`);
  }
}

writeFileSync(INDEX_FILE, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
console.log(`index.json 已写入，当前共 ${data.plugins.length} 个插件。`);
