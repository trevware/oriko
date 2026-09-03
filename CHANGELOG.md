# Changelog

All notable changes to Oriko will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.53] - 2026-09-02

### Changed
- **The details panel now shows the whole link.** It used to show just the site's name, with the full address tucked away on hover, which isn't much use on a phone. Long links wrap onto a second line rather than getting cut off.

### Fixed
- **"Is empty" was showing up as a blank row in the palette.** If you filtered by a property from the command palette, the "Is empty" option had a count next to it and no words. It reads "Is empty" now, with a line above it, the same as it does in the filter menu.

## [0.1.52] - 2026-09-02

### Added
- **You can now choose where shared clips end up.** Sharing a link from your phone used to file it into whichever grid you last had open, which was rarely the one you meant. There's a new setting for this under Settings → Oriko → "Shared clips go to": keep the old behaviour, always use your home grid, or get asked each time. Clipping from inside Oriko still goes to the grid you're looking at.
- **Filter by "Is empty".** Every property in the filter menu now has an "Is empty" option, so you can pull up everything you haven't categorized yet. It works in smart grid rules too, which means you can finally make an "Uncategorized" grid that fills itself.
- **Edit properties on a bunch of clippings at once.** Select more than one and you'll find a new Properties button on the bar at the bottom (or press P, or right-click). A check means all of them have that value, a dash means only some do. One tap adds it to all of them, or takes it off all of them.

### Changed
- **Filters clear when you switch grids.** Each grid opens showing everything, instead of quietly holding onto a filter you set earlier.
- **The wall holds still while you've got a menu open.** Before, a clipping could vanish out from under you mid-edit. Give something its first category while filtering by "Is empty", say, and it would disappear before you could add a second. Now the wall waits until you close the menu, the sheet, or the selection bar.
- **The Autoplay videos setting comes with a heads-up.** A wall full of playing videos can use a surprising amount of memory, so the setting says so.

### Fixed
- **Opening or closing a sidebar was sluggish on a big wall.** Oriko was rearranging every tile on every frame of the sidebar animation. It now waits for the pane to finish moving, then lays everything out once, with the same little pop you get when switching grids.
- **Round buttons went square under some themes.** Themes like Primary style every button in Obsidian, and the filter, manage, grid switcher, and new grid buttons were losing their shape to it. They keep their rounded look now.
