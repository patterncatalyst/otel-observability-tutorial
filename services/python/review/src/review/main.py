"""Review service — the GraphQL read/write edge over the `reviews` table.

Mirrors services/spring/review/ReviewController: Query.reviews(sku) lists
reviews (optionally filtered by sku), Query.review(id) fetches one by its
database review_id, and Mutation.addReview(sku, rating, body) inserts a new
row. The HTTP layer is instrumented (it's FastAPI under the hood), and each
resolver opens a custom span so the trace shows the resolver tree, not just
one opaque POST /graphql.
"""
from __future__ import annotations

import logging
import uuid
from contextlib import asynccontextmanager
from typing import List, Optional

import strawberry
from fastapi import FastAPI
from strawberry.fastapi import GraphQLRouter

from obs import db, logging as obslog, otel

log = logging.getLogger("review")

SELECT_FIELDS = "review_id, sku, rating, body"


@strawberry.type
class Review:
    id: strawberry.ID
    sku: str
    rating: int
    body: str


def _row_to_review(row) -> Review:
    return Review(id=strawberry.ID(row["review_id"]), sku=row["sku"], rating=row["rating"], body=row["body"])


@strawberry.type
class Query:
    @strawberry.field
    async def reviews(self, sku: Optional[str] = None) -> List[Review]:
        with otel.tracer().start_as_current_span("review.resolve_reviews"):
            pool = await db.get_pool()
            if sku:
                rows = await pool.fetch(f"SELECT {SELECT_FIELDS} FROM reviews WHERE sku = $1", sku)
            else:
                rows = await pool.fetch(f"SELECT {SELECT_FIELDS} FROM reviews")
            return [_row_to_review(r) for r in rows]

    @strawberry.field
    async def review(self, id: strawberry.ID) -> Optional[Review]:
        with otel.tracer().start_as_current_span("review.resolve_review"):
            pool = await db.get_pool()
            row = await pool.fetchrow(f"SELECT {SELECT_FIELDS} FROM reviews WHERE review_id = $1", str(id))
            return _row_to_review(row) if row else None


@strawberry.type
class Mutation:
    @strawberry.mutation
    async def add_review(self, sku: str, rating: int, body: str) -> Review:
        with otel.tracer().start_as_current_span("review.add_review"):
            review_id = str(uuid.uuid4())
            pool = await db.get_pool()
            await pool.execute(
                "INSERT INTO reviews (review_id, sku, rating, body) VALUES ($1, $2, $3, $4)",
                review_id, sku, rating, body,
            )
            log.info("review added id=%s sku=%s", review_id, sku)
            return Review(id=strawberry.ID(review_id), sku=sku, rating=rating, body=body)


schema = strawberry.Schema(query=Query, mutation=Mutation)


@asynccontextmanager
async def lifespan(app: FastAPI):
    obslog.configure()
    otel.setup("review")
    otel.instrument_fastapi(app)
    log.info("review GraphQL service started")
    yield
    await db.close_pool()


app = FastAPI(title="review", lifespan=lifespan)
app.include_router(GraphQLRouter(schema), prefix="/graphql")


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


def main() -> None:
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8081)


if __name__ == "__main__":
    main()
