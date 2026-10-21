"""只读 API：把 smoke.db 里的运行结果暴露成 HTTP 接口。

启动（在项目根目录执行）：
  .venv/Scripts/python -m uvicorn server.api:app --reload --port 8000

接口：
  GET /                    接口清单
  GET /api/health          库是否可用 + 数据量
  GET /api/runs            运行历史（可按 game / suite / status 过滤）
  GET /api/runs/{run_id}   单次运行明细（含用例列表与报告链接）
  GET /api/games           游戏清单 + 各自最近一次运行
  GET /api/stats           按天统计的通过情况
  GET /reports/...         Midscene 原生 HTML 报告（静态挂载）

本层只读：不改库、不跑测试、不调模型。
"""
from __future__ import annotations

import sqlite3
from datetime import date, timedelta
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "server" / "data" / "smoke.db"
REPORT_ROOT = (PROJECT_ROOT / "midscene_run" / "report").resolve()

app = FastAPI(title="game-smoke API", version="0.1.0")


def connect() -> sqlite3.Connection:
    """每次请求开一个只读连接，避免多线程共享连接的问题。"""
    if not DB_PATH.exists():
        raise HTTPException(
            status_code=503,
            detail=f"数据库不存在：{DB_PATH}；请先运行 python server/ingest.py",
        )
    conn = sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def to_list(rows) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]


def report_url(report_file: str | None) -> str | None:
    """把库里的绝对路径映射成 /reports/... 的 URL；不在报告目录下则返回 None。"""
    if not report_file:
        return None
    try:
        relative = Path(report_file).resolve().relative_to(REPORT_ROOT)
    except (ValueError, OSError):
        return None
    return "/reports/" + relative.as_posix()


WEB_ROOT = (Path(__file__).resolve().parent / "web").resolve()


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(WEB_ROOT / "index.html")


@app.get("/api")
def api_index() -> dict[str, Any]:
    return {
        "name": "game-smoke API",
        "docs": "/docs",
        "endpoints": [
            "/api/health",
            "/api/runs?game=&suite=&status=&limit=50",
            "/api/runs/{run_id}",
            "/api/games",
            "/api/stats?game=&days=30",
            "/reports/...",
        ],
    }


@app.get("/api/health")
def health() -> dict[str, Any]:
    conn = connect()
    try:
        runs = conn.execute("SELECT count(*) FROM runs").fetchone()[0]
        cases = conn.execute("SELECT count(*) FROM cases").fetchone()[0]
    finally:
        conn.close()
    return {
        "ok": True,
        "db": str(DB_PATH),
        "runs": runs,
        "cases": cases,
        "report_root": str(REPORT_ROOT),
        "report_root_exists": REPORT_ROOT.exists(),
    }


@app.get("/api/runs")
def list_runs(
    game: str | None = Query(None, description="游戏 key，如 douyin/edge-space"),
    suite: str | None = Query(None, description="用例集：smoke / explore"),
    status: str | None = Query(None, description="success / failed"),
    limit: int = Query(50, ge=1, le=500),
    offset: int = Query(0, ge=0),
) -> dict[str, Any]:
    where = ["1 = 1"]
    params: dict[str, Any] = {}

    if game:
        where.append(
            "EXISTS (SELECT 1 FROM cases c "
            "WHERE c.run_id = r.run_id AND c.game_key = :game)"
        )
        params["game"] = game
    if suite:
        where.append("',' || coalesce(r.suites, '') || ',' LIKE :suite")
        params["suite"] = f"%,{suite},%"
    if status:
        where.append("r.status = :status")
        params["status"] = status

    condition = ' AND '.join(where)
    sql = f"""
        SELECT * FROM runs r
        WHERE {condition}
        ORDER BY r.started_at DESC
        LIMIT :limit OFFSET :offset
    """
    count_sql = f"SELECT count(*) FROM runs r WHERE {condition}"
    page_params = {**params, 'limit': limit, 'offset': offset}

    conn = connect()
    try:
        items = to_list(conn.execute(sql, page_params))
        # total 与过滤条件保持同一口径，供前端分页使用
        total = conn.execute(count_sql, params).fetchone()[0]
    finally:
        conn.close()

    for item in items:
        item["report_url"] = report_url(item.get("report_file"))
    return {"total": total, "count": len(items), "items": items}


@app.get("/api/runs/{run_id}")
def get_run(run_id: str) -> dict[str, Any]:
    conn = connect()
    try:
        row = conn.execute(
            "SELECT * FROM runs WHERE run_id = ?", (run_id,)
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail=f"run 不存在：{run_id}")
        run = dict(row)
        cases = to_list(
            conn.execute(
                "SELECT id, project, suite, game_key, source_path, case_index, name, status, attempts "
                "FROM cases WHERE run_id = ? ORDER BY case_index, id",
                (run_id,),
            )
        )
    finally:
        conn.close()

    run["report_url"] = report_url(run.get("report_file"))
    run["cases"] = cases
    return run


@app.get("/api/games")
def list_games() -> dict[str, Any]:
    conn = connect()
    try:
        rows = to_list(
            conn.execute(
                """
                SELECT c.game_key,
                       g.display_name,
                       count(*) AS case_rows,
                       sum(CASE WHEN c.status = 'success' THEN 1 ELSE 0 END) AS passed,
                       (
                         SELECT r.run_id FROM runs r
                         JOIN cases c2 ON c2.run_id = r.run_id
                         WHERE c2.game_key = c.game_key
                         ORDER BY r.started_at DESC LIMIT 1
                       ) AS last_run_id
                FROM cases c
                LEFT JOIN games g ON g.game_key = c.game_key
                WHERE c.game_key IS NOT NULL
                GROUP BY c.game_key
                ORDER BY c.game_key
                """
            )
        )
        for game in rows:
            last = game.get("last_run_id")
            game["channel"], _, game_dir = game["game_key"].partition("/")
            game["game_dir"] = game_dir
            # 展示名来自 game.config.ts；读不到就退回目录名
            game["name"] = game.get("display_name") or game_dir
            game["last_run"] = None
            if last:
                run = conn.execute(
                    "SELECT run_id, started_at, status, total, passed, failed FROM runs WHERE run_id = ?",
                    (last,),
                ).fetchone()
                if run:
                    game["last_run"] = dict(run)
            # 展示名：配置里是中文，库里只有目录名，前端可自行映射
    finally:
        conn.close()
    return {"count": len(rows), "items": rows}


@app.get("/api/stats")
def stats(
    game: str | None = Query(None, description="按游戏 key 过滤"),
    days: int = Query(30, ge=1, le=365),
) -> dict[str, Any]:
    since = (date.today() - timedelta(days=days - 1)).isoformat()
    where = ["r.started_at >= :since"]
    params: dict[str, Any] = {"since": since}
    if game:
        where.append(
            "EXISTS (SELECT 1 FROM cases c "
            "WHERE c.run_id = r.run_id AND c.game_key = :game)"
        )
        params["game"] = game

    sql = f"""
        SELECT substr(r.started_at, 1, 10) AS day,
               count(*) AS runs,
               sum(r.passed) AS passed,
               sum(r.failed) AS failed,
               sum(r.not_run) AS not_run,
               cast(avg(r.duration_ms) AS INTEGER) AS avg_duration_ms
        FROM runs r
        WHERE {' AND '.join(where)}
        GROUP BY day
        ORDER BY day
    """

    conn = connect()
    try:
        items = to_list(conn.execute(sql, params))
    finally:
        conn.close()
    return {"days": days, "since": since, "game": game, "items": items}


if REPORT_ROOT.exists():
    app.mount("/reports", StaticFiles(directory=REPORT_ROOT), name="reports")

app.mount("/static", StaticFiles(directory=WEB_ROOT), name="static")
