export type Product = {
  id: string;
  name: string;
  category: string;
  price: number;
  stock: number;
};

export const products: Product[] = [
  { id: '1', name: 'Classic Burger', category: 'Food', price: 9.99, stock: 42 },
  { id: '2', name: 'Fish Sandwich', category: 'Food', price: 11.99, stock: 20 },
  { id: '3', name: 'Loaded Fries', category: 'Sides', price: 6.99, stock: 55 },
  { id: '4', name: 'Soda', category: 'Drinks', price: 2.5, stock: 100 },
  { id: '5', name: 'Lawn Cut Service', category: 'Service', price: 45, stock: 999 },
  { id: '6', name: 'Line Up', category: 'Barber', price: 20, stock: 999 }
];

export const orders = [
  { id: '1001', customer: 'Walk-in', total: 24.87, status: 'Paid', method: 'Cash', time: '10:42 AM' },
  { id: '1002', customer: 'Maria G.', total: 52.1, status: 'Paid', method: 'Card', time: '11:15 AM' },
  { id: '1003', customer: 'Walk-in', total: 12.49, status: 'Open', method: 'Pending', time: '11:37 AM' }
];
