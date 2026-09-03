# Changelog

## [1.7.0] - 2026-09-03

### Changed

- Add fixed chart headers and value columns for the selected day/week and credits/tokens units.
- Switch Account and Session unit controls from `t` to `u` and show compact numeric model totals in the Models legend.

### Fixed

- Omit the maximum period value from x-axis ticks to prevent log-scale tick overlap.

### Removed

- Remove the tokens-per-credit ratio chart unit; `u` now cycles between credits and tokens.

## [1.6.2] - 2026-09-02

### Fixed

- Align the daily budget marker with the selected calendar/weekdays policy and keep the budget value off the x-axis so the rightmost label is no longer truncated.
- Ignore sub-day jitter in the reported reset time so the weekdays daily budget no longer flips between two values across refreshes.

### Internal

- Share one normalized day-counting helper between the weekday and weekend calculations and remove the unused `periodLengthDays`.

## [1.6.1] - 2026-09-02

### Fixed

- Keep the remaining-time basis current between usage fetches so the daily budget no longer stays frozen and then jumps when usage is reloaded.
- Scope the chart's current period and daily budget markers to the monthly reset, so the previous period is no longer shown when the dashboard opens before the reset time is known.
- Ignore a cached usage snapshot once its reset has passed, so a rolled-over period is not used to render the current one.

## [1.6.0] - 2026-08-28

### Changed

- Apply warning coloring to status-line usage at 80% and error coloring at 90%.

### Internal

- Add a project-local release skill for versioning, changelog updates, and release commits.

## [1.5.4] - 2026-08-28

### Changed

- Display the reported reset time as full days, days plus hours, or `h:mm`.
- Apply the selected calendar-days or weekdays policy to the remaining-time calculations.
- Show absolute remaining credits instead of an equivalent daily rate when less than a day remains.
- Use `[wkd]` in the status bar to identify the weekdays policy.

## [1.5.3] - 2026-08-27

### Internal

- Extracted TUI dashboard session and analytics orchestration into `src/usage-dashboard.ts`, leaving `usage-command.ts` focused on command dispatch and non-TUI output.
- Added focused tests for dashboard analytics generation guards, preloading, reloads, and aborted views.

## [1.5.2] - 2026-08-27

### Internal

- Refactored usage refresh, command orchestration, and Account/Session dashboard tabs into focused modules.
- Consolidated chart, formatting, legend, and control helpers and expanded automated coverage to 140 tests.

## [1.5.1] - 2026-08-26

### Changed

- Streamlined modal shortcut hints by removing controls already shown above the charts.
- Added the highlighted `d` day-policy control to the Account tab.
- Added `↑`/`↓` as chart and session-table scrolling keys and documented `q`/`Esc` for closing.

### Removed

- Removed the `1`/`2`/`3` shortcuts for selecting periods.
- Removed `←`/`→` scrolling in favor of `↑`/`↓` (while retaining `j`/`k`).

## [1.5.0] - 2026-08-26

### Added

- Press `r` to refresh monthly usage and both daily and weekly charts without closing the dashboard.

### Changed

- Open the dashboard immediately when recent usage is available, then update it in the background.
- Let the daily and weekly charts load separately, so one does not hold up the other.
- Keep the status bar and dashboard usable while usage is being refreshed.

### Fixed

- Keep the loading indicator visible when switching charts during a refresh.

## [1.4.2] - 2026-08-18

### Added

- Scale-aware x-axis tick labels for the Account chart.

### Changed

- Increased the usage modal height to make room for the x-axis legend.
- Corrected logarithmic bar positioning so zero and decade intervals are evenly spaced.

## [1.4.1] - 2026-08-18

### Fixed

- Align daily budget markers with the per-day on-track and over-budget chart split.

## [1.4.0] - 2026-08-14

### Added

- Session credit estimates across the whole session or active branch.
- Per-model credit and token totals, reply counts, Priority counts, and compaction counts.
- Account and Session tabs with sorting and credit/token display controls.

### Changed

- Combined the dashboard title and Account/Session tabs in the modal header.
- Unified and stabilized control layouts, status indicators, and shortcut highlighting.

## [1.3.1] - 2026-08-12

### Changed

- Show the package version in the modal header.

## [1.3.0] - 2026-08-12

### Added

- Added square-root scaling as an additional usage chart scale option.

## [1.2.1] - 2026-08-12

### Changed

- Added spacing between the left border and modal control legends, chart legends, footer hints, and status text.
- Removed redundant padding from chart loading and empty-data indicators.

## [1.2.0] - 2026-08-12

### Added

- Token counts and tokens-per-credit ratios in the usage dashboard.
- Responsive chart controls, legends, and token annotations.

### Changed

- Token display cycles through `off`, `counts`, and `ratio`.
- Chart bars retain credit-based sizing across all token display modes.
- Zero-token and zero-credit model annotations are omitted from legends.

## [1.1.0] - 2026-08-10

### Changed

- Updated the modal scrollbar to use the theme's scrollbar color.

### Internal

- Moved source files into `src/` and added automated tests, linting, and typechecking.

## [1.0.0] - 2026-08-05

### Added

- Interactive Codex usage dashboard with Usage and Models views.
- Calendar-day and weekday budgeting with forecast display.
- Daily budget markers, log-scale charts, scrolling, and model grouping.
- Pace reporting with threshold-based colors.

### Changed

- Usage bars use server-provided Codex usage fields and daily-budget scaling.
