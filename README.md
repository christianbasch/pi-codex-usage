# codex-usage

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

Pi sorts footer statuses by key; `00-codex-usage` ensures this appears first.

## `/usage` dashboard

Opens immediately and loads analytics lazily from the ChatGPT workspace-user
endpoint.

### Summary rows

| Row | Content |
|-----|---------|
| Monthly | `used / limit (%) · % left` |
| Daily avg | `avg/day vs budget/day (%)` |
| Period | Reset date · days left |
| Pace | `ratio× · projected ±overage · credits out in N days` |

Pace stats use the actual calendar-month period length, not a fixed 30 days.

### Chart

7 fixed rows, scrollable with `j`/`k`. Three views cycled with `v`:

| View | Bars |
|------|------|
| Usage | Plain credit bars |
| Tokens | Stacked input / cached / output (Okabe–Ito palette) |
| Models | Stacked per-model credits |

### Controls (single key to cycle)

| Key | Cycles through |
|-----|---------------|
| `v` | Usage · Tokens · Models |
| `p` | Week · 30d · Period (current billing period) |
| `g` | Daily · Weekly |
| `s` | Newest-first · Oldest-first |
| `j`/`k` | Scroll chart one period |
| `q`/`Esc` | Close |

## Install in this dotfiles repo

```bash
cd ~/.dotfiles
./restow.sh -v
```

Then run `/reload` in Pi.
