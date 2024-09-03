const glob = new Bun.Glob("*.ts");
const files = [ ...glob.scanSync({ cwd: "./src/client/ts/", absolute: true }) ];

Bun.build({
    entrypoints: files,
    outdir: "./src/client/compiled/",
    minify: true
});