"""Order persistence. Queries go through the shared asyncpg pool, which is
instrumented, so each statement is its own span under the request trace."""
from __future__ import annotations

from obs import db


async def insert_order(
    order_id: str, customer_id: str, sku: str, quantity: int, amount_cents: int, status: str
) -> None:
    pool = await db.get_pool()
    await pool.execute(
        """
        INSERT INTO orders (order_id, customer_id, sku, quantity, amount_cents, status)
        VALUES ($1, $2, $3, $4, $5, $6)
        """,
        order_id, customer_id, sku, quantity, amount_cents, status,
    )


async def get_order(order_id: str) -> dict | None:
    pool = await db.get_pool()
    row = await pool.fetchrow(
        """
        SELECT order_id, customer_id, sku, quantity, amount_cents, status, created_at
        FROM orders WHERE order_id = $1
        """,
        order_id,
    )
    if row is None:
        return None
    return {
        "orderId": row["order_id"],
        "customerId": row["customer_id"],
        "sku": row["sku"],
        "quantity": row["quantity"],
        "amountCents": row["amount_cents"],
        "status": row["status"],
        "createdAt": row["created_at"].isoformat(),
    }
