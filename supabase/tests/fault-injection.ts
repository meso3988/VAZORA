/* eslint-disable @typescript-eslint/no-explicit-any */
// Test-only fault injection over the NORMAL authenticated Supabase client.
// No service role, no RLS change, no production route: the proxy decides, per
// awaited query, whether to pass it through or replace its result.
//
//   "error" → { data: null, error }                 (returned database error)
//   "throw" → rejected promise                      (network / fetch failure)
//   "zero"  → { data: [], error: null, count: 0 }   (statement ran, matched 0 rows)
//   "empty" → { data: [], error: null }             (read returned nothing)
// An intercepted write is NOT sent to the database.

export type Call = { m: string; args: any[] };
export type Fault = "error" | "throw" | "zero" | "empty" | null;
/** table is the table name, or "rpc:<function>" for RPC calls */
export type Rule = (table: string, calls: Call[]) => Fault;

export function faulty(client: any, rule: Rule): any {
  const wrap = (b: any, table: string, calls: Call[]): any => new Proxy(b, {
    get(target, p) {
      if (p === "then") {
        const r = rule(table, calls);
        if (r === "error") return (res: any) => res({ data: null, error: { message: "injected failure", code: "XX000" }, count: null });
        if (r === "throw") return (_res: any, rej: any) => rej(new TypeError("fetch failed (injected)"));
        if (r === "zero") return (res: any) => res({ data: table.startsWith("rpc:") ? 0 : [], error: null, count: 0 });
        if (r === "empty") return (res: any) => res({ data: [], error: null, count: 0 });
        return target.then.bind(target);
      }
      const v = target[p];
      if (typeof v !== "function") return v;
      return (...args: any[]) => {
        const out = v.apply(target, args);
        return out && typeof out === "object" && typeof out.then === "function" ? wrap(out, table, [...calls, { m: String(p), args }]) : out;
      };
    },
  });
  return new Proxy(client, {
    get: (t, p) => {
      if (p === "from") return (table: string) => wrap(t.from(table), table, []);
      if (p === "rpc") return (fn: string, args: any, opts?: any) => wrap(t.rpc(fn, args, opts), `rpc:${fn}`, [{ m: "rpc", args: [args] }]);
      return Reflect.get(t, p);
    },
  });
}

export const hasCall = (calls: Call[], m: string, pred: (args: any[]) => boolean = () => true) =>
  calls.some((c) => c.m === m && pred(c.args));
