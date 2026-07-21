/**
 * Environment preloader — must run before any other module.
 * Loaded via `node --import ./dist/env.mjs` so it executes before module
 * graph evaluation begins.
 *
 * Behaviour:
 *  - On Replit: env vars are already injected by the platform; override:false
 *    means they are never clobbered, PORT stays as set by the workflow command.
 *  - On production VPS (PM2 + .env): dotenv reads the file and populates
 *    process.env including PORT.
 *  - If no .env file is present (Replit, CI, Docker with --env-file): dotenv
 *    silently returns {parsed: undefined} — no throw, no side-effects.
 */
import { config } from "dotenv";

config({ override: false });
