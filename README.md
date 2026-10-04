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

Shown when an `openai-codex` model is selected:

```
65%/8k 1.30× [cal] ~42 cr
```

- `65%/8k` — monthly credits used versus the limit
- `1.30×` — credit usage relative to elapsed time in the billing period
  (here, 65% used at 50% elapsed). Pace is green at or below `1×`, yellow above
  `1×` through `1.05×`, and red above `1.05×` (using the displayed ratio).
- `[cal]` or `[wkd]` — calendar-day or weekday budgeting; switch with `d` in
  `/usage`
- `~42 cr` — estimated credits used in this session, shown when available

Press `m` in either `/usage` tab to cycle **budget mode** for the footer and the
chart's cumulative comparison column. The dashboard hint reads `m budget mode`,
and selecting a mode shows a brief explanation:

| Mode | Example at 65% used and 50% elapsed | Meaning |
|------|-----------------------------------|---------|
| Pace | `1.30×` | Usage percentage divided by elapsed-period percentage |
| PP | `+15.0 pp` | Usage percentage minus elapsed-period percentage |
| Credits | `Δ+1.2k cr` | Credits used minus expected credits (8k limit) |

Pace is the default. The selected `displayMode` (`pace`, `pp`, or `credits`)
and `dayPolicy` are saved together in `codex-usage.json` in Pi's agent directory
(default: `~/.pi/agent/codex-usage.json`). Older config files retain their day
policy and default to pace. The footer and chart comparison column use static
pace thresholds: green at or below `1×`, yellow above `1×` through `1.05×`, and
red above `1.05×`, based on the ratio rounded to two decimals. PP and credits
use deviation rounded to one decimal place:
green at or below 0 pp, yellow above 0 through +5 pp, and red above +5 pp.
Switching between pace and deviation modes can change the color because they
measure different things. Forecast colors are unchanged.

Monthly usage refreshes every five minutes; session credits update as the
session changes.

## `/usage` dashboard

Opens immediately and loads the active chart grouping lazily from the ChatGPT
workspace-user endpoint. The extension fetches 365 days of history at startup,
and the dashboard shows that cached data while refreshing. Daily and weekly data
is cached in the background, with chart controls acting as client-side period
lenses. Press `r` while it is open to reload monthly usage and all chart data.

### Day modes

Historical usage remains grouped by calendar dates. Budget targets are spread
across the full billing period, while pace, budget deviation, and forecasts use
policy-specific elapsed and remaining time:

- **Calendar** — include every calendar day in the budget target.
- **Weekdays** — include weekdays in the budget target; weekend time is excluded
  from the countdown and target.

When no weekends remain before reset, both modes show the same countdown.
Pace, budget deviation, and forecasts can still differ because weekdays mode
also excludes past weekends from elapsed time; the budget target follows the
selected full-period day count.

Use `d` in the dashboard to switch modes. The dashboard remains open while the
setting is saved.

### Summary rows

| Row | Content |
|-----|---------|
| Monthly | `used / limit (%) · % left` |
| Period | Reset date · remaining time (`14d`, `1d 5h`, or `12:34`) · budget/day (or absolute credits under a day) |
| Forecast | Projected credits under/over budget · early runout warning when over budget |

In credits mode, the footer budget deviation is credits used minus the total
credit budget multiplied by the elapsed fraction of the effective period. It is
rounded to whole credits and shown with compact units. Each additional credit
used moves it by +1 credit, regardless of period progress. Calendar mode includes
every day; weekdays mode excludes weekends from both elapsed and remaining time.
Forecasts remain based on the average credit usage rate over elapsed policy
time.

This is the same concept as the chart's `Σ Δ cr`, but the footer uses the monthly
usage snapshot and budget through the current moment; chart values use analytics
and budget through the displayed day/week. The values need not match exactly.

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
response's uncached input, cached input, and output tokens with the [Codex rate
card](https://help.openai.com/en/articles/11481834-chatgpt-rate-card-business-enterpriseedu-credit-based-pricing#chatgpt-work-and-codex). A response is charged to the model that generated it, so context resent
after a model switch is charged to the new model.

Fast (priority) responses use the model-specific multiplier: 2.5× for GPT-6,
GPT-5.6, and GPT-5.5, and 2× for GPT-5.4. Cache writes are free and ignored. The estimate
reads the requested tier from `codex-service-tier` diagnostics. Responses from
other providers are excluded; models without a rate card remain in the table
without estimated credit values.

### Chart

The chart shows credit usage by day or week, with compact values alongside each
bar. It shows up to 10 rows; use `j`/`k` or `↑`/`↓` to scroll one row, or `Space`/`f`/`b` to page forward/back.

**Views.** Press `v` to switch between Usage and Models. Both views scale their
bars to observed credit usage. Models uses model-colored bars, and its legend
lists models from highest to lowest total credits; zero-credit models are
omitted.

**Cumulative columns.** Budget mode (`m`) controls the comparison column:

- `Σ pace` — cumulative usage divided by cumulative expected budget (`1.10`).
- `Σ Δ pp` — cumulative usage minus expected budget, as percentage points of
  the period's credit limit (`+5.0`).
- `Σ Δ cr` — cumulative usage minus expected budget in credits (`+400`).

Chart row values omit `×` and `pp`; the comparison header identifies the mode.
The footer still includes these units. Comparison cells use the same
mode-specific color rules as the footer, calculated separately for each row's
checkpoint.

Daily checkpoints include the full displayed day; weekly checkpoints use daily
accounting through the displayed week, capped at the available data. A week
crossing a billing boundary combines both periods; pp uses their combined full
credit limits. Incomplete first periods show `N/A`, as does pace when no budget
has elapsed. Bars and their credit labels do not change with budget mode.

The muted `Σ budget` and `Σ usage` columns remain in credits. The chart starts
with only the comparison column; press `c` to cycle through comparison plus
`Σ usage`, all three columns, off, and comparison only.

Historical values use the current monthly limit because the API does not expose
past limits. In Usage view, positive cumulative variance controls the red
over-budget section and its label; negative values are under budget. Budget
targets do not affect bar scaling, and daily budget markers are not shown.

### Controls (single key to cycle)

| Key | Cycles through |
|-----|---------------|
| `d` | Calendar days · Weekdays |
| `m` | Budget mode: Pace · PP · Credits delta for footer and chart (either tab) |
| `v` | Usage · Models |
| `u` | Session tab: Credits · Tokens |
| `p` | Current · 365d |
| `g` | Daily · Weekly |
| `s` | Account tab: Newest-first · Oldest-first · Usage; Session tab: Total · Replies |
| `j`/`k` or `↑`/`↓` | Scroll chart or session table one row |
| `Space`/`f` | Page forward; `b` pages back |
| `r` | Reload monthly usage and all chart data |
| `Tab` | Switch Account · Session |
| `c` | Account tab: Off · Comparison · Comparison + `Σ usage` · All; Session tab: Active branch · whole session |
| `q`/`Esc` | Close |

## Code layout

- `index.ts` wires Pi events, the status bar, and the `/usage` command together.
- `src/status-bar/` owns status segments and the refresh shimmer.
- `src/dashboard/` owns the modal and refresh coordination; `account/` and
  `session/` contain their respective tab implementations and charts, while
  `ui/` holds helpers used across dashboard tabs.
- `src/usage-command/` handles `/usage` outside the dashboard.
- `src/shared/usage/` holds fetching, analytics, and credit calculations used by
  multiple features. Configuration, formatting, and the provider ID live in
  `src/shared/`.
- Tests live beside the code they cover.

## Install

```bash
pi install git:github.com/<you>/pi-codex-usage
```

Then run `/reload` in Pi.
