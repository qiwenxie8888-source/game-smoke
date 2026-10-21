// 生成冒烟测试汇总面板 dashboard.html
// 数据源：.midscene/test-results/<runId>/summary.json（+ 失败用例的 attempt resultFile）
// 用法：node scripts/gen-dashboard.mjs [--open]
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { exec } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, '..');
const resultsRoot = join(projectRoot, '.midscene', 'test-results');

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function fmtDuration(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m}m ${r}s` : `${m}m`;
}

function toUrlPath(absPath) {
  return relative(projectRoot, absPath).split('\\').join('/');
}

function collectRuns() {
  const runs = [];
  if (!existsSync(resultsRoot)) return runs;
  for (const d of readdirSync(resultsRoot, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const summaryPath = join(resultsRoot, d.name, 'summary.json');
    if (!existsSync(summaryPath)) continue;
    let summary;
    try {
      summary = readJson(summaryPath);
    } catch {
      continue;
    }
    const run = {
      runId: summary.runId || d.name,
      startedAt: summary.startedAt,
      durationMs: summary.durationMs,
      status: summary.status,
      exitCode: summary.exitCode,
      total: summary.summary?.total ?? 0,
      passed: summary.summary?.passed ?? 0,
      failed: summary.summary?.failed ?? 0,
      notRun: summary.summary?.notRun ?? 0,
      passRate: summary.summary?.finalPassRate ?? 0,
      reportUrl: summary.report
        ? toUrlPath(resolve(join(resultsRoot, d.name), summary.report))
        : null,
      cases: [],
    };
    for (const project of summary.projects || []) {
      for (const c of project.cases || []) {
        const attempt = (c.attempts || [])[0] || {};
        let steps = 0;
        let durMs = 0;
        let failedStep = null;
        if (attempt.resultFile) {
          try {
            const rf = readJson(resolve(join(resultsRoot, d.name), attempt.resultFile));
            const st = rf.steps || [];
            steps = st.length;
            durMs = st.reduce((a, s) => a + (s.durationMs || 0), 0);
            const bad = st.find((s) => s.status === 'failed');
            if (bad) {
              const msg = bad.error?.message || '';
              failedStep = {
                node: bad.node,
                stepIndex: bad.stepIndex,
                prompt:
                  typeof bad.input?.prompt === 'string'
                    ? bad.input.prompt
                    : bad.input?.prompt?.prompt || '',
                message: msg.split('\n')[0],
                detail: msg,
              };
            }
          } catch {
            /* 结果文件读取失败时降级为无步骤信息 */
          }
        }
        run.cases.push({
          name: c.name,
          sourcePath: c.sourcePath,
          status: c.status,
          steps,
          durationMs: durMs,
          failedStep,
        });
      }
    }
    runs.push(run);
  }
  runs.sort((a, b) => (a.runId < b.runId ? 1 : -1));
  return runs;
}

const runs = collectRuns();
if (!runs.length) {
  console.error('没有找到任何运行记录（.midscene/test-results/*/summary.json）');
  process.exit(1);
}

const data = { generatedAt: new Date().toISOString(), runs };
const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>小游戏冒烟测试汇总</title>
<style>
  :root {
    --bg: #f5f6f8; --card: #ffffff; --text: #1f2329; --muted: #8f959e;
    --green: #2ea44f; --red: #d1242f; --gray: #9da5b0; --blue: #0969da;
    --border: #e5e8ec;
  }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px; background: var(--bg); color: var(--text);
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif; }
  .wrap { max-width: 1080px; margin: 0 auto; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: var(--muted); font-size: 12px; margin-bottom: 20px; }
  .hero { background: var(--card); border: 1px solid var(--border); border-radius: 12px;
    padding: 20px 24px; display: flex; gap: 32px; align-items: center; flex-wrap: wrap; }
  .hero .big { font-size: 34px; font-weight: 700; }
  .hero .pass { color: var(--green); } .hero .fail { color: var(--red); }
  .metric { display: flex; flex-direction: column; gap: 2px; }
  .metric .k { font-size: 12px; color: var(--muted); }
  .metric .v { font-size: 16px; font-weight: 600; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; }
  .badge.ok { background: #e9f7ee; color: var(--green); }
  .badge.bad { background: #fdecee; color: var(--red); }
  table { width: 100%; border-collapse: collapse; background: var(--card); }
  .card { background: var(--card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; margin-top: 16px; }
  .card h2 { font-size: 14px; margin: 0; padding: 14px 18px; border-bottom: 1px solid var(--border); }
  th, td { text-align: left; padding: 12px 18px; font-size: 13px; border-bottom: 1px solid var(--border); vertical-align: top; }
  th { color: var(--muted); font-weight: 500; font-size: 12px; }
  tr:last-child td { border-bottom: none; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 7px; }
  .dot.ok { background: var(--green); } .dot.bad { background: var(--red); } .dot.skip { background: var(--gray); }
  .reason { color: var(--red); font-size: 12px; margin-top: 4px; line-height: 1.5; }
  .reason .meta { color: var(--muted); }
  a { color: var(--blue); text-decoration: none; } a:hover { text-decoration: underline; }
  details { border-bottom: 1px solid var(--border); }
  details:last-child { border-bottom: none; }
  summary { cursor: pointer; padding: 12px 18px; display: flex; align-items: center; gap: 12px;
    font-size: 13px; list-style: none; }
  summary::-webkit-details-marker { display: none; }
  summary .bar { display: flex; height: 8px; border-radius: 4px; overflow: hidden; width: 160px; background: #eceff3; }
  summary .bar i { display: block; height: 100%; }
  summary .bar .p { background: var(--green); } summary .bar .f { background: var(--red); }
  summary .time { color: var(--muted); width: 150px; }
  summary .rate { color: var(--muted); font-size: 12px; width: 90px; }
  .runcases { padding: 0 18px 14px 40px; }
  .runcases table { border: 1px solid var(--border); border-radius: 8px; overflow: hidden; }
  .runcases th, .runcases td { padding: 8px 12px; }
  .empty { color: var(--muted); font-size: 12px; padding: 12px 18px; }
</style>
</head>
<body>
<div class="wrap">
  <h1>小游戏冒烟测试汇总</h1>
  <div class="sub" id="sub"></div>
  <div class="hero" id="hero"></div>
  <div class="card">
    <h2>本次用例</h2>
    <div id="latestCases"></div>
  </div>
  <div class="card">
    <h2>历史运行</h2>
    <div id="history"></div>
  </div>
</div>
<script>
const DATA = ${JSON.stringify(data).replace(/</g, '\\u003c')};

function fmtDur(ms) {
  if (ms == null) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return s + 's';
  const m = Math.floor(s / 60), r = s % 60;
  return r ? (m + 'm ' + r + 's') : (m + 'm');
}
function fmtTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) +
    ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
}
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function statusDot(st) {
  const cls = st === 'success' ? 'ok' : (st === 'failed' ? 'bad' : 'skip');
  return '<span class="dot ' + cls + '"></span>';
}
function caseRows(run) {
  if (!run.cases.length) return '<div class="empty">无用例数据</div>';
  let rows = '';
  for (const c of run.cases) {
    const ok = c.status === 'success';
    let reason = '';
    if (!ok && c.failedStep) {
      reason = '<div class="reason"><span class="meta">失败于 ' +
        esc(c.failedStep.node) + ' #' + (c.failedStep.stepIndex + 1) + '：</span>' +
        esc(c.failedStep.message) + '</div>';
    }
    rows += '<tr>' +
      '<td>' + statusDot(c.status) + (ok ? '通过' : (c.status === 'failed' ? '失败' : '未运行')) + '</td>' +
      '<td>' + esc(c.name) + '<div class="sub" style="margin:0">' + esc(c.sourcePath) + '</div>' + reason + '</td>' +
      '<td>' + (c.steps || '—') + ' 步</td>' +
      '<td>' + fmtDur(c.durationMs) + '</td>' +
      '</tr>';
  }
  return '<table><thead><tr><th>结果</th><th>用例</th><th>步骤数</th><th>耗时</th></tr></thead><tbody>' + rows + '</tbody></table>';
}
function historyRow(run, idx) {
  const total = Math.max(run.total, 1);
  const p = Math.round((run.passed / total) * 100);
  const f = 100 - p;
  let casesHtml = caseRows(run);
  if (run.reportUrl) {
    casesHtml += '<div class="empty">官方报告：<a href="' + esc(run.reportUrl) + '" target="_blank">打开逐帧回放 →</a></div>';
  }
  return '<details>' + 
    '<summary>' +
      '<span class="time">' + fmtTime(run.startedAt) + '</span>' +
      '<span class="bar"><i class="p" style="width:' + p + '%"></i><i class="f" style="width:' + f + '%"></i></span>' +
      '<span>' + run.passed + '/' + run.total + '</span>' +
      '<span class="rate">通过率 ' + Math.round(run.passRate * 100) + '%</span>' +
      '<span class="time">耗时 ' + fmtDur(run.durationMs) + '</span>' +
      (run.failed ? '<span class="badge bad">' + run.failed + ' 失败</span>' : '<span class="badge ok">全绿</span>') +
    '</summary>' +
    '<div class="runcases">' + casesHtml + '</div>' +
  '</details>';
}

const latest = DATA.runs[0];
document.getElementById('sub').textContent =
  '数据生成于 ' + fmtTime(DATA.generatedAt) + ' · 共 ' + DATA.runs.length + ' 次运行记录';

const allOk = latest.failed === 0 && latest.notRun === 0;
document.getElementById('hero').innerHTML =
  '<div class="metric"><span class="k">最近运行</span><span class="v">' + fmtTime(latest.startedAt) + '</span></div>' +
  '<div class="metric"><span class="k">通过 / 总数</span><span class="big ' + (allOk ? 'pass' : 'fail') + '">' +
    latest.passed + ' / ' + latest.total + '</span></div>' +
  '<div class="metric"><span class="k">通过率</span><span class="v">' + Math.round(latest.passRate * 100) + '%</span></div>' +
  '<div class="metric"><span class="k">总耗时</span><span class="v">' + fmtDur(latest.durationMs) + '</span></div>' +
  '<div class="metric"><span class="k">状态</span><span class="v">' +
    (allOk ? '<span class="badge ok">全部通过</span>' : '<span class="badge bad">有失败</span>') + '</span></div>';

document.getElementById('latestCases').innerHTML = caseRows(latest);
document.getElementById('history').innerHTML = DATA.runs.map(historyRow).join('');
</script>
</body>
</html>`;

const outPath = join(projectRoot, 'dashboard.html');
writeFileSync(outPath, html, 'utf8');
console.log('已生成: ' + outPath);
console.log('运行记录: ' + runs.length + ' 次; 最近一次: ' +
  fmtDuration(runs[0].durationMs) + ' / ' + runs[0].passed + '/' + runs[0].total + ' 通过');

if (process.argv.includes('--open')) {
  exec('start "" "' + outPath + '"');
}