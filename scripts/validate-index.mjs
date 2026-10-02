#!/usr/bin/env node
/**
 * index.json 规范校验器（kakake-plugins-v1）
 *
 * 用途：在 PR 上做"机械校验"，把格式类错误在人工介入之前就拦掉。
 * 说明：本脚本只做能写死成规则的检查，不做任何安全判定。
 *       zip 里有没有偷 token，机器判不了，必须人眼看。
 *
 * 环境变量：
 *   CHANGED_FILES_FILE  可选。PR 改动文件列表（每行一个路径），用于阻止 PR 偷改工作流自毁。
 *   ALLOW_PROTECTED     可选。为 "1" 时允许改动受保护路径（维护者本人 PR 用）。
 *   PHASE               可选。'pr'（默认）或 'main'。
 *                       pr   —— 允许 download 指向外部地址，因为批准后工作流会自动转存并改写；
 *                       main —— 严格要求 download 必须已是本仓库 Release 直链。
 *   STRICT_DOWNLOAD     可选。为 "1" 时，main 阶段下连"非 GitHub 的随便什么外链"也直接报错。
 */

import { readFileSync } from 'node:fs';

const INDEX_FILE = 'index.json';
const PHASE = (process.env.PHASE || 'pr').toLowerCase();

const ALLOWED_TOP_FIELDS = new Set(['format', 'store_name', 'notice', 'plugins']);

const ALLOWED_PLUGIN_FIELDS = new Set([
  'title', 'plugin_id', 'download', 'type', 'min_kakake', 'version',
  'name', 'homepage', 'summary', 'description', 'tags', 'sha256',
  'update_notes', 'pinned',
]);

const ALLOWED_TYPES = new Set(['野生', '官方', '微信', '其他']);

const STORE_REPO = 'tc-404/kakake-plugin-main';
const DOWNLOAD_PREFIX = `https://github.com/${STORE_REPO}/releases/download/`;

/**
 * 历史遗留豁免名单。
 * 里面的插件 download 指向了作者自己的项目仓库，违反了本仓库自己的安全红线。
 * 迁移到本仓库 Release 后，请立刻把对应 plugin_id 从这里删掉。
 * 加进来只是因为"不想让别人的 PR 被一个历史包袱拖成永久红灯"。
 */
const LEGACY_EXEMPT = new Set(['kakake-plugin-mkbot']);

const PROTECTED_PATH_PREFIXES = ['.github/', 'scripts/'];
const ALLOWED_PATH_PREFIXES = ['index.json', 'README.md', 'CONTRIBUTING.md', 'docs/'];

const errors = [];
const warnings = [];

const err = (msg, file = INDEX_FILE) => errors.push({ msg, file });
const warn = (msg, file = INDEX_FILE) => warnings.push({ msg, file });

function isNonEmptyString(v) {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateChangedFiles() {
  const listFile = process.env.CHANGED_FILES_FILE;
  if (!listFile) return;

  let changed;
  try {
    changed = readFileSync(listFile, 'utf8')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
  } catch {
    warn('读不到改动文件列表，跳过路径白名单检查', '.');
    return;
  }

  const allowProtected = process.env.ALLOW_PROTECTED === '1';

  for (const path of changed) {
    if (PROTECTED_PATH_PREFIXES.some((p) => path.startsWith(p)) && !allowProtected) {
      err(
        `PR 不允许修改受保护路径 [${path}]。工作流与校验脚本一旦能被投稿者改动，整套检查就是纸糊的。` +
        ` 如确需修改，请由维护者直接提交。`,
        path
      );
      continue;
    }
    if (!ALLOWED_PATH_PREFIXES.some((p) => path === p || path.startsWith(p))) {
      warn(
        `PR 改动了一般投稿目录之外的文件 [${path}]，请确认是有意为之。` +
        ` 插件本体不应提交进本仓库（zip 一律走 Release 附件）。`,
        path
      );
    }
  }
}

function validateStructure(data) {
  if (data === null || typeof data !== 'object' || Array.isArray(data)) {
    err('index.json 顶层必须是一个 JSON 对象');
    return false;
  }

  for (const key of Object.keys(data)) {
    if (!ALLOWED_TOP_FIELDS.has(key)) {
      err(`顶层出现未知字段 "${key}"，规范只允许：${[...ALLOWED_TOP_FIELDS].join(' / ')}`);
    }
  }

  if (data.format !== 'kakake-plugins-v1') {
    err(`顶层 format 必须是 "kakake-plugins-v1"，当前是 ${JSON.stringify(data.format)}`);
  }

  if (!Array.isArray(data.plugins)) {
    err('顶层 plugins 必须是数组（可为空数组）');
    return false;
  }

  return true;
}

function validatePlugin(plugin, i) {
  const at = `plugins[${i}]`;
  const label = isNonEmptyString(plugin && plugin.title) ? `"${plugin.title}"` : at;

  if (plugin === null || typeof plugin !== 'object' || Array.isArray(plugin)) {
    err(`${at} 必须是对象`);
    return;
  }

  for (const key of Object.keys(plugin)) {
    if (!ALLOWED_PLUGIN_FIELDS.has(key)) {
      err(`${label}: 出现未知字段 "${key}"，规范只允许：${[...ALLOWED_PLUGIN_FIELDS].join(' / ')}`);
    }
  }

  if (!isNonEmptyString(plugin.title)) {
    err(`${at}: 缺少必填字段 title（插件显示名）`);
  }

  if (!isNonEmptyString(plugin.download)) {
    err(`${label}: 缺少必填字段 download。请填上"能下载到这个插件 zip 的地址"，批准收录时工作流会自动把它转存进本仓库 Release。`);
  } else {
    const url = plugin.download;
    const isStoreUrl = url.startsWith(DOWNLOAD_PREFIX);
    const isGithubRelease = /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//.test(url);
    const isGithubAttachment = /^https:\/\/github\.com\/user-attachments\/assets\//.test(url);

    if (isStoreUrl) {
      if (!url.toLowerCase().endsWith('.zip')) {
        warn(`${label}: download 不是 .zip 结尾，确认附件类型是否正确。`);
      }
    } else if (PHASE === 'pr') {
      // PR 阶段外链是正常的：作者还没法把文件放进维护者的 Release，
      // 转存是批准之后由工作流完成的。这里只提示，不阻止。
      const kind = isGithubRelease
        ? '作者自己项目仓库的 Release'
        : isGithubAttachment
          ? 'GitHub 附件'
          : '外部地址';
      warn(
        `${label}: download 目前是${kind}。PR 阶段这是正常状态。` +
        `维护者打 approved 标签后，工作流会自动下载该 zip、转存进本仓库 Release，并把此字段改写成正式直链 + 补上 sha256。` +
        `（若此 PR 绕过收录流程直接合入 main，main 阶段的检查会报错。）`
      );
    } else {
      const exempt = plugin.plugin_id && LEGACY_EXEMPT.has(plugin.plugin_id);
      if (exempt) {
        warn(
          `${label}: download 指向作者自己的项目仓库或外部地址，违反商店规则。` +
          `（plugin_id=${plugin.plugin_id} 在历史豁免名单内，计为警告。请尽快走一次收录流程转存。）`
        );
      } else if (isGithubRelease || STRICT_DOWNLOAD === '1') {
        err(
          `${label}: download 必须指向本仓库 Release 附件，当前是 ${url}。` +
          `外部链接的内容可以被事后偷换，sha256 也拦不住。请把 zip 转存进本仓库 Release 后再填直链。`
        );
      } else {
        warn(`${label}: download 不是本仓库 Release 直链，请确认来源可信。`);
      }
    }
  }

  if (plugin.type !== undefined && !ALLOWED_TYPES.has(plugin.type)) {
    err(`${label}: type 只能是 ${[...ALLOWED_TYPES].join(' / ')} 之一，当前是 ${JSON.stringify(plugin.type)}`);
  }

  if (plugin.plugin_id !== undefined) {
    if (!isNonEmptyString(plugin.plugin_id)) {
      warn(`${label}: plugin_id 为空。缺了它后端无法判断"已安装 / 可更新"。`);
    } else if (!/^[a-z0-9][a-z0-9._-]*$/.test(plugin.plugin_id)) {
      warn(`${label}: plugin_id "${plugin.plugin_id}" 命名不太规范，建议小写字母数字加连字符。`);
    }
  } else {
    warn(`${label}: 建议补 plugin_id（应等于插件包 plugin.json 的 name）。`);
  }

  if (plugin.name !== undefined) {
    const isLogin = typeof plugin.name === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$/.test(plugin.name);
    if (!isLogin) {
      err(`${label}: name 必须是 GitHub 用户名（用于取头像和显示作者），当前是 ${JSON.stringify(plugin.name)}`);
    }
  }

  if (plugin.homepage !== undefined && isNonEmptyString(plugin.homepage)) {
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(plugin.homepage)) {
      warn(`${label}: homepage "${plugin.homepage}" 不是标准的 GitHub 仓库地址，后端取不到星数与更新时间。`);
    }
  }

  if (plugin.sha256 !== undefined) {
    if (!/^[a-f0-9]{64}$/.test(plugin.sha256)) {
      err(`${label}: sha256 必须是 64 位小写十六进制。当前长度 ${String(plugin.sha256).length}。`);
    }
  } else {
    warn(`${label}: 没有 sha256，下载后不会做完整性校验。`);
  }

  if (plugin.version !== undefined && !/^\d+\.\d+\.\d+/.test(String(plugin.version))) {
    warn(`${label}: version "${plugin.version}" 不是语义化版本号（如 1.0.0），后端做版本比对时可能不准。`);
  }

  if (plugin.tags !== undefined) {
    if (!Array.isArray(plugin.tags) || plugin.tags.some((t) => !isNonEmptyString(t))) {
      err(`${label}: tags 必须是非空字符串数组。`);
    }
  }

  if (plugin.pinned !== undefined && typeof plugin.pinned !== 'boolean') {
    err(`${label}: pinned 必须是布尔值 true / false。`);
  }

  if (plugin.min_kakake !== undefined && !/^\d+\.\d+/.test(String(plugin.min_kakake))) {
    warn(`${label}: min_kakake "${plugin.min_kakake}" 格式不像版本号。`);
  }
}

function validateUniqueTitles(plugins) {
  const seen = new Map();
  plugins.forEach((p, i) => {
    if (!p || !isNonEmptyString(p.title)) return;
    const key = p.title.trim().toLowerCase().replace(/\s+/g, '');
    if (seen.has(key)) {
      err(
        `插件名重复："${p.title}"（plugins[${i}] 与 plugins[${seen.get(key)}]）。` +
        ` title 是商店里的唯一标识，重名会让"已安装/更新"判断错乱。`,
        INDEX_FILE
      );
    } else {
      seen.set(key, i);
    }
  });
}

function main() {
  validateChangedFiles();

  let raw;
  try {
    raw = readFileSync(INDEX_FILE, 'utf8');
  } catch {
    err('仓库根目录找不到 index.json', '.');
    report();
    return;
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    err(`index.json 不是合法 JSON：${e.message}。这一处语法错误会让整个商店页面加载失败。`);
    report();
    return;
  }

  if (validateStructure(data)) {
    validateUniqueTitles(data.plugins);
    data.plugins.forEach(validatePlugin);
  }

  report();
}

function report() {
  for (const w of warnings) {
    console.log(`::warning file=${w.file}::${w.msg}`);
  }
  for (const e of errors) {
    console.log(`::error file=${e.file}::${e.msg}`);
  }

  console.log('');
  console.log(`校验完成：${errors.length} 个错误，${warnings.length} 个警告。`);

  if (warnings.length > 0) {
    console.log('');
    console.log('警告不会阻止合并，但建议处理：');
    warnings.forEach((w) => console.log(`  - ${w.msg}`));
  }

  if (errors.length > 0) {
    console.log('');
    console.log('错误清单：');
    errors.forEach((e) => console.log(`  - ${e.msg}`));
    process.exit(1);
  }
}

main();
