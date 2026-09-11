/* global document, MediaRecorder, Blob, setInterval, clearInterval, setTimeout */
import { Buffer } from "node:buffer";
import { chromium } from "@playwright/test";

/** Create media on an offline blank page; no app, camera, microphone or target is observed. */
export async function createArtificialMedia() {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ offline: true });
    const page = await context.newPage();
    const media = await page.evaluate(async () => {
      const canvas = document.createElement("canvas"); canvas.width = 320; canvas.height = 180;
      const paint = (color, label) => {
        const brush = canvas.getContext("2d"); brush.fillStyle = color; brush.fillRect(0, 0, canvas.width, canvas.height);
        brush.fillStyle = "white"; brush.font = "bold 32px sans-serif"; brush.fillText(label, 24, 96);
      };
      canvas.height = 600; paint("#186c83", "ARTIFICIAL P"); const pngP = canvas.toDataURL("image/png").split(",")[1];
      canvas.height = 180;
      paint("#42752c", "ARTIFICIAL Q"); const pngQ = canvas.toDataURL("image/png").split(",")[1];
      const stream = canvas.captureStream(10), chunks = [];
      const recorder = new MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
      recorder.ondataavailable = event => chunks.push(event.data);
      const stopped = new Promise((resolve, reject) => { recorder.onstop = resolve; recorder.onerror = () => reject(new Error("Artificial recording failed")); });
      let frame = 0;
      const timer = setInterval(() => paint(++frame % 2 ? "#186c83" : "#42752c", "FRAME " + frame), 100);
      try {
        recorder.start(); await new Promise(resolve => setTimeout(resolve, 2200)); recorder.stop(); await stopped;
        return { pngP, pngQ, webm: Array.from(new Uint8Array(await new Blob(chunks).arrayBuffer())) };
      } finally { clearInterval(timer); stream.getTracks().forEach(track => track.stop()); }
    });
    return { pngP: Buffer.from(media.pngP, "base64"), pngQ: Buffer.from(media.pngQ, "base64"), webm: Buffer.from(media.webm), producerBrowserVersion: browser.version() };
  } finally { await browser.close(); }
}
