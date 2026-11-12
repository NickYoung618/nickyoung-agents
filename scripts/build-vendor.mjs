import { build } from "esbuild";
await build({
  entryPoints: ["scripts/vendor-entry.mjs"],
  bundle: true,
  format: "esm",
  minify: true,
  outfile: "public/vendor.mjs",
  legalComments: "eof",
});
