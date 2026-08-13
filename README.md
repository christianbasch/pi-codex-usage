# pi-codex-usage

Shows monthly OpenAI Codex credit usage in Pi's status bar and an interactive
modal dashboard, using Pi's `openai-codex` OAuth token.

## Setup

Authenticate with Pi's built-in Codex provider:

```text
/login openai-codex
```

The extension resolves Pi's token through Pi's model registry. It never reads
`~/.codex/auth.json` and does not persist or display the access token.

## Status bar

Visible only when an `openai-codex` model is selected. Shows:

```
65%/8k 1.3×
```

- `65%/8k` — monthly credits used vs limit
- `1.3×` — pace ratio; always shown. Green when ≤ 0.95, yellow when ≤ 1.05, red when > 1.05
- `[cal]` or `[wd]` — whether calendar days or weekdays are being used

The setting is persisted in `~/.pi/agent/codex-usage.json`. Calendar
days are used by default. Change it with `d` in the usage dashboard.

Pi sorts footer statuses by key; `00-codex-usage` ensures this appears first.

## `/usage` dashboard

Opens immediately and loads analytics lazily from the ChatGPT workspace-user
endpoint.

### Day modes

Historical usage, averages, and chart budgets always use calendar days. The
mode only changes how the remaining credits are allocated:

- **Calendar** — spread remaining credits across every remaining calendar day.
- **Weekdays** — spread remaining credits across remaining weekdays; remaining
  weekend days are excluded.

When no weekends remain before reset, both modes produce the same budget and
forecast.

Use `d` in the dashboard to switch modes. The dashboard remains open while the
setting is saved.

### Summary rows

| Row | Content |
|-----|---------|
| Monthly | `used / limit (%) · % left` |
| Period | Reset date · remaining days · remaining budget/day |
| Forecast | Projected credits under/over budget · early runout warning when over budget |

The footer pace uses the calendar-day historical average and the selected
mode's remaining daily budget.

### Session estimate

The dashboard also shows an estimated credit total for the active session. It
uses only `openai-codex` assistant responses and converts each response's
uncached input, cached input, and output tokens with the Codex rate card. A
response is charged to the model that generated it, so context resent after a
model switch is charged to the new model.

Priority responses use the model-specific multiplier: 2.5× for GPT-5.6 and
GPT-5.5, and 2× for GPT-5.4. Cache writes are free and ignored. The estimate
reads the requested tier from `codex-service-tier` diagnostics. Responses from
other providers and models without a rate card are excluded; the latter are
shown as unpriced.

### Chart

7 fixed rows, scrollable with `j`/`k`. Two views cycled with `v`:

| View | Bars |
|------|------|
| Usage | Plain credit bars |
| Models | Stacked per-model credit bars |

Press `t` to cycle token annotations: absolute token counts or tokens-per-credit
ratios beside chart credit values. In Models view, the selected annotation also
appears in the model legend. Zero-credit models are omitted from the legend.

### Controls (single key to cycle)

| Key | Cycles through |
|-----|---------------|
| `d` | Calendar days · Weekdays |
| `v` | Usage · Models |
| `t` | Tokens off · counts · ratio |
| `p` | Week · 30d · Period (current billing period) |
| `g` | Daily · Weekly |
| `s` | Newest-first · Oldest-first |
| `j`/`k` | Scroll chart one period |
| `q`/`Esc` | Close |

## Install

```bash
pi install git:github.com/<you>/pi-codex-usage
```

Then run `/reload` in Pi.
