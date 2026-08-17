function replaceExtension(path: string, suffix: string): string {
  const slash = path.lastIndexOf("/");
  const dot = path.lastIndexOf(".");
  return dot > slash ? path.slice(0, dot) + suffix : path + suffix;
}

export function thumbPath(originalPath: string): string {
  return replaceExtension(originalPath, ".thumb.webp");
}

export function posterPath(originalPath: string): string {
  return replaceExtension(originalPath, ".poster.webp");
}

export function scaledSize(
  width: number,
  height: number,
  targetWidth: number
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: targetWidth, height: targetWidth };
  if (width <= targetWidth) return { width, height };
  return { width: targetWidth, height: Math.round((height / width) * targetWidth) };
}

export interface Rendered {
  data: ArrayBuffer;
  width: number;
  height: number;
}

async function encode(canvas: HTMLCanvasElement): Promise<ArrayBuffer | null> {
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/webp", 0.8)
  );
  return blob ? await blob.arrayBuffer() : null;
}

function draw(
  source: CanvasImageSource,
  naturalWidth: number,
  naturalHeight: number,
  targetWidth: number
): HTMLCanvasElement | null {
  const size = scaledSize(naturalWidth, naturalHeight, targetWidth);
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(source, 0, 0, size.width, size.height);
  return canvas;
}

/**
 * Downscales an archived image for the grid. Decoding a 1920x1080 JPEG to
 * paint a 300px tile is most of the cost of a naive grid; this is the single
 * largest performance win in the plugin.
 */
export async function renderThumbnail(
  sourceUrl: string,
  targetWidth: number
): Promise<Rendered | null> {
  const image = new Image();
  const loaded = new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
  });
  image.src = sourceUrl;
  if (!(await loaded)) return null;
  if (image.naturalWidth === 0) return null;

  const canvas = draw(image, image.naturalWidth, image.naturalHeight, targetWidth);
  if (!canvas) return null;
  const data = await encode(canvas);
  if (!data) return null;
  return { data, width: image.naturalWidth, height: image.naturalHeight };
}

/**
 * Captures one frame so a video tile can paint instantly while still holding
 * preload="none". Also the only source of a video's intrinsic dimensions,
 * since no container header parser runs over mp4.
 */
export async function renderPoster(
  sourceUrl: string,
  targetWidth: number
): Promise<Rendered | null> {
  const video = document.createElement("video");
  video.muted = true;
  video.preload = "metadata";
  video.crossOrigin = "anonymous";
  video.src = sourceUrl;

  const ready = await new Promise<boolean>((resolve) => {
    const timer = window.setTimeout(() => resolve(false), 10000);
    video.onloadeddata = () => {
      window.clearTimeout(timer);
      resolve(true);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      resolve(false);
    };
  });
  if (!ready || video.videoWidth === 0) return null;

  const seeked = await new Promise<boolean>((resolve) => {
    const timer = window.setTimeout(() => resolve(false), 5000);
    video.onseeked = () => {
      window.clearTimeout(timer);
      resolve(true);
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      resolve(false);
    };
    video.currentTime = Math.min(0.1, (video.duration || 1) / 2);
  });
  if (!seeked) return null;

  const canvas = draw(video, video.videoWidth, video.videoHeight, targetWidth);
  if (!canvas) return null;
  const data = await encode(canvas);
  if (!data) return null;
  return { data, width: video.videoWidth, height: video.videoHeight };
}
