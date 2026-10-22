// 离线用例校验：加载 midscene.config.ts，按项目的 files.include 收集 YAML，
// 校验 YAML 语法、节点名是否存在、项目变量能否解析。不连设备、不调模型。
// 用法：pnpm validate
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { collectWorkflowDocument } from '@midscene/test';
import { loadTestProject } from '@midscene/test/config';

const projectRoot = process.cwd();
const configPath = resolve(projectRoot, 'midscene.config.ts');
const loaded = await loadTestProject(configPath);

const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.ya?ml$/.test(name)) out.push(full);
  }
  return out;
};

// 从 glob 里取出"非通配"的路径片段，用来过滤本项目的用例文件。
// 例如 games/**/smoke/**/*.{yaml,yml} -> ['games', 'smoke']
const literalSegments = (pattern) =>
  pattern
    .split('/')
    .filter((segment) => segment && !segment.includes('*') && !segment.includes('{'));

const toPosix = (value) => value.split('\\').join('/');

let files = 0;
let cases = 0;
const errors = [];

for (const project of loaded.projects) {
  const checked = new Set();

  for (const pattern of project.files.include) {
    if (isAbsolute(pattern)) {
      errors.push({ project: project.name, file: pattern, message: 'files.include 不允许绝对路径' });
      continue;
    }
    const segments = literalSegments(pattern);
    const base = join(projectRoot, segments[0] || '.');
    if (!existsSync(base)) continue;

    for (const absolute of walk(base)) {
      const relPath = toPosix(relative(projectRoot, absolute));
      if (checked.has(relPath)) continue;
      // 用 glob 里的固定片段做过滤：必须命中所有片段（除首段已作为目录）
      const hit = segments.slice(1).every((segment) => relPath.includes('/' + segment + '/'));
      if (!hit) continue;
      if ((project.files.exclude || []).some((pattern2) => relPath.includes(pattern2.replace('**/', '')))) {
        continue;
      }
      checked.add(relPath);
      files += 1;

      try {
        const document = collectWorkflowDocument(
          {
            projectId: project.projectId,
            projectName: project.name,
            sourcePath: relPath,
            absolutePath: relPath,
          },
          {
            resolveNode: (name) => project.nodes.get(name),
            variables: project.variables,
            env: process.env,
          }
        );
        cases += document.cases.length;
        console.log('  ok  [' + project.name + '] ' + relPath + ' (' + document.cases.length + ' cases)');
      } catch (error) {
        errors.push({
          project: project.name,
          file: relPath,
          message: error?.cause?.message || error?.message || String(error),
        });
        console.log('  FAIL [' + project.name + '] ' + relPath + ': ' + (error?.cause?.message || error?.message));
      }
    }
  }
}

console.log('');
console.log('projects=' + loaded.projects.length + ' files=' + files + ' cases=' + cases + ' errors=' + errors.length);

if (!files) {
  console.log('没有找到任何用例文件，检查 midscene.config.ts 的 files.include');
  process.exitCode = 1;
} else if (errors.length) {
  process.exitCode = 1;
}
