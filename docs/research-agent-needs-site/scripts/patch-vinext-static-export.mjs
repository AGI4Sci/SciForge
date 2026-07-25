import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const vinextPrerenderPath = fileURLToPath(
  new URL("../node_modules/vinext/dist/build/prerender.js", import.meta.url),
);

const original =
  "const url = `${baseUrl}${parsed.pathname}${parsed.search}`;";
const patched = `const basePath = config.basePath ?? "";
\t\t\tconst requestPath = basePath && !parsed.pathname.startsWith(basePath) ? \`\${basePath}\${parsed.pathname}\` : parsed.pathname;
\t\t\tconst url = \`\${baseUrl}\${requestPath}\${parsed.search}\`;`;

const source = await readFile(vinextPrerenderPath, "utf8");

if (source.includes(patched)) {
  process.exit(0);
}

const occurrences = source.split(original).length - 1;
if (occurrences !== 1) {
  throw new Error(
    `Expected one vinext prerender URL builder, found ${occurrences}. Review the patch before publishing.`,
  );
}

await writeFile(vinextPrerenderPath, source.replace(original, patched));
