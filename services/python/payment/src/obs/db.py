"""A tiny asyncpg connection-pool helper shared by the data-owning services.

asyncpg is instrumented (see obs.otel), so every query issued through a pool
created here shows up as its own span under the current trace — no per-query
tracing code in the services.
"""
from __future__ import annotations

import os

import asyncpg

_POOL: asyncpg.Pool | None = None


async def get_pool() -> asyncpg.Pool:
    """Create (once) and return the process-wide pool. DATABASE_URL is the
    standard postgres:// DSN, e.g. postgres://appuser:apppass@postgres:5432/appdb."""
    global _POOL
    if _POOL is None:
        dsn = os.environ["DATABASE_URL"]
        _POOL = await asyncpg.create_pool(dsn, min_size=1, max_size=10)
    return _POOL


async def close_pool() -> None:
    global _POOL
    if _POOL is not None:
        await _POOL.close()
        _POOL = None
