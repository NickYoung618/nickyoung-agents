import { parse, parseFragment, serialize } from "parse5";
import { build } from "esbuild";
import { readFileSync, realpathSync, statSync, lstatSync } from "node:fs";
import { resolve, relative, sep, extname, dirname } from "node:path";
export function safeFile(root, path) {
  const base = realpathSync(root),
    absolute = resolve(root, path);
  const rel = relative(base, absolute);
  if (rel.startsWith(".." + sep) || rel === ".." || resolve(absolute) === base)
    throw Error("产物路径越界");
  const parts = rel.split(sep);
  if (
    parts.some(
      (p) =>
        p === ".git" ||
        p === "node_modules" ||
        p.startsWith(".env") ||
        /\.(pem|key)$/i.test(p),
    )
  )
    throw Error("产物路径包含不允许的文件");
  let parent = base;
  for (const part of parts) {
    parent = resolve(parent, part);
    if (lstatSync(parent).isSymbolicLink()) throw Error("产物不允许符号链接");
  }
  const actual = realpathSync(absolute);
  if (!actual.startsWith(base + sep) || !statSync(actual).isFile())
    throw Error("产物路径不合法");
  if (statSync(actual).size > 8 * 1024 * 1024)
    throw Error("单个产物文件超过 8 MiB");
  return actual;
}
const mime = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};
const attrs = (n) =>
  Object.fromEntries((n.attrs || []).map((a) => [a.name, a.value]));
const text = (n) =>
  (n.childNodes || [])
    .filter((x) => x.nodeName === "#text")
    .map((x) => x.value)
    .join("");
const replace = (n, html) => {
  const p = n.parentNode,
    i = p.childNodes.indexOf(n),
    nodes = parseFragment(html).childNodes;
  for (const x of nodes) x.parentNode = p;
  p.childNodes.splice(i, 1, ...nodes);
};
export async function bundleStatic(root, entry = "index.html") {
  const file = safeFile(root, entry),
    doc = parse(readFileSync(file, "utf8"));
  let total = 0;
  const asset = (url) => {
    if (/^(?:data:|#)/i.test(url)) return url;
    if (/^[a-z][\w+.-]*:|^\/\//i.test(url))
      throw Error("静态预览不支持外部资源，需要运行服务的产物请使用文件下载");
    return safeFile(
      root,
      decodeURIComponent(url.split(/[?#]/)[0]).replace(/^\//, ""),
    );
  };
  const options = {
    absWorkingDir: realpathSync(root),
    bundle: true,
    write: false,
    platform: "browser",
    format: "iife",
    target: "es2022",
    logLevel: "silent",
    legalComments: "none",
    outdir: resolve(root, "__preview_output__"),
    tsconfigRaw: { compilerOptions: {} },
    loader: Object.fromEntries(Object.keys(mime).map((e) => [e, "dataurl"])),
    plugins: [
      {
        name: "preview-boundary",
        setup(b) {
          b.onResolve({ filter: /^(?:https?:|\/\/|file:)/ }, () => ({
            errors: [{ text: "不支持外部模块或文件协议" }],
          }));
          b.onLoad({ filter: /.*/ }, (args) => {
            const f = safeFile(root, args.path);
            total += statSync(f).size;
            if (total > 32 * 1024 * 1024) throw Error("预览输入超过 32 MiB");
            return undefined;
          });
        },
      },
    ],
  };
  const nodes = [];
  function walk(n) {
    nodes.push(n);
    for (const c of n.childNodes || []) walk(c);
  }
  walk(doc);
  for (const n of nodes) {
    if (!n.parentNode) continue;
    const a = attrs(n);
    if (
      n.tagName === "base" ||
      (n.tagName === "link" &&
        ["modulepreload", "preload", "prefetch"].includes(a.rel))
    ) {
      replace(n, "");
      continue;
    }
    if (
      n.tagName === "script" &&
      (!a.type ||
        ["module", "text/javascript", "application/javascript"].includes(
          a.type,
        ))
    ) {
      const result = await build({
        ...options,
        ...(a.src
          ? { entryPoints: [asset(a.src)] }
          : { stdin: { contents: text(n), resolveDir: root, loader: "js" } }),
      });
      const js =
        result.outputFiles.find((f) => f.path.endsWith(".js"))?.text || "";
      const css = result.outputFiles
        .filter((f) => f.path.endsWith(".css"))
        .map((f) => f.text)
        .join("\n");
      replace(
        n,
        `${css ? "<style>" + css.replace(/<\/style/gi, "<\\/style") + "</style>" : ""}<script>${js.replace(/<\/script/gi, "<\\/script")}</script>`,
      );
    } else if (n.tagName === "link" && a.rel === "stylesheet") {
      const r = await build({ ...options, entryPoints: [asset(a.href)] });
      replace(
        n,
        "<style>" +
          r.outputFiles
            .map((f) => f.text)
            .join("\n")
            .replace(/<\/style/gi, "<\\/style") +
          "</style>",
      );
    } else if (["img", "source", "link"].includes(n.tagName)) {
      for (const field of ["src", "href"])
        if (a[field] && !(n.tagName === "link" && a.rel !== "icon")) {
          const f = asset(a[field]);
          if (f.startsWith("data:") || f.startsWith("#")) continue;
          if (!mime[extname(f)]) throw Error("不支持的静态资源类型");
          n.attrs.find((x) => x.name === field).value =
            `data:${mime[extname(f)]};base64,${readFileSync(f).toString("base64")}`;
        }
      if (a.srcset)
        throw Error("此静态适配器暂不支持 srcset，请提供自包含构建产物");
    }
  }
  const html = serialize(doc);
  if (Buffer.byteLength(html) > 8 * 1024 * 1024)
    throw Error("预览产物超过 8 MiB");
  return html;
}
export const previewCsp =
  "sandbox allow-scripts; default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'";
export function instrumentPreview(html, artifact) {
  const payload = JSON.stringify({
    source: "nickyoung-preview",
    artifactId: artifact.artifactId,
    version: artifact.artifactVersion,
  }).replaceAll("<", "\\u003c");
  const script = `(()=>{const identity=${payload};const send=(type,message='')=>{if(parent!==window)parent.postMessage({...identity,type,message:String(message).slice(0,1000)},'*')};addEventListener('error',e=>send('error',e.message||'资源载入失败'));addEventListener('unhandledrejection',e=>send('error',e.reason?.message||e.reason));addEventListener('securitypolicyviolation',e=>send('error','预览限制了 '+e.violatedDirective));addEventListener('DOMContentLoaded',()=>send('ready'));setInterval(()=>send('heartbeat'),15000)})();`;
  const doc = parse(html),
    head = doc.childNodes
      .find((x) => x.tagName === "html")
      ?.childNodes.find((x) => x.tagName === "head");
  const node = parseFragment("<script>" + script + "</script>").childNodes[0];
  node.parentNode = head;
  head.childNodes.unshift(node);
  return serialize(doc);
}
