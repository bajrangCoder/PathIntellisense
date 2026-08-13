import * as esbuild from "esbuild";
import { execFile } from "node:child_process";

const isServe = process.argv.includes("--serve");

function packZip() {
  execFile(process.execPath, ["./pack-zip.js"], (err, stdout) => {
    if (err) {
      console.error("Error packing zip:", err);
      return;
    }
    console.log(stdout.trim());
  });
}

const zipPlugin = {
  name: "zip-plugin",
  setup(build) {
    build.onEnd(() => {
      packZip();
    });
  },
};

const buildConfig = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  minify: true,
  platform: "browser",
  format: "iife",
  logLevel: "info",
  color: true,
  outdir: "dist",
  plugins: [zipPlugin],
};

(async function () {
  if (isServe) {
    console.log("Starting development server...");

    const ctx = await esbuild.context(buildConfig);
    await ctx.watch();
    const { host, port } = await ctx.serve({
      servedir: ".",
      port: 3000,
    });
    console.log(`Development server: http://${host}:${port}`);
  } else {
    console.log("Building for production...");
    await esbuild.build(buildConfig);
    console.log("Production build complete.");
  }
})();
