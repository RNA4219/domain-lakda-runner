/* global URL, location, crypto, document */
// 両方のローカル HTML へそのまま埋め込む。動画は選択中の実行と照合してから再生する。
export function bindPlayback(player, input, choose, status, onTime) {
  let recording, objectUrl, generation = 0, offset = 0;
  const localViewer = location.protocol === "file:" || (location.protocol === "http:" &&
    location.hostname === "127.0.0.1" && document.documentElement.dataset.consoleOrigin === location.origin);
  function clear() {
    generation++;
    player.pause();
    player.removeAttribute("src");
    player.load();
    player.hidden = true;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    objectUrl = null;
  }
  const unavailable = reason => { status.textContent = "閲覧できない。"+reason; };
  choose.onclick = () => input.click();
  input.onchange = async () => {
    clear();
    const token = generation, file = input.files[0], video = recording;
    if (!video?.allowed || !localViewer) return;
    if (!file) { unavailable("この実行回の MP4 を選んでください。"); return; }
    status.textContent = "動画を照合中…";
    try {
      if (file.size !== video.size) throw Error();
      const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256",await file.arrayBuffer()));
      const hex = Array.from(bytes,b => b.toString(16).padStart(2,"0")).join("");
      if ("sha256:"+hex !== video.hash) throw Error();
      if (token !== generation) return;
      objectUrl = URL.createObjectURL(file);
      player.src = objectUrl;
      player.hidden = false;
      status.textContent = "この実行回の動画と一致しました。";
    } catch { if (token === generation) unavailable("動画を照合できません。この実行回の元ファイルを選んでください。"); }
  };
  player.onloadedmetadata = () => { if (objectUrl) player.currentTime = offset; };
  player.ontimeupdate = () => {
    if (objectUrl && player.readyState >= 1 && !player.seeking) onTime(player.currentTime * 1000);
  };
  player.onerror = () => {
    if (objectUrl && player.error) { clear(); unavailable("照合済みの動画をこのブラウザーで再生できません。"); }
  };
  return {
    fileLocation(file) {
      if (!localViewer || !file) return "";
      const base = location.protocol === "file:" ? location.href : document.documentElement.dataset.localPage;
      if (!base) return file;
      const ref = file.replaceAll("\\","/").split("/").map(encodeURIComponent).join("/");
      const path = decodeURIComponent(new URL(ref, base).pathname);
      return /^\/[A-Za-z]:\//.test(path) ? path.slice(1).replaceAll("/", "\\") : path;
    },
    reset(video, prompt) {
      clear(); recording = video; offset = 0; input.value = "";
      const allowed = !!video?.allowed && localViewer;
      choose.hidden = !allowed;
      if (allowed) status.textContent = prompt;
      else unavailable(video?.unavailable || "この PC でローカルの HTML を開いてください。");
      return allowed;
    },
    seek(seconds) {
      offset = seconds;
      if (objectUrl && player.readyState >= 1) player.currentTime = seconds;
    },
  };
}
