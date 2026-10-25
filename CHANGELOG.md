# Changelog

All notable changes to Oriko will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.76] - 2026-10-25

### Changed
- **Oriko's panels now match your theme.** The selection bar, the ⌘K palette, menus and the bar along the bottom take on your theme's own background and text colors, so on a blue or warm theme they blend in instead of sitting on the wall as a gray slab. Default Obsidian looks the same as before.

## [0.1.75] - 2026-10-19

### Added
- **Revisit brings back clips you'd forgotten about.** Choose Revisit from ⌘K and Oriko pulls up to 20 clips at random from the wall you're on, one at a time beside the palette. Press → to keep a clip or ← to forget it, then pick Finish. It's a quick way to rediscover something you saved months ago, or to clear out what you no longer need.
- **Nothing is forgotten until you finish.** Changed your mind? Shift-Tab steps back so you can keep it after all. Forgotten clips go to Obsidian's trash once you confirm, along with any pictures and videos only they used. If you'd rather hang on to them, set Settings → Oriko → Revisit → Forgotten clips to Mark as archived and they'll stay on the wall, marked archived and out of later passes.
- **Revisit follows your filter.** Narrow the wall to food first and you get a pass of food. Clips you've seen in the last month wait their turn, so you aren't shown the same ones twice. Keep in mind Revisit is desktop only for now.

## [0.1.74] - 2026-10-18

### Added
- **You can now find clippings by color.** Type a color into ⌘K, like red, maroon or sky blue, and pick it to narrow the wall to the clippings that have it in their picture. Nearby shades count too, and the clippings with the most of that color come first.
- **Colors answer to their other names, and to hex codes.** Burgundy finds maroon and gray finds grey. Paste a code like #800000 and you get a row for that exact color.
- **The filter menu has a Color list.** Each color shows with a dot of itself and a count, the shades sit under their own heading, and Search colors at the top opens the same search as ⌘K. Keep in mind each device works out the colors from the pictures it already has, so the first time you open the wall the list takes a few seconds to fill in. Nothing is written into your notes.

### Changed
- **Describe new clippings waits for a clip to finish.** Describing is now the last step of clipping, after the picture and video are saved. Clips from your phone get described once they sync in with their pictures.

## [0.1.73] - 2026-10-18

### Added
- **Describe new clippings as they land.** Turn on Settings → Oriko → Describe new clippings and each clip that arrives while the wall is open gets its labels a few seconds later, whether you clipped it in Oriko or with the Web Clipper. Clips that land close together go as one run. Clippings already on your wall stay put for Describe uncategorized to pick up.
- **Describe is in the selection bar and the right-click menu.** Select some tiles and click the sparkles button in the selection bar, or right-click a tile and choose Describe, then pick Broad, Standard or Specific.
- **Videos you open start muted.** Opening a clip no longer blasts its sound at you. Unmute one and the clips you step to next keep their sound until you close the viewer. If you'd like sound from the start, turn off Settings → Oriko → Open videos muted.

### Changed
- **Describe has its own section at the top of Oriko's settings.** Everything else sits under a heading now too: Clippings, Wall, Downloads, Grids and the rest.
- **The palette says when Describe can't run.** If Describe is on but missing something, like an Oriko Plus license key, ⌘K shows a row that says what's missing and where to add it.

## [0.1.72] - 2026-10-18

### Fixed
- **Small fixes and improvements.**

## [0.1.71] - 2026-10-16

### Fixed
- **Small fixes and improvements.**

## [0.1.70] - 2026-10-16

### Added
- **Oriko Plus runs Describe for you.** If you'd rather not install Claude Code or get an API key, pick Oriko Plus under Settings → Oriko → Describe engine and paste the license key from your receipt. It covers 1,000 clippings a month on up to five devices, and the Subscription row keeps count. You can subscribe right from Oriko's settings, or at trevware.com/oriko.

### Changed
- **Describe won't take orders from your clippings.** Text in a clipping that reads like instructions to Claude is now treated as part of the clipping to describe, so a page can't steer its own labels.
- **A Describe run that stops on a problem says why straight away.** If Describe has to stop partway (you've signed out of Claude Code, say, or your API key is out of credit), the message now appears the moment it happens, and any clips already being described still get their labels.

## [0.1.69] - 2026-10-15

### Added
- **Describe labels your clippings for you.** Turn it on in Settings → Oriko → Describe clippings (desktop only for now), then press ⌘K and choose Describe uncategorized, or select some tiles and choose Describe. It looks at each picture, or a handful of frames from a video, along with the note's text, and writes categories, a one-line caption and any text in the picture into the note's properties. The palette searches all of that, so a screenshot called "Pasted image 2026-08-18" turns up when you type what's in it.
- **Describe runs on your own Claude.** Settings → Oriko → Describe engine picks Claude Code on this computer or an Anthropic API key. Keep in mind Anthropic may count Claude Code use from Oriko as third-party app usage, and that a clipping's picture and note text go to Anthropic when you run Describe.
- **You choose how specific the labels get.** Each run asks first: Broad sticks to your wall's most general categories, Standard is the everyday pick, and Specific can name the thing itself (a projector, say), up to six labels. Running Describe again on clippings that already have labels only adds to them.
- **New categories wait for your OK.** When Describe wants a category your wall doesn't have yet, it goes into Review suggestions in the palette. Review plays each clip beside the palette so you can see what you're approving: ↵ ticks a label, Tab moves to the next clip, Shift-⌫ throws out this clip's suggestions, and Apply writes only the clips you've looked at.
- **You can watch a run happen.** Each clip on the wall shows what it's up to (Picking frames, Reading picture, Describing), and its new labels pop on as it lands. The rest of the wall dims so you can see where the work is, and the bar at the bottom counts along (Describing 12 of 84) before signing off with a summary. Click it for Stop and Review.

### Changed
- **The palette is tidier.** What you can do is grouped under Selection, Describe, Grids, Filters, Edit and Capture, the rows are shorter, and clippings only show up once you start typing. The old, longer names still find their rows, and Archive all clipping media is now just Archive media.

## [0.1.68] - 2026-10-07

### Fixed
- **Oriko passes the community directory's code check again.** The last release picked up one warning, from a tool Oriko uses to measure how fast the wall is. That tool isn't part of what you install, so nothing about the plugin itself changes in this release.

## [0.1.67] - 2026-10-04

### Added
- **X, Instagram, Threads and YouTube clippings now show as cards.** Each one gets a band under its picture with the person's avatar, name and likes, and the start of what they said. A YouTube video shows its channel, its views and how long it runs, over its title. Keep in mind the avatars, likes and views come from each site, so they need Settings → Oriko → Use community media resolvers on.
- **You can choose how each site's card shows.** Settings → Oriko → Site cards has a setting each for Steam store pages, X posts, Instagram posts, Threads posts and YouTube videos: Always show, Show on hover, or Never show for a plain tile. The new sites start out matching your X posts setting.
- **Show on hover slides the band out like a drawer.** Hover a card and it grows downward to show its band with the whole picture still in view, and the cards below it move down to make room until you move on.

### Fixed
- **A selected card now has its outline all the way round.** On store cards the outline only showed around the band under the picture.
- **Cards no longer pause before they lift.** The first time you hovered some cards, they held still for a beat before rising. They now move the moment your pointer arrives.
- **Changing the tile size is much quicker.** On a big wall each step could hold everything up for a third of a second. Now it's close to instant.
- **Hovering across a big wall is smoother.** Every card was keeping its own set of graphics layers even when nobody was looking at it, and moving from card to card now does about half the work.

## [0.1.66] - 2026-10-04

### Added
- **Steam store pages now look like Steam on your wall.** Clip a game's store page and its tile becomes a store card: the game's header art, with a band underneath showing its name, a couple of genres and the price, sale discount included. A game that isn't out yet shows its release status there. At Tiny tile size the card is just the art.
- **Opening a Steam clipping gives you the store page.** The trailer plays first, and beside it you get the game's description, price, genres, release date, developer, publisher and platforms, plus a strip of the trailer and screenshots you can click through. Keep in mind the trailer is saved with yt-dlp on a desktop, so it has to fit under Settings → Oriko → Downloads → Maximum file size (MB). On an iPhone it plays straight from Steam until the saved copy syncs.
- **Steam prices follow where you are.** Oriko works out your country from your time zone and asks that store for its prices, so a wall in Canada shows Canadian dollars. Prices and release dates are checked again once a day. The game's art is saved the first time, so the card keeps its pictures, and deleting the last clipping of a game moves that art to the trash with it.
- **A clip now builds right on the wall.** The moment you clip something, its card appears in the top-left corner and the bar along the top is gone. You see the page's picture blurred while Oriko works, sharpening as it goes, with the current step in the corner (Reading link, Downloading, Fetching video). When it's done, a check draws itself and the card turns into your clipping, right where it was.

### Changed
- **Clippings from the same day now show newest first.** They used to be sorted by title within a day. Now the one you just clipped is always first on the wall.

### Fixed
- **Clippings whose only picture is an SVG now turn up on the wall.** Some sites publish an SVG as their only preview image, and those clippings were saved but never shown. They now get a sharp tile like any other.

## [0.1.65] - 2026-09-27

### Fixed
- **Clipping a post that shares an X Article now saves its videos.** Those posts came in with nothing but a link, because the videos live in the article itself. You now get every video and picture from the article, in the order you'd read them, with the article's title on the clipping.

## [0.1.64] - 2026-09-19

### Fixed
- **Saving a video no longer hands you two files.** Every clipping with a video was giving you the video plus a second copy of it, or the reel's cover picture, both of which Oriko had quietly archived alongside it. You now get the video on its own, whether you save it to your phone, export it to Downloads or reveal it.

## [0.1.63] - 2026-09-19

### Fixed
- **Save to device and Open file now turn up on a phone.** Oriko was quietly deciding your phone was a desktop, so you got Export to Downloads and Reveal in Finder instead, and tapping either gave you a note about the file when the truth was there is no Downloads folder or Finder to send it to.

## [0.1.62] - 2026-09-19

### Added
- **You can now save a clipping's picture or video to your phone.** Open a clipping and tap Save to device, and iOS offers Save Image, Save to Files, or anywhere else you'd send a photo. On a desktop that button is still Export to Downloads and still lands in your Downloads folder.
- **You can now open a clipping's archived picture or video on your phone.** There's no Finder to reveal it in, so Reveal in Finder is called Open file there and opens the file in its own tab. Both sit in the clipping's bar, the tile's menu and the command palette, same as on a desktop.

## [0.1.61] - 2026-09-17

### Added
- **Oriko now tells you when a video can't be saved, and what to do about it.** If a site like YouTube turns yt-dlp away (updating yt-dlp usually fixes that), a video is over your limit in Settings → Oriko → Downloads → Maximum file size (MB), or a download runs past three minutes, you get a note naming the clipping. A post that simply has no video stays quiet, as before.

## [0.1.60] - 2026-09-12

### Fixed
- **A property you change now shows on the tile straight away.** The pills you see when you hover a tile kept the old values until the tile was scrolled off and back.
- **A wall's last row no longer has gaps in the middle of it.** Two clippings that look exactly the same size can be a pixel apart in the original, and that was enough to leave a hole with tiles carrying on to the right of it. Easiest to spot with tile size on Small.

## [0.1.59] - 2026-09-11

### Fixed
- **Shrink and expand now work on a grid that holds only folders.** Changing the tile size on such a grid did nothing until you left, changed it somewhere with clippings on it, and came back. The folder cards resize with it too.

## [0.1.58] - 2026-09-11

### Added
- **Each grid can now keep its own look.** Settings → Oriko → Grids → Grid settings apply to, set to Per grid, and tile size, the tile corners, filter properties and autoplay stop being one answer for the whole vault. You set them from Grid settings on the wall, where they appear under the grid's name, and a value a grid has set for itself reads "this grid" beside it. Anything a grid hasn't set follows what's in Settings, so a wall you've never touched looks the way it always did, and Follow all grids at the foot of each menu is the way back. Switching to All grids clears nothing: a grid keeps what you gave it and has it back if you switch again. Tile size is the one that stays on this device, since a grid set to Huge on the desktop would arrive on a phone as one column per row.
- **Folders can be selected, several at a time.** ⌘-click a folder card to pick it up (a plain click still opens it) and the selection bar takes over: Move to grid takes the folders and everything inside them across in one go, and the trash asks whether the clippings should come back onto the wall or go with the folders. Right-click a folder that's part of a selection and the menu acts on all of them.
- **Move to grid can make the grid.** The list now ends in New grid…, so a selection can go somewhere that doesn't exist yet without losing the selection to make it first. Folders get the same.
- **Right-click the wall itself to make something on it.** Empty space now opens the same menu as the + button: Clip, New grid, New smart view, New folder, right where you're looking instead of down in the corner.

### Changed
- **The settings descriptions say more in fewer words**, and the per-grid switch says where its values are set.

## [0.1.57] - 2026-09-07

### Changed
- **Property menus now put what's already applied at the top.** Open Categories and the ones already on the clipping lead the list, ticked, so you can see what's set without reading to the bottom. The order settles as you open the menu, so nothing jumps around while you work.

### Fixed
- **A clipping you paste no longer goes missing until you reload.** Pasting a link or an image occasionally left you with a clipping that was saved but never turned up on the wall. It now waits for the picture and appears on its own.

## [0.1.56] - 2026-09-07

### Fixed
- **A category you make in the right-click menu now appears the moment you make it.** Type a name into Categories and press Enter and it takes its place in the list with a tick beside it, instead of looking like nothing happened until you closed the menu and opened it again.

## [0.1.55] - 2026-09-05

### Added
- **You can now gather clippings into folders on a grid.** Select a few tiles, right-click and choose Move to folder → New folder…, give it a name and an icon, and they collapse into one card on the wall: a collage of what's inside, with the name and a count along the bottom. Click the card to see the folder as a wall of its own (Escape or the back button top left takes you out again), and anything you clip while you're in there lands in the folder. The same options are in the palette under Move to folder, in the selection bar, and New folder sits beside New grid. A new folder pops in at the top of the wall while everything else dims for a moment, so you see where it went.
- **Folder cards can be resized.** Hover a folder and drag any corner to stretch it across one, two or three columns; on a phone, hold your finger on the card first to bring the corners up. A wider card shows more of what's inside, arranged to fill the card whatever the count, and its videos and GIFs play on hover (or on their own, with autoplay on). Right-click the card for Size if you'd rather pick from a list, and for Edit folder and Remove folder. Removing a folder puts its clippings back on the wall and deletes nothing.
- **You can now undo.** ⌘Z takes back the last thing you did on the wall and ⌘⇧Z does it again: moving clippings between grids or folders, editing a property, making, renaming, resizing or removing a folder, and making, renaming, reordering or deleting a grid. The palette lists the same as "Undo …" and "Redo …" with the action's name. Deleting a clipping isn't covered yet, since it goes to Obsidian's trash; restore it from there.
- **The icon picker has ten times the icons.** New folder, New grid and their editors now offer 120 icons in captioned groups (Marks, Containers, Media, Places, Nature, Play and so on), scrolling inside the sheet. The arrow keys still step through them a row at a time.

### Changed
- **Smart grids are now called smart views.** Nothing else about them changes. The name was misleading: you can't move a clipping into one, it shows whatever matches its rules, and "view" says that where "grid" suggested a place things go.
- **Making a grid or view no longer switches you to it.** You stay on the wall you were working on, the switcher gains the new entry, and a notice says it was made.
- **The selection bar gained Move to grid and Move to folder**, so a selection can be filed without opening the right-click menu.

### Fixed
- **Typing a folder or grid name no longer scrolls the icon list away from where you'd left it.** Each letter used to jump the list back to the chosen icon.
- **The wall no longer nudges when you delete the folder or clipping you were looking at.** It now keeps its place by the nearest tile that survives.

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
