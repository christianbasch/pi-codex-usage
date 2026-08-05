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

### Chart

7 fixed rows, scrollable with `j`/`k`. Two views cycled with `v`:

| View | Bars |
|------|------|
| Usage | Plain credit bars |
| Models | Stacked per-model credits |

### Controls (single key to cycle)

| Key | Cycles through |
|-----|---------------|
| `d` | Calendar days · Weekdays |
| `v` | Usage · Models |
| `p` | Week · 30d · Period (current billing period) |
| `g` | Daily · Weekly |
| `s` | Newest-first · Oldest-first |
| `j`/`k` | Scroll chart one period |
| `q`/`Esc` | Close |

## Install

```bash
pi install git:github.com/<you>/pi-codex-usage@v1.0.0
```

Then run `/reload` in Pi.
