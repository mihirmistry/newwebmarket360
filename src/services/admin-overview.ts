import type pg from "pg";

export interface AdminCounts {
  ordersWaiting: number;
  messagesNew: number;
}

export interface AdminOverview extends AdminCounts {
  ordersTotal: number;
  ordersDone: number;
  /** Sum of completed orders, in rupees */
  revenueDone: number;
  ordersLast7Days: number;
  messagesTotal: number;
  recentOrders: Array<{ id: number; planName: string; amount: number; name: string; status: "new" | "done"; createdAt: Date }>;
  recentMessages: Array<{ id: number; name: string; topic: string; status: "new" | "handled"; createdAt: Date }>;
}

/** The two numbers shown as badges in the admin sidebar. */
export async function getAdminCounts(db: pg.Pool): Promise<AdminCounts> {
  const { rows } = await db.query<{ orders: number; messages: number }>(
    `SELECT (SELECT count(*)::int FROM plan_orders WHERE status = 'new') AS orders,
            (SELECT count(*)::int FROM contact_messages WHERE status = 'new') AS messages`
  );
  return { ordersWaiting: rows[0]?.orders ?? 0, messagesNew: rows[0]?.messages ?? 0 };
}

export async function getAdminOverview(db: pg.Pool): Promise<AdminOverview> {
  const [orders, messages, recentOrders, recentMessages] = await Promise.all([
    db.query<{ waiting: number; done: number; total: number; revenue: number; week: number }>(
      `SELECT count(*) FILTER (WHERE status = 'new')::int AS waiting,
              count(*) FILTER (WHERE status = 'done')::int AS done,
              count(*)::int AS total,
              coalesce(sum(amount) FILTER (WHERE status = 'done'), 0)::int AS revenue,
              count(*) FILTER (WHERE created_at > now() - interval '7 days')::int AS week
       FROM plan_orders`
    ),
    db.query<{ fresh: number; total: number }>(
      `SELECT count(*) FILTER (WHERE status = 'new')::int AS fresh, count(*)::int AS total FROM contact_messages`
    ),
    db.query<{ id: string; plan_name: string; amount: number; name: string; status: "new" | "done"; created_at: Date }>(
      `SELECT id, plan_name, amount, name, status, created_at FROM plan_orders ORDER BY created_at DESC LIMIT 5`
    ),
    db.query<{ id: string; name: string; topic: string; status: "new" | "handled"; created_at: Date }>(
      `SELECT id, name, topic, status, created_at FROM contact_messages ORDER BY created_at DESC LIMIT 5`
    ),
  ]);
  const o = orders.rows[0]!;
  const m = messages.rows[0]!;
  return {
    ordersWaiting: o.waiting,
    ordersDone: o.done,
    ordersTotal: o.total,
    revenueDone: o.revenue,
    ordersLast7Days: o.week,
    messagesNew: m.fresh,
    messagesTotal: m.total,
    recentOrders: recentOrders.rows.map((r) => ({ id: Number(r.id), planName: r.plan_name, amount: r.amount, name: r.name, status: r.status, createdAt: r.created_at })),
    recentMessages: recentMessages.rows.map((r) => ({ id: Number(r.id), name: r.name, topic: r.topic, status: r.status, createdAt: r.created_at })),
  };
}
