# Changelog

All notable changes to Oriko will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed
- **Smart grids are now called smart views.** Nothing else about them changes. The name was misleading: you can't move a clipping into one, it shows whatever matches its rules, and "view" says that where "grid" suggested a place things go.

### Added
- **You can now gather clippings into folders on a grid.** Select a few tiles, right-click and choose Move to folder → New folder…, give it a name and an icon, and they collapse into one card on the wall: a collage of what's inside, with the name and a count along the bottom. Click the card to see the folder as a wall of its own (Escape or the back button beside the grid switcher takes you out again), and anything you clip while you're in there lands in the folder. The same options are in the palette under Move to folder, and New folder sits beside New grid.
- **Folder cards can be resized.** Hover a folder and drag any corner to stretch it across one, two or three columns; on a phone, hold your finger on the card first to bring the corners up. A wider card shows more of what's inside. Right-click the card for Size if you'd rather pick from a list, and for Edit folder and Remove folder. Removing a folder puts its clippings back on the wall and deletes nothing.

- **You can now undo.** ⌘Z takes back the last thing you did on the wall and ⌘⇧Z does it again: moving clippings between grids or folders, editing a property, making, renaming, resizing or removing a folder, and making, renaming, reordering or deleting a grid. The palette lists the same as "Undo …" and "Redo …" with the action's name. Deleting a clipping isn't covered yet, since it goes to Obsidian's trash; restore it from there.

Keep in mind that a folder belongs to one grid, and its clippings belong to that grid too: moving a clipping to another grid takes it out of the folder. Folders travel between your devices the same way grids do, through the shared note in your clippings folder, so a folder made on the desktop is on your phone after a sync, at the same size.

## [0.1.54] - 2026-09-03

### Added
- **You can now choose what a tile tells you about its clipping.** Hover a tile and you'll see a couple of small pills instead of the old caption band: how long ago it was clipped in the top corner ("2d ago", "3w ago"), and its tags along the bottom. Pick what goes in each corner under Settings → Oriko → Show on tiles: "Top corner" offers your date properties, "Bottom corner" everything else, and either can be None. A property with several values (tags, say) runs them together in the one pill, and when that's too long for the tile it ticks across like a news ticker while you hover. The source shows as just the site's name.

### Changed
- **The title no longer appears on the tile.** It was the one thing on the hover band, and it covered the picture more than it helped. The title is still in the details panel and in the palette. If you miss it, choose Title as the bottom corner under Show on tiles.

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
