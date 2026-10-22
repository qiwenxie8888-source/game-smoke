r"""清理 Midscene 运行产物（按 runId 整次删除 + 清理散落报告）。

磁盘上有三类产物：
  A. .midscene/test-results/<runId>/            一次运行的机器产物（几 MB）
  B. midscene_run/report/midscene-e2e-<runId>/  一次运行的自包含 HTML 报告（含自己的 screenshots/）
  C. midscene_run/report/android-*.html(.json)  每次 AI 调用写的中间报告
     midscene_run/report/screenshots/           给 C 类用的共享图片池

规则（按顺序，先命中先决）：
  1. 最新一次运行永远保留
  2. --min-age-hours 内的运行不删（默认 24 小时）
  3. 状态 failed：默认全留，可用 --keep-failed N 只留最近 N 次
  4. 状态 success：保留最近 --keep-passed N 次（默认 3）
  5. 状态解析不出来的：保留
  C 类只在加 --purge-loose 时清理：内容已被 e2e 报告完整覆盖，可整批删除；
  共享截图按"是否仍被保留的报告引用"判定，没人引用才删。

安全：
  - 默认 dry-run，只打印清单和预计回收空间
  - 真删必须加 --yes
  - 只认匹配 ^\d{14}-[0-9a-f]{8}$ 的目录名

用法：
  python server/clean_runs.py                                   # 预览 A/B 类
  python server/clean_runs.py --keep-passed 3 --keep-failed 3     # 预览，更激进
  python server/clean_runs.py --purge-loose                       # 额外预览 C 类
  python server/clean_runs.py --purge-loose --yes                 # 真删
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
RESULT_ROOT = PROJECT_ROOT / ".midscene" / "test-results"
REPORT_ROOT = PROJECT_ROOT / "midscene_run" / "report"
SHARED_SCREENSHOTS = REPORT_ROOT / "screenshots"

RUN_ID = re.compile(r"^\d{14}-[0-9a-f]{8}$")
IMAGE_REF = re.compile(r"screenshots/([A-Za-z0-9._-]+\.(?:jpe?g|png|webp))")


def dir_size(path: Path) -> int:
    total = 0
    for item in path.rglob("*"):
        if item.is_file():
            total += item.stat().st_size
    return total


def human(size: int) -> str:
    value = float(size)
    for unit in ("B", "KB", "MB", "GB"):
        if value < 1024 or unit == "GB":
            return f"{value:.1f} {unit}"
        value /= 1024
    return f"{value:.1f} GB"


def load_runs() -> list[dict]:
    runs: list[dict] = []
    if not RESULT_ROOT.exists():
        return runs
    for run_dir in sorted(RESULT_ROOT.iterdir()):
        if not run_dir.is_dir() or not RUN_ID.match(run_dir.name):
            continue
        status = None
        started_at = None
        summary_file = run_dir / "summary.json"
        if summary_file.exists():
            try:
                summary = json.loads(summary_file.read_text(encoding="utf-8"))
                status = summary.get("status")
                started_at = summary.get("startedAt")
            except Exception:
                status = None
        runs.append(
            {
                "run_id": run_dir.name,
                "status": status,
                "started_at": started_at,
                "result_dir": run_dir,
                "report_dir": REPORT_ROOT / f"midscene-e2e-{run_dir.name}",
            }
        )
    # run_id 前缀是 14 位时间戳，字典序即时间序；startedAt 可能缺失，不能用来排序
    runs.sort(key=lambda r: r["run_id"])
    return runs


def decide(
    runs: list[dict], keep_passed: int, keep_failed: int | None, min_age_hours: int
) -> tuple[list[dict], list[dict]]:
    """返回 (要删的, 要留的)，按时间从新到旧判断。"""
    ordered = list(reversed(runs))
    cutoff = datetime.now(timezone.utc) - timedelta(hours=min_age_hours)
    seen_passed = 0
    seen_failed = 0
    delete: list[dict] = []
    keep: list[dict] = []

    for index, run in enumerate(ordered):
        status = run["status"]
        reason = None

        if index == 0:
            reason = "最新一次运行，保留"
        elif status is None:
            reason = "状态无法解析，保留"
        elif status == "success":
            seen_passed += 1
            if seen_passed > keep_passed:
                run_time = _parse_time(run["started_at"])
                if run_time and run_time > cutoff:
                    reason = f"{min_age_hours} 小时内的运行，保留"
            else:
                reason = f"最近 {keep_passed} 次成功，保留"
        elif status == "failed":
            seen_failed += 1
            if keep_failed is None:
                reason = "失败运行默认全留"
            elif seen_failed <= keep_failed:
                reason = f"最近 {keep_failed} 次失败，保留"
            else:
                run_time = _parse_time(run["started_at"])
                if run_time and run_time > cutoff:
                    reason = f"{min_age_hours} 小时内的运行，保留"
        else:
            reason = f"未知状态 {status}，保留"

        (keep if reason else delete).append({**run, "reason": reason})
    return delete, keep


def _parse_time(value: str | None):
    if not value:
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def loose_report_files() -> list[Path]:
    """C 类：每次 AI 调用的中间报告，内容已被 e2e 报告覆盖，可整批删除。"""
    if not REPORT_ROOT.exists():
        return []
    files: list[Path] = []
    for item in REPORT_ROOT.iterdir():
        if not item.is_file() or not item.name.startswith("android-"):
            continue
        if item.suffix == ".html" or item.name.endswith(".json"):
            files.append(item)
    return files


def unresolved_screenshots(exclude: set[Path] | None = None) -> set[str]:
    """找出"在自己所在目录下找不到、需要共享图片池兜底"的截图名。

    报告里写的是 ./screenshots/<name>，相对报告 html 所在目录解析。
    e2e 报告各自带 screenshots/ 子目录，所以正常情况下都不需要共享池。
    """
    exclude = exclude or set()
    unresolved: set[str] = set()
    if not REPORT_ROOT.exists():
        return unresolved
    for html in REPORT_ROOT.rglob("*.html"):
        if html in exclude:
            continue
        try:
            text = html.read_text(encoding="utf-8", errors="ignore")
        except OSError:
            continue
        for name in IMAGE_REF.findall(text):
            if not (html.parent / "screenshots" / name).exists():
                unresolved.add(name)
    return unresolved


def orphan_images(exclude: set[Path] | None = None) -> list[Path]:
    """共享截图池里没有任何保留报告需要的图片。"""
    if not SHARED_SCREENSHOTS.exists():
        return []
    needed = unresolved_screenshots(exclude)
    return [
        image
        for image in SHARED_SCREENSHOTS.iterdir()
        if image.is_file() and image.name not in needed
    ]


def main() -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    parser = argparse.ArgumentParser(description="清理 Midscene 运行产物")
    parser.add_argument("--keep-passed", type=int, default=3, help="保留最近 N 次成功运行（默认 3）")
    parser.add_argument("--keep-failed", type=int, default=None, help="保留最近 N 次失败运行（默认不限）")
    parser.add_argument("--min-age-hours", type=int, default=24, help="小于该小时数的运行一律保留（默认 24）")
    parser.add_argument("--purge-loose", action="store_true", help="额外清理散落报告与无引用截图")
    parser.add_argument("--yes", action="store_true", help="真正执行删除（默认只预览）")
    args = parser.parse_args()

    runs = load_runs()
    if not runs:
        print(f"没有找到运行产物：{RESULT_ROOT}")
        return 0

    delete, keep = decide(runs, args.keep_passed, args.keep_failed, args.min_age_hours)

    print(f"共 {len(runs)} 次运行；将删除 {len(delete)} 次，保留 {len(keep)} 次")
    print("")

    reclaimed = 0
    for run in delete:
        size = dir_size(run["result_dir"])
        if run["report_dir"].exists():
            size += dir_size(run["report_dir"])
        reclaimed += size
        print(f"  删除 {run['run_id']}  status={run['status']}  {human(size)}  ({run['reason']})")

    if delete:
        print("")
    print("保留的运行：")
    for run in keep:
        print(f"  保留 {run['run_id']}  status={run['status']}  ({run['reason']})")

    loose_files: list[Path] = []
    orphans: list[Path] = []
    if args.purge_loose:
        loose_files = loose_report_files()
        orphans = orphan_images(set(loose_files))
        loose_size = sum(f.stat().st_size for f in loose_files)
        orphan_size = sum(f.stat().st_size for f in orphans)
        reclaimed += loose_size + orphan_size
        print("")
        print(f"散落报告：{len(loose_files)} 个文件，{human(loose_size)}")
        print(f"无引用共享截图：{len(orphans)} 张，{human(orphan_size)}")

    print("")
    print(f"预计回收：{human(reclaimed)}")

    if not args.yes:
        print("")
        print("以上为预览。确认无误后加 --yes 执行删除。")
        return 0

    for run in delete:
        shutil.rmtree(run["result_dir"], ignore_errors=True)
        if run["report_dir"].exists():
            shutil.rmtree(run["report_dir"], ignore_errors=True)
    for file in loose_files:
        try:
            file.unlink()
        except OSError:
            pass
    for image in orphans:
        try:
            image.unlink()
        except OSError:
            pass

    print("")
    print(f"已删除 {len(delete)} 次运行、{len(loose_files)} 个散落文件、{len(orphans)} 张截图")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
