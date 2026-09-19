// Custom ESM resolve hook: `server-only` → empty module.
export async function resolve(specifier, context, next) {
  if (specifier === "server-only") {
    return { url: new URL("./server-only.stub.mjs", import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
