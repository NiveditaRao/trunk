import { readFileSync } from "node:fs";
import { computeLayout } from "../public/graph.js";

function fixture(name) {
  return JSON.parse(readFileSync(new URL(`../../../fixtures/${name}.json`, import.meta.url), "utf8"));
}

const branches = fixture("branches");
const checkpoints = fixture("checkpoints");
const layout = computeLayout({ branches, checkpoints });

console.log(JSON.stringify({
  lanes: Object.fromEntries(layout.lanes),
  fork: {
    child: "cp_005",
    parent: layout.nodeById.get("cp_005")?.parent_id,
    parentLane: layout.nodeById.get(layout.nodeById.get("cp_005")?.parent_id)?.lane,
    childLane: layout.nodeById.get("cp_005")?.lane,
  },
  nodes: layout.nodes.map((node) => ({ id: node._id, branch: node.branch_id, lane: node.lane, x: node.x, y: node.y })),
}, null, 2));

