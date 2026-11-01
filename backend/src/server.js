import 'dotenv/config';
import cors from 'cors';
import express from 'express';
import { pool } from './db.js';

const app = express();
const port = Number(process.env.PORT || 3001);

app.use(cors());
app.use(express.json());

const resources = {
  products: {
    table: 'products',
    columns: ['name', 'type', 'price', 'cost', 'stock', 'active'],
    defaults: { active: 1, type: 'product', price: 0 },
    filter: 'active = TRUE',
    order: 'name ASC',
  },
  customers: {
    table: 'customers',
    columns: ['name', 'document', 'phone', 'email', 'address'],
    order: 'name ASC',
  },
  bankAccounts: {
    table: 'bank_accounts',
    columns: ['bank_name', 'account_name', 'account_type', 'initial_balance', 'active'],
    defaults: { active: 1, account_type: 'checking', initial_balance: 0 },
    filter: 'active = TRUE',
    order: 'account_name ASC',
  },
  expenses: {
    table: 'expenses',
    columns: ['description', 'category', 'amount', 'expense_date', 'status', 'bank_account_id'],
    defaults: { status: 'pending' },
    order: 'expense_date DESC, id DESC',
  },
  transactions: {
    table: 'cash_transactions',
    columns: ['bank_account_id', 'type', 'category', 'description', 'amount', 'transaction_date', 'order_id', 'expense_id'],
    order: 'transaction_date DESC, id DESC',
  },
};

function validatePayload(config, body) {
  const required = config.columns.filter((column) =>
    ['name', 'description', 'category', 'amount', 'expense_date', 'transaction_date', 'bank_name', 'account_name', 'price', 'type'].includes(column)
  );

  const missingRequired = required.filter((column) => {
    const value = body[column];
    return value === undefined || value === null || value === '';
  });

  if (missingRequired.length) {
    const error = new Error(`Campos obrigatórios: ${missingRequired.join(', ')}`);
    error.status = 400;
    throw error;
  }

  if (body.price !== undefined && body.price !== null && Number(body.price) < 0) {
    const error = new Error('O preço não pode ser negativo.');
    error.status = 400;
    throw error;
  }

  if (body.amount !== undefined && body.amount !== null && Number(body.amount) < 0) {
    const error = new Error('O valor não pode ser negativo.');
    error.status = 400;
    throw error;
  }

  if (body.type && config.table === 'products' && !['product', 'service'].includes(body.type)) {
    const error = new Error('Tipo inválido para produto/serviço.');
    error.status = 400;
    throw error;
  }
}

function normalizeValue(value) {
  if (value === '' || value === undefined) return null;
  return value;
}

function registerCrudRoutes(key, config) {
  const base = `/api/${key}`;

  app.get(base, async (_req, res, next) => {
    try {
      const filter = config.filter ? ` WHERE ${config.filter}` : '';
      const [rows] = await pool.query(`SELECT * FROM ${config.table}${filter} ORDER BY ${config.order}`);
      res.json(rows);
    } catch (error) {
      next(error);
    }
  });

  app.get(`${base}/:id`, async (req, res, next) => {
    try {
      const filter = config.filter ? ` AND ${config.filter}` : '';
      const [rows] = await pool.query(`SELECT * FROM ${config.table} WHERE id = ?${filter}`, [req.params.id]);
      if (!rows.length) {
        return res.status(404).json({ message: 'Registro não encontrado.' });
      }
      res.json(rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.post(base, async (req, res, next) => {
    try {
      validatePayload(config, req.body);
      const values = config.columns.map((column) =>
        normalizeValue(req.body[column] === undefined ? config.defaults?.[column] : req.body[column])
      );
      const placeholders = config.columns.map(() => '?').join(', ');
      const [result] = await pool.query(
        `INSERT INTO ${config.table} (${config.columns.join(', ')}) VALUES (${placeholders})`,
        values
      );

      // Sincronização automática: se for despesa paga vinculada a conta bancária, registra saída no fluxo de caixa
      if (key === 'expenses' && req.body.status === 'paid' && req.body.bank_account_id) {
        await pool.query(
          'INSERT INTO cash_transactions (bank_account_id, type, category, description, amount, transaction_date, expense_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [
            req.body.bank_account_id,
            'outcome',
            req.body.category || 'Despesas',
            req.body.description,
            req.body.amount,
            req.body.expense_date,
            result.insertId,
          ]
        );
      }

      const [rows] = await pool.query(`SELECT * FROM ${config.table} WHERE id = ?`, [result.insertId]);
      res.status(201).json(rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.put(`${base}/:id`, async (req, res, next) => {
    try {
      const [existingRows] = await pool.query(`SELECT * FROM ${config.table} WHERE id = ?`, [req.params.id]);
      if (!existingRows.length) {
        return res.status(404).json({ message: 'Registro não encontrado.' });
      }
      const existing = existingRows[0];

      // Mescla os dados existentes com os novos para preservar campos omitidos (como active)
      const merged = { ...existing };
      for (const col of config.columns) {
        if (req.body[col] !== undefined) {
          merged[col] = req.body[col];
        }
      }

      validatePayload(config, merged);
      const values = config.columns.map((column) => normalizeValue(merged[column]));
      const updates = config.columns.map((column) => `${column} = ?`).join(', ');
      await pool.query(`UPDATE ${config.table} SET ${updates} WHERE id = ?`, [...values, req.params.id]);

      // Sincronização de despesas no fluxo de caixa
      if (key === 'expenses') {
        const [existingTx] = await pool.query('SELECT id FROM cash_transactions WHERE expense_id = ?', [req.params.id]);
        if (merged.status === 'paid' && merged.bank_account_id) {
          if (!existingTx.length) {
            await pool.query(
              'INSERT INTO cash_transactions (bank_account_id, type, category, description, amount, transaction_date, expense_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
              [merged.bank_account_id, 'outcome', merged.category || 'Despesas', merged.description, merged.amount, merged.expense_date, req.params.id]
            );
          } else {
            await pool.query(
              'UPDATE cash_transactions SET bank_account_id = ?, amount = ?, transaction_date = ?, description = ? WHERE id = ?',
              [merged.bank_account_id, merged.amount, merged.expense_date, merged.description, existingTx[0].id]
            );
          }
        } else if (existingTx.length) {
          // Se deixou de ser pago ou removeu a conta, remove a saída do caixa
          await pool.query('DELETE FROM cash_transactions WHERE id = ?', [existingTx[0].id]);
        }
      }

      const [rows] = await pool.query(`SELECT * FROM ${config.table} WHERE id = ?`, [req.params.id]);
      res.json(rows[0]);
    } catch (error) {
      next(error);
    }
  });

  app.delete(`${base}/:id`, async (req, res, next) => {
    try {
      if (key === 'products') {
        const [[usage]] = await pool.query('SELECT COUNT(*) AS count FROM order_items WHERE product_id = ?', [req.params.id]);
        if (usage.count > 0) {
          const [result] = await pool.query('UPDATE products SET active = FALSE WHERE id = ?', [req.params.id]);
          if (!result.affectedRows) return res.status(404).json({ message: 'Registro não encontrado.' });
          return res.status(204).end();
        }
      }

      if (key === 'bankAccounts') {
        const [[txUsage]] = await pool.query('SELECT COUNT(*) AS count FROM cash_transactions WHERE bank_account_id = ?', [req.params.id]);
        const [[expUsage]] = await pool.query('SELECT COUNT(*) AS count FROM expenses WHERE bank_account_id = ?', [req.params.id]);
        if (txUsage.count > 0 || expUsage.count > 0) {
          const [result] = await pool.query('UPDATE bank_accounts SET active = FALSE WHERE id = ?', [req.params.id]);
          if (!result.affectedRows) return res.status(404).json({ message: 'Registro não encontrado.' });
          return res.status(204).end();
        }
      }

      if (key === 'expenses') {
        await pool.query('DELETE FROM cash_transactions WHERE expense_id = ?', [req.params.id]);
      }

      const [result] = await pool.query(`DELETE FROM ${config.table} WHERE id = ?`, [req.params.id]);
      if (!result.affectedRows) return res.status(404).json({ message: 'Registro não encontrado.' });
      res.status(204).end();
    } catch (error) {
      next(error);
    }
  });
}

Object.entries(resources).forEach(([key, config]) => registerCrudRoutes(key, config));

async function getOrderDetails(orderId) {
  const [rows] = await pool.query(
    `SELECT o.*, c.name AS customer_name,
      CASE
        WHEN COUNT(oi.id) = 0 THEN JSON_ARRAY()
        ELSE JSON_ARRAYAGG(JSON_OBJECT(
          'id', oi.id, 'product_id', oi.product_id, 'product_name', p.name,
          'quantity', oi.quantity, 'unit_price', oi.unit_price, 'subtotal', oi.subtotal
        ))
      END AS items
    FROM orders o
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN order_items oi ON oi.order_id = o.id
    LEFT JOIN products p ON p.id = oi.product_id
    WHERE o.id = ?
    GROUP BY o.id, c.name`,
    [orderId]
  );
  return rows[0] || null;
}

app.get('/api/orders', async (_req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT o.*, c.name AS customer_name,
        CASE
          WHEN COUNT(oi.id) = 0 THEN JSON_ARRAY()
          ELSE JSON_ARRAYAGG(JSON_OBJECT(
            'id', oi.id, 'product_id', oi.product_id, 'product_name', p.name,
            'quantity', oi.quantity, 'unit_price', oi.unit_price, 'subtotal', oi.subtotal
          ))
        END AS items
      FROM orders o
      LEFT JOIN customers c ON c.id = o.customer_id
      LEFT JOIN order_items oi ON oi.order_id = o.id
      LEFT JOIN products p ON p.id = oi.product_id
      GROUP BY o.id, c.name
      ORDER BY o.order_date DESC, o.id DESC
    `);
    res.json(rows);
  } catch (error) {
    next(error);
  }
});

app.get('/api/orders/:id', async (req, res, next) => {
  try {
    const order = await getOrderDetails(req.params.id);
    if (!order) return res.status(404).json({ message: 'Pedido não encontrado.' });
    res.json(order);
  } catch (error) {
    next(error);
  }
});

app.post('/api/orders', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const { customer_id, order_date, status = 'pending', discount = 0, notes = null, items = [], bank_account_id = null } = req.body;
    if (!order_date || !items.length) {
      return res.status(400).json({ message: 'Informe a data e ao menos um item.' });
    }

    await connection.beginTransaction();
    let total = 0;
    const preparedItems = [];

    for (const item of items) {
      const [products] = await connection.query('SELECT name, type, price, stock FROM products WHERE id = ?', [item.product_id]);
      if (!products[0]) throw Object.assign(new Error('Produto do pedido não encontrado.'), { status: 400 });

      const product = products[0];
      const quantity = Number(item.quantity);
      const unitPrice = Number(item.unit_price ?? product.price);

      if (!quantity || quantity <= 0) {
        throw Object.assign(new Error('A quantidade deve ser maior que zero.'), { status: 400 });
      }

      // Validação e baixa automática de estoque para produtos físicos
      if (product.type === 'product' && product.stock !== null) {
        if (product.stock < quantity) {
          throw Object.assign(
            new Error(`Estoque insuficiente para "${product.name}". Disponível: ${product.stock}, solicitado: ${quantity}.`),
            { status: 400 }
          );
        }
        await connection.query('UPDATE products SET stock = stock - ? WHERE id = ?', [quantity, item.product_id]);
      }

      const subtotal = quantity * unitPrice;
      total += subtotal;
      preparedItems.push([item.product_id, quantity, unitPrice, subtotal]);
    }

    const discountNum = Math.max(0, Number(discount) || 0);
    total = Math.max(0, total - discountNum);

    const [order] = await connection.query(
      'INSERT INTO orders (customer_id, order_date, status, discount, total, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [customer_id || null, order_date, status, discountNum, total, notes || null]
    );

    for (const item of preparedItems) {
      await connection.query(
        'INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal) VALUES (?, ?, ?, ?, ?)',
        [order.insertId, ...item]
      );
    }

    // Se o pedido for criado como 'paid', registra entrada automática no fluxo de caixa
    if (status === 'paid' && total > 0) {
      let targetAccount = bank_account_id;
      if (!targetAccount) {
        const [defaultAcc] = await connection.query('SELECT id FROM bank_accounts WHERE active = TRUE ORDER BY id ASC LIMIT 1');
        if (defaultAcc.length) targetAccount = defaultAcc[0].id;
      }

      if (targetAccount) {
        await connection.query(
          'INSERT INTO cash_transactions (bank_account_id, type, category, description, amount, transaction_date, order_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [targetAccount, 'income', 'Vendas', `Recebimento Pedido #${order.insertId}`, total, order_date, order.insertId]
        );
      }
    }

    await connection.commit();
    const created = await getOrderDetails(order.insertId);
    res.status(201).json(created);
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.put('/api/orders/:id', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const [existingRows] = await connection.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!existingRows.length) {
      return res.status(404).json({ message: 'Pedido não encontrado.' });
    }
    const previous = existingRows[0];
    const { status, customer_id, order_date, discount, notes, bank_account_id } = req.body;

    await connection.beginTransaction();

    const newStatus = status ?? previous.status;
    const newCustomer = customer_id !== undefined ? (customer_id || null) : previous.customer_id;
    const newDate = order_date ?? previous.order_date;
    const newDiscount = discount !== undefined ? Math.max(0, Number(discount) || 0) : previous.discount;
    const newNotes = notes !== undefined ? (notes || null) : previous.notes;

    // Recalcula total com base nos itens existentes
    const [items] = await connection.query('SELECT product_id, quantity, subtotal FROM order_items WHERE order_id = ?', [req.params.id]);
    let itemsSubtotal = 0;
    for (const it of items) itemsSubtotal += Number(it.subtotal);
    const newTotal = Math.max(0, itemsSubtotal - newDiscount);

    // Gestão de estoque nas mudanças de status:
    // Se foi cancelado e agora voltou a ser pending ou paid, deduz estoque novamente
    if (previous.status === 'cancelled' && newStatus !== 'cancelled') {
      for (const it of items) {
        await connection.query(
          'UPDATE products SET stock = stock - ? WHERE id = ? AND stock IS NOT NULL AND type = "product"',
          [it.quantity, it.product_id]
        );
      }
    }
    // Se era ativo e foi cancelado, devolve os itens ao estoque
    if (previous.status !== 'cancelled' && newStatus === 'cancelled') {
      for (const it of items) {
        await connection.query(
          'UPDATE products SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL AND type = "product"',
          [it.quantity, it.product_id]
        );
      }
    }

    // Gestão da transação financeira sincronizada:
    const [existingTx] = await connection.query('SELECT id FROM cash_transactions WHERE order_id = ?', [req.params.id]);

    if (newStatus === 'paid' && newTotal > 0) {
      let targetAccount = bank_account_id;
      if (!targetAccount) {
        const [defaultAcc] = await connection.query('SELECT id FROM bank_accounts WHERE active = TRUE ORDER BY id ASC LIMIT 1');
        if (defaultAcc.length) targetAccount = defaultAcc[0].id;
      }

      if (existingTx.length) {
        await connection.query(
          'UPDATE cash_transactions SET amount = ?, transaction_date = ?, description = ? WHERE id = ?',
          [newTotal, newDate, `Recebimento Pedido #${req.params.id}`, existingTx[0].id]
        );
      } else if (targetAccount) {
        await connection.query(
          'INSERT INTO cash_transactions (bank_account_id, type, category, description, amount, transaction_date, order_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
          [targetAccount, 'income', 'Vendas', `Recebimento Pedido #${req.params.id}`, newTotal, newDate, req.params.id]
        );
      }
    } else if (existingTx.length && (newStatus === 'pending' || newStatus === 'cancelled')) {
      // Se deixou de ser pago, cancela a entrada no caixa
      await connection.query('DELETE FROM cash_transactions WHERE id = ?', [existingTx[0].id]);
    }

    await connection.query(
      'UPDATE orders SET customer_id = ?, order_date = ?, status = ?, discount = ?, total = ?, notes = ? WHERE id = ?',
      [newCustomer, newDate, newStatus, newDiscount, newTotal, newNotes, req.params.id]
    );

    await connection.commit();
    const updated = await getOrderDetails(req.params.id);
    res.json(updated);
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.delete('/api/orders/:id', async (req, res, next) => {
  const connection = await pool.getConnection();
  try {
    const [existingRows] = await connection.query('SELECT * FROM orders WHERE id = ?', [req.params.id]);
    if (!existingRows.length) {
      return res.status(404).json({ message: 'Pedido não encontrado.' });
    }
    const order = existingRows[0];

    await connection.beginTransaction();

    // Se o pedido não estava cancelado, restaura o estoque dos produtos
    if (order.status !== 'cancelled') {
      const [items] = await connection.query('SELECT product_id, quantity FROM order_items WHERE order_id = ?', [req.params.id]);
      for (const it of items) {
        await connection.query(
          'UPDATE products SET stock = stock + ? WHERE id = ? AND stock IS NOT NULL AND type = "product"',
          [it.quantity, it.product_id]
        );
      }
    }

    // Remove movimentação financeira atrelada
    await connection.query('DELETE FROM cash_transactions WHERE order_id = ?', [req.params.id]);

    // Deleta o pedido (order_items deletado por CASCADE)
    await connection.query('DELETE FROM orders WHERE id = ?', [req.params.id]);

    await connection.commit();
    res.status(204).end();
  } catch (error) {
    await connection.rollback();
    next(error);
  } finally {
    connection.release();
  }
});

app.get('/api/dashboard', async (_req, res, next) => {
  try {
    const [[summary]] = await pool.query(`
      SELECT
        COALESCE((SELECT SUM(total) FROM orders WHERE status <> 'cancelled'), 0) AS revenue,
        COALESCE((SELECT SUM(amount) FROM expenses WHERE status = 'paid'), 0) AS expenses,
        COALESCE((SELECT SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END) FROM cash_transactions), 0)
          + COALESCE((SELECT SUM(initial_balance) FROM bank_accounts WHERE active = TRUE), 0) AS balance,
        (SELECT COUNT(*) FROM orders WHERE status = 'pending') AS pending_orders
    `);
    const [recentOrders] = await pool.query(`
      SELECT o.id, o.order_date, o.total, o.status, COALESCE(c.name, 'Cliente não informado') AS customer_name
      FROM orders o LEFT JOIN customers c ON c.id = o.customer_id
      ORDER BY o.order_date DESC, o.id DESC LIMIT 5
    `);
    res.json({ ...summary, recentOrders });
  } catch (error) {
    next(error);
  }
});

app.get('/api/health', async (_req, res, next) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ok' });
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  let status = error.status || 500;
  let message = error.message || 'Erro interno do servidor.';

  if (error.code === 'ER_DUP_ENTRY') {
    status = 409;
    message = 'Registro duplicado. Já existe um item com estes dados.';
  } else if (error.code === 'ER_ROW_IS_REFERENCED_2') {
    status = 409;
    message = 'Não é possível excluir este registro pois ele está vinculado a outros dados.';
  } else if (error.code === 'ER_NO_REFERENCED_ROW_2') {
    status = 400;
    message = 'Registro referenciado não encontrado (chave estrangeira inválida).';
  } else if (status === 500 && process.env.NODE_ENV === 'production') {
    message = 'Erro interno do servidor. Tente novamente mais tarde.';
  }

  res.status(status).json({ message });
});

app.listen(port, () => {
  console.log(`API Aranduê disponível em http://localhost:${port}`);
});
