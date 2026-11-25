import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { Buffer } from "node:buffer";
import { copyFile, link, lstat, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { clearTimeout, setTimeout } from "node:timers";

const MAX_PROCESS_MS = 120_000;
const MAX_OUTPUT_BYTES = 1_000_000;

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function execute(binary, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(binary, args, { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    let length = 0;
    let failure;
    const capture = chunk => {
      length += chunk.length;
      if (length > MAX_OUTPUT_BYTES) {
        failure = new Error("media tool output limit exceeded");
        child.kill();
      } else chunks.push(chunk);
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    const timer = setTimeout(() => { failure = new Error("media tool timed out"); child.kill(); }, MAX_PROCESS_MS);
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0) reject(new Error(`media tool failed (${code})`));
      else resolvePromise(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

function fpsValue(value) {
  const match = /^(\d+)\/(\d+)$/.exec(value ?? "");
  return match && Number(match[2]) ? Number(match[1]) / Number(match[2]) : NaN;
}

// Read JPEG SOF dimensions before encoding, so mismatched capture sizes cannot
// silently upscale frames or make a viewport recording lose detail.
function jpegSize(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 3 < bytes.length) {
    if (bytes[offset++] !== 0xff) return undefined;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xd9 || marker === 0xda || offset + 2 > bytes.length) return undefined;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = bytes.readUInt16BE(offset);
    if (length < 2 || offset + length > bytes.length) return undefined;
    if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7) ||
        (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
      if (length < 7) return undefined;
      return { height: bytes.readUInt16BE(offset + 3), width: bytes.readUInt16BE(offset + 5) };
    }
    offset += length;
  }
  return undefined;
}

export function createPlatformMediaProcessor({ ffmpeg, ffprobe }) {
  requireValue(typeof ffmpeg === "string" && isAbsolute(ffmpeg), "ffmpeg must be an absolute path");
  requireValue(typeof ffprobe === "string" && isAbsolute(ffprobe), "ffprobe must be an absolute path");
  const encoder = resolve(ffmpeg), inspector = resolve(ffprobe);
  return async ({ frames, fps, resolution, viewport, durationMs, outputPath }) => {
    requireValue(Array.isArray(frames) && frames.length > 0 && (fps === 5 || fps === 15), "invalid frame input");
    requireValue(resolution === "fit-720p" || resolution === "viewport", "invalid recording resolution");
    requireValue(viewport && Number.isSafeInteger(viewport.width) && Number.isSafeInteger(viewport.height) &&
      viewport.width >= 2 && viewport.height >= 2,
    "invalid recording viewport");
    requireValue(Number.isFinite(durationMs) && durationMs > 0 && durationMs <= 3_600_000, "invalid recording duration");
    requireValue(typeof outputPath === "string" && isAbsolute(outputPath) && basename(outputPath) === "0001.mp4", "invalid recording path");
    let previous = -1;
    for (const frame of frames) {
      requireValue(frame && typeof frame.path === "string" && isAbsolute(frame.path) && Number.isFinite(frame.offsetMs) &&
        frame.offsetMs >= 0 && frame.offsetMs >= previous && frame.offsetMs <= durationMs, "invalid frame timing");
      previous = frame.offsetMs;
      requireValue((await lstat(frame.path)).isFile(), "invalid recording frame");
      const size = jpegSize(await readFile(frame.path));
      requireValue(size && size.width === viewport.width && size.height === viewport.height, "recording frame size mismatch");
    }
    requireValue(frames[0].offsetMs === 0, "first recording frame must start at zero");
    const parent = dirname(outputPath);
    await mkdir(parent, { recursive: true });
    const tmp = await mkdtemp(join(parent, ".media-"));
    try {
      const count = Math.ceil(durationMs * fps / 1000);
      let index = 0;
      for (let n = 0; n < count; n++) {
        const timestamp = n * 1000 / fps;
        while (index + 1 < frames.length && frames[index + 1].offsetMs <= timestamp) index++;
        const target = join(tmp, `frame-${String(n).padStart(8, "0")}.jpg`);
        try { await link(frames[index].path, target); }
        catch (error) {
          if (!["EXDEV", "EPERM", "ENOTSUP", "EOPNOTSUPP"].includes(error.code)) throw error;
          await copyFile(frames[index].path, target);
        }
      }
      const tempVideo = join(tmp, `${randomUUID()}.mp4`);
      const scale = resolution === "fit-720p" ? Math.min(1, 1280 / viewport.width, 720 / viewport.height) : 1;
      const width = Math.max(2, Math.round(viewport.width * scale));
      const height = Math.max(2, Math.round(viewport.height * scale));
      const filter = scale < 1 ? `scale=${width}:${height}:flags=lanczos` : "null";
      const pixelFormat = width % 2 || height % 2 ? "yuv444p" : "yuv420p";
      await execute(encoder, ["-hide_banner", "-loglevel", "error", "-nostdin", "-f", "image2", "-framerate", String(fps),
        "-i", join(tmp, "frame-%08d.jpg"), "-vf", filter, "-c:v", "libx264", "-preset", "medium", "-crf", "23",
        "-pix_fmt", pixelFormat, "-an", "-movflags", "+faststart", "-n", tempVideo]);
      const data = JSON.parse(await execute(inspector, ["-v", "error", "-select_streams", "v:0", "-count_frames", "-show_entries",
        "stream=width,height,avg_frame_rate,nb_read_frames:format=duration,size", "-of", "json", tempVideo]));
      const stream = data.streams?.[0];
      const actualFps = fpsValue(stream?.avg_frame_rate);
      const actualDuration = Number(data.format?.duration) * 1000;
      const bytes = await readFile(tempVideo);
      requireValue(stream && Number.isSafeInteger(stream.width) && Number.isSafeInteger(stream.height) &&
        Number.isFinite(actualFps) && Math.abs(actualFps - fps) < 0.001 && Number(stream.nb_read_frames) === count &&
        Number.isFinite(actualDuration) && actualDuration > 0 && Math.abs(actualDuration - count * 1000 / fps) < 3 &&
        Number(data.format?.size) === bytes.length && bytes.length > 0, "recording probe mismatch");
      requireValue(stream.width === width && stream.height === height, "recording size mismatch");
      const sha256 = createHash("sha256").update(bytes).digest("hex");
      await link(tempVideo, outputPath);
      return { width: stream.width, height: stream.height, fps: actualFps, durationMs: actualDuration, sizeBytes: bytes.length, sha256 };
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  };
}
