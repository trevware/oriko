import { MarkdownPostProcessorContext, TFile, normalizePath } from "obsidian";
import { isInFolder } from "./index-store";
import type OrikoPlugin from "./main";
import { localReplacement, sourceVideoKeyFor } from "./core/normalize";

/**
 * Repairs a clipping whose remote media has died, without editing the file.
 *
 * The body keeps pointing at the origin server, per CLAUDE.md §9, so the
 * swap happens at render time: when a remote image or video fails to load,
 * its archived copy takes over.
 */
function repairDeadMedia(plugin: OrikoPlugin, element: HTMLElement): void {
  const nodes: Array<HTMLImageElement | HTMLVideoElement> = [
    ...Array.from(element.querySelectorAll("img")),
    ...Array.from(element.querySelectorAll("video")),
  ];

  for (const node of nodes) {
    const original = node.getAttribute("src");
    if (!original) continue;

    node.addEventListener(
      "error",
      () => {
        const replacement = localReplacement(original, plugin.archiver.cache);
        if (!replacement) return;
        const file = plugin.app.vault.getAbstractFileByPath(normalizePath(replacement));
        if (file instanceof TFile) {
          node.setAttribute("src", plugin.app.vault.getResourcePath(file));
        }
      },
      { once: true }
    );
  }
}

/**
 * Plays a post's archived video inside the note.
 *
 * yt-dlp fetches the video after the note has been written, and the plugin
 * does not edit notes, so the file never references it. The poster still is
 * swapped for the local clip at render time instead. Only a section holding
 * exactly one image is touched, so an article full of pictures is left alone.
 */
function playArchivedVideo(
  plugin: OrikoPlugin,
  element: HTMLElement,
  sourcePath: string
): void {
  const record = plugin.index.get(sourcePath);
  if (!record?.source) return;

  const entry = plugin.archiver.cache.get(sourceVideoKeyFor(record.source));
  if (!entry?.file) return;

  const images = Array.from(element.querySelectorAll("img"));
  if (images.length !== 1) return;

  const file = plugin.app.vault.getAbstractFileByPath(normalizePath(entry.file));
  if (!(file instanceof TFile)) return;

  const video = document.createElement("video");
  video.src = plugin.app.vault.getResourcePath(file);
  video.controls = true;
  video.loop = true;
  video.muted = true;
  video.autoplay = true;
  video.playsInline = true;
  video.addClass("pg-note-video");
  images[0].replaceWith(video);
}

export function installRepair(plugin: OrikoPlugin): void {
  plugin.registerMarkdownPostProcessor(
    (element: HTMLElement, context: MarkdownPostProcessorContext) => {
      if (!isInFolder(context.sourcePath, plugin.settings.clippingsFolder)) return;
      playArchivedVideo(plugin, element, context.sourcePath);
      repairDeadMedia(plugin, element);
    }
  );
}
