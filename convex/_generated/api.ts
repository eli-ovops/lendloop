/**
 * Hand-written stand-in for the file normally produced by `npx convex dev`
 * (code generation). Run `npx convex dev` once against your own deployment
 * and Convex will regenerate this file (and server.ts / dataModel.ts) with
 * fully-typed function references. The `anyApi` proxy used here resolves
 * function references by path at runtime, so the app works identically
 * before and after regeneration.
 */
import { anyApi } from "convex/server";

export const api: any = anyApi;
export const internal: any = anyApi;
export const components: any = {};
