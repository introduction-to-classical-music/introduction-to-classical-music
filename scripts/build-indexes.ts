import { writeGeneratedArtifacts } from "../packages/data-core/src/library-store.js";

async function main() {
  // Developer/maintenance index build (used by `npm run dev`): this feeds the
  // local Astro dev server, so keep local resource links. Only the packaged seed
  // site and public release exports use the public (stripped) mode.
  const { indexes } = await writeGeneratedArtifacts({ siteOutputMode: "local" });

  process.stdout.write(
    `Built indexes for ${indexes.stats.composerCount} composers, ${indexes.stats.workCount} works, ${indexes.stats.recordingCount} recordings.\n`,
  );
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  process.exitCode = 1;
});

