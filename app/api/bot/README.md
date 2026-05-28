# Bot API

Read-only endpoints for the Xocks standup bot. All endpoints require API key auth.

## Auth

Set `BOT_API_KEY` in your environment. Bot sends:

```
Authorization: Bearer <BOT_API_KEY>
```

All endpoints return 401 if missing or wrong. 500 if `BOT_API_KEY` is not configured.

## Endpoints

### `GET /api/bot/sales-summary`

Aggregated sales for a date range, grouped by dimension.

Query params:
- `from` (YYYY-MM-DD) — defaults to 30 days ago
- `to` (YYYY-MM-DD) — defaults to today
- `groupBy` — `store` | `sku` | `store_type` | `state` (default `store`)

### `GET /api/bot/store-performance/[storeId]`

Single-store deep dive: 30/60/90-day sales trend, top SKUs, inventory health, restock cadence.

### `GET /api/bot/restock-needed`

Every SKU currently at or below threshold across all active stores. Grouped by urgency (critical / high / medium).

### `GET /api/bot/store-patterns`

Surfaces which SKUs sell in which store types, which states prefer what. Used for cross-store pattern questions.

Query params:
- `days` — lookback window (default 90, min 7, max 365)

### `GET /api/bot/commission-overview`

Commission periods grouped by status. Includes outstanding (pending + approved) per store — what's owed to whom.

Query params:
- `status` — filter to a single status (`pending`, `approved`, `paid`, `disputed`)

### `GET /api/bot/shipping-efficiency`

Per active store: restock frequency vs revenue. Flags `shipping_drag` (many restocks, low revenue per restock) and `dead_stock` (received stock, no sales).

Query params:
- `days` — lookback window (default 180, min 30, max 365)

## Adding new endpoints

1. Create `app/api/bot/<name>/route.ts`
2. Start with `verifyBotAuth(request)` — bail with `auth.response` if not ok
3. Use `createAdminClient()` to bypass RLS
4. Return JSON shaped for AI consumption (aggregates + labels, not raw rows)
