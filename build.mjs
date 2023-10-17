import * as esbuild from "esbuild";
import { exec } from 'child_process';

let result = await esbuild.build({
    entryPoints: ["src/main.js"],
    bundle: true,
    loader: {
        ".js": "js"
    },
    splitting: true,
    format: "esm",
    minify: true,
    logLevel: 'info',
    color: true,
    outdir: "dist",
});

exec("node .vscode/pack-zip.js", (err, stdout, stderr) => {
    if (err) {
        console.error(err);
        return;
    }
    console.log(stdout);
});
