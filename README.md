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
- `1.3×` — pace ratio: consumed credit percentage divided by consumed period percentage. Green when ≤ 0.95, yellow when ≤ 1.05, red when > 1.05
- `[cal]` or `[wkd]` — whether calendar days or weekdays are being used

The setting is persisted in `~/.pi/agent/codex-usage.json`. Calendar
days are used by default. Change it with `d` in the usage dashboard.

Pi sorts footer statuses by key; `00-codex-usage` ensures this appears first.

## `/usage` dashboard

Opens immediately and loads the active chart grouping lazily from the ChatGPT
workspace-user endpoint. The extension fetches 365 days of history at startup,
and the dashboard shows that cached data while refreshing. Daily and weekly data
is cached in the background, with chart controls acting as client-side period
lenses. Press `r` while it is open to reload monthly usage and all chart data.

### Day modes

Historical usage and averages always use calendar days. Budget targets are
spread across the full billing period, and the mode changes which days count
for the target and remaining-time forecast:

- **Calendar** — include every calendar day in the budget target.
- **Weekdays** — include weekdays in the budget target; weekend time is excluded
  from the countdown and target.

When no weekends remain before reset, both modes produce the same remaining-time
forecast; the budget target still follows the selected full-period day count.

Use `d` in the dashboard to switch modes. The dashboard remains open while the
setting is saved.

### Summary rows

| Row | Content |
|-----|---------|
| Monthly | `used / limit (%) · % left` |
| Period | Reset date · remaining time (`14d`, `1d 5h`, or `12:34`) · budget/day (or absolute credits under a day) |
| Forecast | Projected credits under/over budget · early runout warning when over budget |

The footer pace is the consumed credit percentage divided by the consumed
percentage of the effective period. Elapsed time remains calendar-based;
weekdays mode shortens the remaining period by excluding future weekends.

### Session estimate

The dashboard has separate **Account** and **Session** tabs. The Account tab
shows the monthly account usage. The Session tab shows the full session estimate,
including the total, reply count, model summary, and a model table with input,
cached-input, output, total credits, reply counts, and Priority counts. It also
reports session compactions.
The Session tab defaults to the whole session; press `c` to switch between the
whole session and active branch. Press `s` to sort the model table by Total or
Replies, and `u` to switch the table between Credits and Tokens. The current
sort and display are shown above the table. Session credit totals are approximate
and shown with a `~` prefix.

The estimate uses only `openai-codex` assistant responses and converts each
response's uncached input, cached input, and output tokens with the Codex rate
card. A response is charged to the model that generated it, so context resent
after a model switch is charged to the new model.

Priority responses use the model-specific multiplier: 2.5× for GPT-5.6 and
GPT-5.5, and 2× for GPT-5.4. Cache writes are free and ignored. The estimate
reads the requested tier from `codex-service-tier` diagnostics. Responses from
other providers are excluded; models without a rate card remain in the table
without estimated credit values.

### Chart

7 fixed data rows, scrollable with `j`/`k` or `↑`/`↓`. The chart header shows the
selected grouping and unit, for example `day   credits` or `week  tokens`. The
selected value is shown in a fixed-width column between the date and bar; the
column accommodates values up to `999.99k` before compacting to `1m`. In credits
mode, a `cum Δ` column shows cumulative actual usage minus cumulative budget in
daily view. In weekly view, it shows the week's actual usage minus the week's
budget; a week crossing a billing boundary includes both periods. The first
billing period is shown as `N/A` when the fetched range starts mid-period.
Muted `cum budget` and `cum usage` columns show the corresponding target and
usage used for debugging. Historical values assume the current monthly limit
was unchanged because the API does not expose historical limits. The positive
variance controls the over-budget section of each bar; its label shows the same
positive amount. Negative values are under budget and positive values are over
budget; the column is hidden in token mode or when the terminal is too narrow to
preserve a useful bar. Over-budget sections are colored red; daily budget
markers are not rendered in the chart.

Two views are cycled with `v`:

| View | Bars |
|------|------|
| Usage | Bars scaled to the selected unit |
| Models | Model-colored bars scaled to the selected unit |

Press `u` to cycle chart units: credits or absolute token counts. The credit
cumulative variance and over-budget coloring are shown in credits mode. In
Models view, the legend shows each model's selected
numeric total; the chart header identifies its unit. Zero-credit models are omitted
from the legend.

### Controls (single key to cycle)

| Key | Cycles through |
|-----|---------------|
| `d` | Calendar days · Weekdays |
| `v` | Usage · Models |
| `u` | Account tab: Credits · Tokens; Session tab: Credits · Tokens |
| `p` | Current · 7d · 30d · 90d · 180d · 365d |
| `g` | Daily · Weekly |
| `s` | Account tab: Newest-first · Oldest-first · Usage; Session tab: Total · Replies |
| `j`/`k` or `↑`/`↓` | Scroll chart or session table one row |
| `r` | Reload monthly usage and all chart data |
| `Tab` | Switch Account · Session |
| `c` | Switch active branch · whole session (Session tab) |
| `q`/`Esc` | Close |

## Install

```bash
pi install git:github.com/<you>/pi-codex-usage
```

Then run `/reload` in Pi.
