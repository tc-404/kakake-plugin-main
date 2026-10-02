#!/usr/bin/env node
/**
 * 从 PR 的 index.json 改动里，自动认出"这个 PR 想收录哪一条插件"。
 *
 * 这是让维护者不必手写 JSON 的关键：作者在 PR 里怎么写的，机器人就怎么读。
 * 维护者只需要说"这个 PR 我批了"。
 *
 * 用法：
 *   node scripts/extract-entry.mjs --base <main上的index.json> --head <PR上的index.json> \
 *                                  --out <写出的条目JSON> --env <写出的环境变量文件>
 *
 * 退出码：0 成功 / 1 有错误（错误信息以 ::error:: 输出，会显示在 Actions 里）
 *
 * 约定：一个 PR 只收录一条插件。
 *   新增 -> 追加条目；更新 -> 覆盖同 plugin_id（或同名）的条目。
 *   删除条目 / 一次改多条 -> 不自动处理，报错交给人工。
 */

import { readFileSync, writeFileSync } from 'node:fs';

function fail(msg) {
  console.log(`::error::${msg}`);
  process.exit(1);
}

const args = new Map();
for (let i = 2; i < process.argv.length - 1; i += 2) {
  args.set(process.argv[i].replace(/^--/, ''), process.argv[i + 1]);
}

const baseFile = args.get('base');
const headFile = args.get('head');
const outFile = args.get('out');
const envFile = args.get('env');

if (!baseFile || !headFile) fail('必须同时提供 --base 和 --head');

function load(file, label) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    fail(`读不到 ${label} 的 index.json（${file}）。请确认 PR 确实改动了这个文件。`);
  }
  try {
    return JSON.parse(raw);
  } catch (e) {
    fail(`${label} 的 index.json 不是合法 JSON：${e.message}`);
  }
}

const base = load(baseFile, 'base');
const head = load(headFile, 'head');

if (!Array.isArray(base.plugins) || !Array.isArray(head.plugins)) {
  fail('index.json 的 plugins 不是数组，无法比对。');
}

/** 条目标识：优先 plugin_id（插件的稳定身份），退回 title 的规范化值 */
function keyOf(p) {
  if (p && typeof p.plugin_id === 'string' && p.plugin_id.trim()) {
    return `id:${p.plugin_id.trim().toLowerCase()}`;
  }
  return `title:${String((p && p.title) || '').trim().toLowerCase().replace(/\s+/g, '')}`;
}

/** 稳定序列化，避免键顺序不同造成的假差异 */
function stable(p) {
  return JSON.stringify(
    Object.keys(p || {})
      .sort()
      .reduce((acc, k) => {
        acc[k] = p[k];
        return acc;
      }, {})
  );
}

const baseMap = new Map(base.plugins.map((p) => [keyOf(p), p]));
const headMap = new Map(head.plugins.map((p) => [keyOf(p), p]));

const added = [];
const updated = [];
const removed = [];

for (const [k, p] of headMap) {
  const b = baseMap.get(k);
  if (!b) {
    added.push(p);
  } else if (stable(b) !== stable(p)) {
    updated.push({ entry: p, previous: b });
  }
}

for (const [k, b] of baseMap) {
  if (!headMap.has(k)) removed.push(b);
}

if (removed.length > 0) {
  fail(
    `本 PR 删除了 ${removed.length} 个已有条目：${removed.map((p) => p.title).join('、')}。` +
    ` 下架操作不通过收录流程处理，请维护者直接改 index.json 提交。`
  );
}

const changes = [
  ...added.map((p) => ({ kind: '新增', entry: p })),
  ...updated.map((u) => ({ kind: '更新', entry: u.entry, previous: u.previous })),
];

if (changes.length === 0) {
  fail(
    '没有检测到任何插件条目的新增或修改。' +
    ' 这个流程只负责收录插件；纯文档类 PR 请维护者直接合并。'
  );
}

if (changes.length > 1) {
  fail(
    `一次检测到 ${changes.length} 处改动：` +
    changes.map((c) => `${c.kind}「${c.entry.title}」`).join('、') +
    '。为避免 zip 与条目对不上，收录流程一次只处理一条，请拆成多个 PR，或由维护者手动处理。'
  );
}

const change = changes[0];
const entry = change.entry;

if (!entry.title || typeof entry.title !== 'string' || !entry.title.trim()) {
  fail('该条目的 title 为空，无法确定插件名。');
}

const zipUrl = typeof entry.download === 'string' ? entry.download.trim() : '';
if (!/^https?:\/\//i.test(zipUrl)) {
  fail(
    `该条目的 download 不是一个可下载的 http(s) 地址（当前值：${JSON.stringify(entry.download)}）。` +
    ` 请作者把它填成能下载到 zip 的地址（推荐自己仓库的 Release 附件），收录时工作流会自动转存到本仓库。`
  );
}

function slug(input) {
  return String(input)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'plugin';
}

const idForName = entry.plugin_id || entry.title;
const version = String(entry.version || '1.0.0').trim();
const releaseTag = `${slug(idForName)}-v${version}`;
const assetName = `${slug(idForName)}-${version}.zip`;

if (outFile) {
  writeFileSync(
    outFile,
    `${JSON.stringify({ kind: change.kind, entry, previous: change.previous || null }, null, 2)}\n`,
    'utf8'
  );
}

if (envFile) {
  const lines = [
    `KIND=${change.kind}`,
    `ENTRY_TITLE=${entry.title}`,
    `ENTRY_PLUGIN_ID=${entry.plugin_id || ''}`,
    `ENTRY_VERSION=${version}`,
    `ZIP_URL=${zipUrl}`,
    `RELEASE_TAG=${releaseTag}`,
    `ASSET_NAME=${assetName}`,
  ];
  writeFileSync(envFile, `${lines.join('\n')}\n`, 'utf8');
}

console.log(`识别到改动：${change.kind}「${entry.title}」${entry.plugin_id ? ` (${entry.plugin_id})` : ''} v${version}`);
console.log(`zip 来源：${zipUrl}`);
console.log(`将创建 Release 标签：${releaseTag}`);
console.log(`将上传的附件名：${assetName}`);
