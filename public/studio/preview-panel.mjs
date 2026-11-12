export function previewMessage(event, iframe, artifact) {
  const d = event.data;
  return (
    !!iframe &&
    !!artifact &&
    event.source === iframe.contentWindow &&
    event.origin === "null" &&
    d &&
    d.source === "nickyoung-preview" &&
    d.artifactId === artifact.artifactId &&
    d.version === artifact.artifactVersion &&
    ["ready", "error", "heartbeat"].includes(d.type) &&
    typeof d.message === "string" &&
    d.message.length <= 1000
  );
}
export class PreviewPanel {
  constructor(element, { api, escape }) {
    Object.assign(this, { element, api, escape });
    this.selected = new Map();
    this.follow = new Map();
    this.current = null;
    this.loadedKey = null;
    element.innerHTML =
      '<div class="ny-preview-toolbar"><button data-generate>生成 / 检查预览</button><label>版本 <select data-version aria-label="预览版本"></select></label><label><input data-follow type="checkbox">跟随最新</label><button data-reload>刷新画面</button><a data-open target="_blank" rel="noopener">打开大图</a><a data-download>下载作品</a><a data-source>下载源码</a></div><p data-preview-state role="status"></p><p data-provenance class="ny-small"></p><div data-frame></div><details><summary>截图与检查附件</summary><div data-artifact-evidence></div></details>';
    this.q = (s) => element.querySelector(s);
    this.q("[data-generate]").onclick = async () => {
      const c = this.current?.id;
      if (!c) return;
      const b = this.q("[data-generate]");
      b.disabled = true;
      this.q("[data-preview-state]").textContent =
        "正在整理预览，保留上次成功画面…";
      try {
        const data = await api(`conversations/${c}/preview`, {});
        if (this.current?.id === c) {
          this.current.artifacts = data.artifacts;
          this.current.preview = data.preview;
          this.update(this.current);
        }
      } catch (error) {
        if (this.current?.id === c)
          this.q("[data-preview-state]").textContent = error.message;
      } finally {
        b.disabled = false;
      }
    };
    this.q("[data-version]").onchange = (e) => {
      this.selected.set(this.current.id, e.target.value);
      this.follow.set(this.current.id, false);
      this.update(this.current);
    };
    this.q("[data-follow]").onchange = (e) => {
      this.follow.set(this.current.id, e.target.checked);
      this.update(this.current);
    };
    this.q("[data-reload]").onclick = () => {
      this.loadedKey = null;
      this.update(this.current);
    };
    addEventListener("message", (event) => {
      if (!previewMessage(event, this.frame, this.artifact)) return;
      if (event.data.type === "error") {
        this.runtimeError = event.data.message;
        this.q("[data-preview-state]").textContent =
          "画面运行问题：" + this.runtimeError;
      } else if (event.data.type === "ready" && !this.runtimeError)
        this.q("[data-preview-state]").textContent += this.q(
          "[data-preview-state]",
        ).textContent.includes("画面已加载")
          ? ""
          : " · 画面已加载";
    });
  }
  update(s) {
    if (!s) return;
    this.current = s;
    const list = (s.artifacts || []).filter(
      (a) => a.kind === "static_page" && a.status === "ready",
    );
    const latest = list.at(-1);
    if (!this.selected.has(s.id) && latest)
      this.selected.set(s.id, latest.artifactId);
    if (this.follow.get(s.id) && latest)
      this.selected.set(s.id, latest.artifactId);
    const a =
      list.find((a) => a.artifactId === this.selected.get(s.id)) || latest;
    this.artifact = a;
    const select = this.q("[data-version]"),
      options = list
        .map(
          (a) =>
            `<option value="${this.escape(a.artifactId)}">v${a.artifactVersion} · ${a.validationStatus === "verified" ? "已验收" : "草稿"}</option>`,
        )
        .join("");
    if (select.innerHTML !== options) select.innerHTML = options;
    if (a) select.value = a.artifactId;
    this.q("[data-follow]").checked = !!this.follow.get(s.id);
    const url = (artifact, mode) =>
      `/api/conversations/${encodeURIComponent(s.id)}/artifacts/${encodeURIComponent(artifact.artifactId)}/${mode}`;
    const notice =
      s.preview?.status === "building"
        ? "新版本构建中，当前显示上次成功版本"
        : s.preview?.status === "failed"
          ? "构建失败，保留上次成功版本：" + s.preview.reason
          : latest && a && a.artifactId !== latest.artifactId
            ? "有新版本，可选择切换；当前保留历史画面"
            : s.preview?.reason ||
              "尚无可用产物，可生成静态预览或查看文件与改动";
    this.q("[data-preview-state]").textContent =
      (a
        ? (a.validationStatus === "verified"
            ? "此快照已验收"
            : "草稿 · 尚未验收") + " · "
        : "") + notice;
    this.q("[data-provenance]").textContent = a
      ? `v${a.artifactVersion} · ${new Date(a.createdAt).toLocaleString()} · ${a.sourceCommit ? "来源提交 " + a.sourceCommit.slice(0, 12) : "来源提交未确认"} · 会话 ${s.workflowVersion || "legacy"}`
      : "";
    for (const [selector, mode] of [
      ["[data-open]", "content"],
      ["[data-download]", "download"],
      ["[data-source]", "source"],
    ]) {
      const n = this.q(selector);
      n.hidden = !a || (mode === "source" && !a.hasSource);
      if (a) n.href = url(a, mode);
    }
    const key = s.id + ":" + (a?.artifactId || "none");
    if (key !== this.loadedKey) {
      this.loadedKey = key;
      this.runtimeError = null;
      const box = this.q("[data-frame]");
      box.replaceChildren();
      this.frame = null;
      if (a) {
        const frame = document.createElement("iframe");
        frame.className = "ny-preview-frame";
        frame.title = a.title || "作品预览";
        frame.setAttribute("sandbox", "allow-scripts");
        frame.referrerPolicy = "no-referrer";
        frame.src = url(a, "content");
        this.frame = frame;
        box.append(frame);
      } else {
        const p = document.createElement("p");
        p.className = "ny-preview-empty";
        p.textContent =
          s.preview?.reason ||
          "尚无可展示的静态页面。需要后端或登录态的产物请查看文件与下载。";
        box.append(p);
      }
    }
    this.q("[data-artifact-evidence]").innerHTML =
      (s.artifacts || [])
        .filter((a) => a.kind !== "static_page")
        .slice(-40)
        .map(
          (a) =>
            `<a target="_blank" rel="noopener" href="${url(a, "content")}">${this.escape(a.title)} · ${a.validationStatus === "verified" ? "已验收" : "附件"}</a>`,
        )
        .join("") || '<p class="ny-small">暂无已登记附件。</p>';
  }
}
