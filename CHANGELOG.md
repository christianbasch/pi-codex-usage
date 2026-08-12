# Changelog

## [1.3.1] - 2026-08-12

### Added

- Added square-root scaling as an additional usage chart scale option.

### Changed

- Show the package version in the modal header.

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
