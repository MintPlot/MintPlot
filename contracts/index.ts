/**
 * MintPlot plugin contract — the single source of truth for the plugin
 * contract trio (manifest / lifecycle / PluginContext) and the extension
 * point catalogs, per ADR-001 v1.0 (17 rulings, ratified 2026-09-27) with the
 * MP additions from spec v1.2 (session kind declarations) and the variable
 * system review v1.0 (three reserved slots).
 *
 * From M1 onward this directory is the contract truth source: the RP line
 * back-follows it, and every manifest / register* call / build-time scan in
 * MP resolves ids and shapes against these catalogs. Nothing here may import
 * from src/ — contracts are the leaf of the dependency graph.
 */

export * from './session-kind'
export * from './extension-points'
export * from './variables'
export * from './permissions'
export * from './manifest'
export * from './lifecycle'
export * from './plugin-context'
export * from './prompt-artifact'
export * from './disposers'
export * from './token-format'
