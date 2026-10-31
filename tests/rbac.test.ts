// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import schema from "../convex/schema";

const modules = import.meta.glob("../convex/**/*.ts");

function setup() {
  const t = convexTest(schema, modules);
  const as = (sub: string, name: string, email: string) =>
    t.withIdentity({ subject: sub, name, email, tokenIdentifier: `https://issuer|${sub}` });
  return { t, as };
}

const future = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
const tool = { name: "Drill", category: "power tools" as const, condition: "good" as const, description: "Cordless" };

describe("RBAC enforced in Convex functions", () => {
  beforeEach(() => {
    vi.stubEnv("ADMIN_EMAILS", "admin@lendloop.test");
    // Notifications are scheduled after mutations; keep them inert in tests.
    vi.useFakeTimers();
  });

  it("rejects unauthenticated access to protected queries but allows the public list", async () => {
    const { t } = setup();
    await expect(t.query(api.tools.list, {})).rejects.toThrow(/UNAUTHENTICATED|Sign in/);
    expect(await t.query(api.tools.listPublic, {})).toEqual([]);
  });

  it("public list exposes only name and category", async () => {
    const { t, as } = setup();
    const ana = as("u_ana", "Ana", "ana@x.test");
    await ana.mutation(api.users.ensure, {});
    await ana.mutation(api.tools.create, tool);
    const pub = await t.query(api.tools.listPublic, {});
    expect(pub).toEqual([{ name: "Drill", category: "power tools" }]);
  });

  it("never trusts a client-supplied role; allowlisted email becomes admin", async () => {
    const { as } = setup();
    const user = as("u_bob", "Bob", "bob@x.test");
    await user.mutation(api.users.ensure, {});
    expect((await user.query(api.users.me, {}))?.role).toBe("user");
    const admin = as("u_root", "Root", "admin@lendloop.test");
    await admin.mutation(api.users.ensure, {});
    expect((await admin.query(api.users.me, {}))?.role).toBe("admin");
  });

  it("a demoted admin stays demoted on the next ensure", async () => {
    const { t, as } = setup();
    const admin = as("u_root", "Root", "admin@lendloop.test");
    await admin.mutation(api.users.ensure, {});
    expect((await admin.query(api.users.me, {}))?.role).toBe("admin");
    await t.mutation(internal.users.setRole, { email: "admin@lendloop.test", role: "user" });
    await admin.mutation(api.users.ensure, {}); // next sign-in
    expect((await admin.query(api.users.me, {}))?.role).toBe("user");
  });

  it("only owners edit; admin can remove any listing; others cannot", async () => {
    const { as } = setup();
    const ana = as("u_ana", "Ana", "ana@x.test");
    const bob = as("u_bob", "Bob", "bob@x.test");
    const admin = as("u_root", "Root", "admin@lendloop.test");
    for (const u of [ana, bob, admin]) await u.mutation(api.users.ensure, {});
    const toolId = await ana.mutation(api.tools.create, tool);

    await expect(bob.mutation(api.tools.update, { toolId, ...tool, name: "Hacked" })).rejects.toThrow(/FORBIDDEN|owner/);
    await expect(bob.mutation(api.tools.remove, { toolId })).rejects.toThrow(/FORBIDDEN|Not allowed/);
    await expect(admin.mutation(api.tools.update, { toolId, ...tool, name: "Admin edit" })).rejects.toThrow();
    await admin.mutation(api.tools.remove, { toolId });
    expect(await ana.query(api.tools.mine, {})).toEqual([]);
  });

  it("admin-only endpoints reject normal users", async () => {
    const { as } = setup();
    const bob = as("u_bob", "Bob", "bob@x.test");
    await bob.mutation(api.users.ensure, {});
    await expect(bob.query(api.loans.adminAll, {})).rejects.toThrow();
    await expect(bob.query(api.users.listAll, {})).rejects.toThrow();
    const me = await bob.query(api.users.me, {});
    await expect(bob.mutation(api.users.setTrustedLender, { userId: me!.id, trusted: true })).rejects.toThrow();
  });

  it("only the lender can approve; borrower cannot approve own request; stranger sees nothing", async () => {
    const { as } = setup();
    const ana = as("u_ana", "Ana", "ana@x.test");
    const bob = as("u_bob", "Bob", "bob@x.test");
    const eve = as("u_eve", "Eve", "eve@x.test");
    for (const u of [ana, bob, eve]) await u.mutation(api.users.ensure, {});
    const toolId = await ana.mutation(api.tools.create, tool);

    await expect(ana.mutation(api.loans.request, { toolId, startDate: future(1), endDate: future(2) })).rejects.toThrow(/own tool/);
    const loanId = await bob.mutation(api.loans.request, { toolId, startDate: future(1), endDate: future(2) });

    await expect(bob.mutation(api.loans.decide, { loanId, decision: "approved" })).rejects.toThrow(/lender/);
    await expect(eve.mutation(api.loans.decide, { loanId, decision: "approved" })).rejects.toThrow(/lender/);
    expect(await eve.query(api.loans.incoming, {})).toEqual([]);
    expect(await eve.query(api.loans.myRequests, {})).toEqual([]);

    await ana.mutation(api.loans.decide, { loanId, decision: "approved" });
    await expect(eve.mutation(api.loans.markReturned, { loanId })).rejects.toThrow();
    await ana.mutation(api.loans.markReturned, { loanId });
    expect((await bob.query(api.loans.myRequests, {}))[0].status).toBe("returned");
  });

  it("rejects overlapping approved bookings and invalid dates", async () => {
    const { as } = setup();
    const ana = as("u_ana", "Ana", "ana@x.test");
    const bob = as("u_bob", "Bob", "bob@x.test");
    const cy = as("u_cy", "Cy", "cy@x.test");
    for (const u of [ana, bob, cy]) await u.mutation(api.users.ensure, {});
    const toolId = await ana.mutation(api.tools.create, tool);
    await expect(bob.mutation(api.loans.request, { toolId, startDate: "2020-01-01", endDate: "2020-01-02" })).rejects.toThrow(/past/);

    const a = await bob.mutation(api.loans.request, { toolId, startDate: future(1), endDate: future(3) });
    await ana.mutation(api.loans.decide, { loanId: a, decision: "approved" });
    await expect(cy.mutation(api.loans.request, { toolId, startDate: future(2), endDate: future(4) })).rejects.toThrow(/booked/);
  });

  it("rejects approving a second overlapping request; the first approval stands", async () => {
    const { as } = setup();
    const ana = as("u_ana", "Ana", "ana@x.test");
    const bob = as("u_bob", "Bob", "bob@x.test");
    const cy = as("u_cy", "Cy", "cy@x.test");
    for (const u of [ana, bob, cy]) await u.mutation(api.users.ensure, {});
    const toolId = await ana.mutation(api.tools.create, tool);
    // Both requests are accepted while nothing is approved yet.
    const first = await bob.mutation(api.loans.request, { toolId, startDate: future(1), endDate: future(3) });
    const second = await cy.mutation(api.loans.request, { toolId, startDate: future(2), endDate: future(4) });

    await ana.mutation(api.loans.decide, { loanId: first, decision: "approved" });
    await expect(ana.mutation(api.loans.decide, { loanId: second, decision: "approved" })).rejects.toThrow(/overlap/);
    expect((await cy.query(api.loans.myRequests, {}))[0].status).toBe("requested");
    await ana.mutation(api.loans.decide, { loanId: second, decision: "declined" }); // declining is still fine
  });

  it("rejects approving a request whose end date has passed, but allows declining it", async () => {
    const { t, as } = setup();
    const ana = as("u_ana", "Ana", "ana@x.test");
    const bob = as("u_bob", "Bob", "bob@x.test");
    for (const u of [ana, bob]) await u.mutation(api.users.ensure, {});
    const toolId = await ana.mutation(api.tools.create, tool);
    const loanId = await bob.mutation(api.loans.request, { toolId, startDate: future(1), endDate: future(2) });
    await t.run((ctx) => ctx.db.patch(loanId, { startDate: "2020-01-01", endDate: "2020-01-02" }));

    await expect(ana.mutation(api.loans.decide, { loanId, decision: "approved" })).rejects.toThrow(/expired/);
    await ana.mutation(api.loans.decide, { loanId, decision: "declined" });
    expect((await bob.query(api.loans.myRequests, {}))[0].status).toBe("declined");
  });
});
