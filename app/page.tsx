'use client';

import { useMemo, useState } from 'react';
import { BarChart3, Boxes, CreditCard, Home, Menu, Plus, Receipt, Search, Settings, ShoppingCart, Users } from 'lucide-react';
import { orders, products, Product } from '@/lib/mockData';

type CartItem = Product & { qty: number };
const taxRate = 0.0825;

function money(value: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value);
}

export default function VallaPOS() {
  const [cart, setCart] = useState<CartItem[]>([]);
  const [tip, setTip] = useState(0);
  const [discount, setDiscount] = useState(0);
  const [query, setQuery] = useState('');

  const filtered = products.filter((p) =>
    `${p.name} ${p.category}`.toLowerCase().includes(query.toLowerCase())
  );

  const subtotal = cart.reduce((sum, item) => sum + item.price * item.qty, 0);
  const tax = Math.max(subtotal - discount, 0) * taxRate;
  const total = Math.max(subtotal - discount, 0) + tax + tip;

  const todayRevenue = useMemo(() => orders.reduce((sum, order) => sum + order.total, 0) + total, [total]);

  function addToCart(product: Product) {
    setCart((current) => {
      const existing = current.find((item) => item.id === product.id);
      if (existing) {
        return current.map((item) => item.id === product.id ? { ...item, qty: item.qty + 1 } : item);
      }
      return [...current, { ...product, qty: 1 }];
    });
  }

  function changeQty(id: string, amount: number) {
    setCart((current) =>
      current
        .map((item) => item.id === id ? { ...item, qty: item.qty + amount } : item)
        .filter((item) => item.qty > 0)
    );
  }

  function completeSale() {
    alert(`Payment marked paid: ${money(total)}`);
    setCart([]);
    setTip(0);
    setDiscount(0);
  }

  return (
    <main className="min-h-screen bg-slate-100 text-slate-950">
      <div className="flex min-h-screen">
        <aside className="hidden w-64 flex-col bg-slate-950 p-5 text-white lg:flex">
          <div className="mb-8">
            <div className="text-2xl font-black tracking-tight">VallaPOS</div>
            <p className="mt-1 text-sm text-slate-300">Just log in and sell.</p>
          </div>
          <nav className="space-y-2 text-sm">
            {[
              [Home, 'Dashboard'],
              [ShoppingCart, 'Checkout'],
              [Receipt, 'Orders'],
              [Boxes, 'Inventory'],
              [Users, 'Customers'],
              [BarChart3, 'Reports'],
              [Settings, 'Settings']
            ].map(([Icon, label]) => (
              <button key={String(label)} className="flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-slate-200 hover:bg-white/10">
                {/* @ts-ignore */}
                <Icon size={18} /> {String(label)}
              </button>
            ))}
          </nav>
          <div className="mt-auto rounded-2xl bg-white/10 p-4 text-sm text-slate-200">
            <p className="font-semibold text-white">Starter Plan</p>
            <p className="mt-1">Browser POS for mobile and local businesses.</p>
          </div>
        </aside>

        <section className="flex-1 p-4 md:p-6">
          <header className="mb-6 flex items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-black md:text-3xl">Checkout</h1>
              <p className="text-sm text-slate-500">Food trucks, barbers, lawn care, vendors, and service businesses.</p>
            </div>
            <button className="rounded-2xl bg-slate-950 p-3 text-white lg:hidden"><Menu /></button>
          </header>

          <div className="mb-6 grid gap-4 md:grid-cols-4">
            <Stat title="Today Revenue" value={money(todayRevenue)} />
            <Stat title="Orders" value="3" />
            <Stat title="Avg Ticket" value={money(29.82)} />
            <Stat title="Open Tickets" value="1" />
          </div>

          <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
            <div className="rounded-3xl bg-white p-4 shadow-sm md:p-5">
              <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                <div>
                  <h2 className="text-xl font-bold">Products & Services</h2>
                  <p className="text-sm text-slate-500">Tap an item to add it to the cart.</p>
                </div>
                <div className="flex items-center gap-2 rounded-2xl border bg-white px-3 py-2">
                  <Search size={18} className="text-slate-400" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search items" className="w-full outline-none" />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {filtered.map((product) => (
                  <button key={product.id} onClick={() => addToCart(product)} className="rounded-3xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:-translate-y-0.5 hover:bg-white hover:shadow-md">
                    <div className="mb-8 flex items-center justify-between">
                      <span className="rounded-full bg-slate-900 px-3 py-1 text-xs font-semibold text-white">{product.category}</span>
                      <Plus size={18} />
                    </div>
                    <h3 className="font-bold">{product.name}</h3>
                    <p className="mt-1 text-2xl font-black">{money(product.price)}</p>
                    <p className="mt-2 text-xs text-slate-500">Stock: {product.stock}</p>
                  </button>
                ))}
              </div>
            </div>

            <aside className="rounded-3xl bg-white p-4 shadow-sm md:p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-xl font-bold">Current Cart</h2>
                  <p className="text-sm text-slate-500">Order #1004</p>
                </div>
                <CreditCard className="text-slate-700" />
              </div>

              <div className="min-h-48 space-y-3">
                {cart.length === 0 && <p className="rounded-2xl bg-slate-50 p-4 text-sm text-slate-500">Cart is empty. Add an item to start a sale.</p>}
                {cart.map((item) => (
                  <div key={item.id} className="flex items-center justify-between rounded-2xl border p-3">
                    <div>
                      <p className="font-semibold">{item.name}</p>
                      <p className="text-sm text-slate-500">{money(item.price)} each</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button onClick={() => changeQty(item.id, -1)} className="h-8 w-8 rounded-full bg-slate-100">-</button>
                      <span className="w-5 text-center font-bold">{item.qty}</span>
                      <button onClick={() => changeQty(item.id, 1)} className="h-8 w-8 rounded-full bg-slate-900 text-white">+</button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="mt-5 space-y-3 border-t pt-4 text-sm">
                <Row label="Subtotal" value={money(subtotal)} />
                <Row label="Discount" value={`-${money(discount)}`} />
                <Row label="Tax" value={money(tax)} />
                <Row label="Tip" value={money(tip)} />
                <div className="flex gap-2">
                  {[0, 2, 5, 10].map((value) => (
                    <button key={value} onClick={() => setTip(value)} className="flex-1 rounded-xl bg-slate-100 px-3 py-2 font-semibold hover:bg-slate-200">{value === 0 ? 'No Tip' : `$${value}`}</button>
                  ))}
                </div>
                <button onClick={() => setDiscount(discount === 0 ? 5 : 0)} className="w-full rounded-xl bg-slate-100 px-3 py-2 font-semibold hover:bg-slate-200">
                  {discount === 0 ? 'Apply $5 Discount' : 'Remove Discount'}
                </button>
                <div className="flex items-center justify-between pt-3 text-2xl font-black">
                  <span>Total</span><span>{money(total)}</span>
                </div>
                <button disabled={cart.length === 0} onClick={completeSale} className="mt-3 w-full rounded-2xl bg-green-600 px-5 py-4 text-lg font-black text-white disabled:cursor-not-allowed disabled:bg-slate-300">
                  Mark Paid
                </button>
                <button className="w-full rounded-2xl border px-5 py-3 font-bold">Save Open Ticket</button>
              </div>
            </aside>
          </div>

          <section className="mt-6 rounded-3xl bg-white p-4 shadow-sm md:p-5">
            <h2 className="mb-4 text-xl font-bold">Recent Orders</h2>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead className="text-slate-500"><tr><th className="p-3">Order</th><th>Customer</th><th>Total</th><th>Status</th><th>Method</th><th>Time</th></tr></thead>
                <tbody>
                  {orders.map((order) => (
                    <tr key={order.id} className="border-t"><td className="p-3 font-bold">#{order.id}</td><td>{order.customer}</td><td>{money(order.total)}</td><td>{order.status}</td><td>{order.method}</td><td>{order.time}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </section>
      </div>
    </main>
  );
}

function Stat({ title, value }: { title: string; value: string }) {
  return <div className="rounded-3xl bg-white p-4 shadow-sm"><p className="text-sm text-slate-500">{title}</p><p className="mt-1 text-2xl font-black">{value}</p></div>;
}

function Row({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between"><span className="text-slate-500">{label}</span><span className="font-bold">{value}</span></div>;
}
