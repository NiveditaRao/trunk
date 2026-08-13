import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  aggregateResults,
  formatAggregateTable,
  formatComparisonTable,
  runScenariosFromDir,
} from "./index.ts";

const here = dirname(fileURLToPath(import.meta.url));
const scenariosDir = resolve(here, "..", "..", "..", "fixtures", "scenarios");
const results = await runScenariosFromDir(scenariosDir);

console.log("Trunk deterministic retrieval/scoping eval");
console.log("");
console.log(
  [
    "Simulation note: no LLM is called.",
    "Each answer is assembled deterministically from the memories available to that condition.",
    "This measures retrieval and scoping behavior, not end-to-end model answer quality.",
  ].join(" "),
);
console.log("");
console.log(formatComparisonTable(results));
console.log("");
console.log(formatAggregateTable(results));
console.log("");

const aggregates = aggregateResults(results);
const trunk = aggregates.find((result) => result.condition === "trunk");
const unforked = aggregates.find((result) => result.condition === "unforked");
const fresh = aggregates.find((result) => result.condition === "fresh-session");
if (trunk && unforked && fresh) {
  const winsContamination =
    trunk.contamination < unforked.contamination &&
    trunk.contamination <= fresh.contamination;
  const winsRetention =
    trunk.retention >= unforked.retention && trunk.retention > fresh.retention;
  console.log(
    `Winner check: trunk contamination=${winsContamination ? "win" : "not a win"}, retention=${winsRetention ? "win" : "not a win"}.`,
  );
}
