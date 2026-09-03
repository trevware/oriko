# Changelog

All notable changes to Oriko will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.53] - 2026-09-02

### Changed
- **The details panel shows the full source link.** It used to show only the site's domain, with the full address on hover, which you can't do on a phone. Long links wrap onto extra lines.

### Fixed
- **"Is empty" showed up as a blank row in the palette.** When filtering by a property from the command palette, the "Is empty" option had no text, just a count. It now reads "Is empty" and sits below a divider, the same as in the filter menu.

## [0.1.52] - 2026-09-02

### Added
- **Choose where shared clips go.** A new setting, "Shared clips go to", decides where a link shared from another app is filed: the last opened grid (how it worked before), your home grid, or a prompt to pick a grid each time. Clips you make from inside the wall still go to the grid you're looking at.
- **Filter by "Is empty".** Every property in the filter menu now offers "Is empty", so you can find the clippings that don't have a category or status yet. It works in smart grid rules too, so you can make an "Uncategorized" grid.
- **Edit properties for several clippings at once.** Select more than one, then use the new Properties button on the selection bar (or press P), or right-click the selection. A check means every selected clipping has that value, a dash means only some do. One tap adds it to all of them, or removes it from all of them.

### Changed
- **Filters reset when you switch grids.** Each grid opens unfiltered, instead of remembering a filter you set earlier in the session.
- **The wall holds still while you're working in a menu.** Before, a tile could vanish out from under an open menu. For example, giving a clipping its first category while filtering by "Is empty" removed it from the wall before you could add a second. The wall now waits until the menu, sheet, or selection bar closes.
- **The Autoplay videos setting now warns about memory use.** A wall of playing videos can use a lot of RAM.

### Fixed
- **Opening or closing a sidebar lagged with a large wall.** The wall re-laid itself out on every frame of the sidebar animation. It now waits for the pane to finish moving, then lays out once, with the same animation as switching grids.
- **Round buttons went square under some themes.** The filter, manage, grid switcher, and new grid buttons keep their rounded shape under themes like Primary that style every button.
