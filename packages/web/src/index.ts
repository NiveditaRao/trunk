/**
 * TRACK C — Web dashboard.
 *
 * Two panes: the branch graph, and the shared memory pool beneath it.
 * Serves static assets from ./public; no bundler required to get started.
 *
 * Deliverables (see plan §9):
 *   C1  Branch graph            — git-style lanes, nodes = checkpoints
 *   C2  Memory pool             — trunk facts visually distinct from branch hypotheses
 *   C3  Provenance lines        — fact -> originating checkpoint, ACROSS lanes
 *   C4  Live updates            — change streams -> WebSocket
 *   C5  Click-to-branch         — POST /api/branch, then show resume("id") to copy
 *
 * C3 is the money shot and the reason this is a web app: a line from a fact in
 * the shared pool up to a checkpoint in a DIFFERENT lane is the entire argument,
 * drawn in one image.
 *
 * Design rule: the memory pool is the hero, not the graph. The screen must make
 * one thing obvious — a fact born in one lane is usable from another, while a
 * hypothesis stays put. Resist polish that doesn't serve that.
 *
 * Unblocked from hour one: render everything from fixtures/ before Tracks A and B land.
 */

import { fileURLToPath } from "node:url";

/** Absolute path to the static assets served by @trunk/server. */
export const PUBLIC_DIR = fileURLToPath(new URL("../public", import.meta.url));
