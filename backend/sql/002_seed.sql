INSERT INTO products (name, type, price, cost, stock) VALUES
  ('Identidade visual', 'service', 850.00, 220.00, NULL),
  ('Kit papelaria artesanal', 'product', 120.00, 48.00, 14),
  ('Consultoria financeira', 'service', 260.00, 60.00, NULL);

INSERT INTO customers (name, document, phone, email) VALUES
  ('Mercadinho da Praça', '12.345.678/0001-90', '(11) 99999-1111', 'contato@mercadinho.test'),
  ('Ana Souza', NULL, '(11) 98888-2222', 'ana.souza@test');

INSERT INTO bank_accounts (bank_name, account_name, account_type, initial_balance) VALUES
  ('Caixa físico', 'Caixa da loja', 'cash', 450.00),
  ('Banco comunitário', 'Conta principal', 'checking', 1250.00);

INSERT INTO orders (customer_id, order_date, status, discount, total, notes) VALUES
  (1, CURRENT_DATE - INTERVAL 2 DAY, 'paid', 0, 850.00, 'Entrega realizada'),
  (2, CURRENT_DATE - INTERVAL 1 DAY, 'pending', 10, 230.00, 'Aguardando confirmação');

INSERT INTO order_items (order_id, product_id, quantity, unit_price, subtotal) VALUES
  (1, 1, 1, 850.00, 850.00),
  (2, 2, 2, 120.00, 240.00);

INSERT INTO expenses (description, category, amount, expense_date, status, bank_account_id) VALUES
  ('Compra de materiais', 'Insumos', 180.00, CURRENT_DATE - INTERVAL 3 DAY, 'paid', 2),
  ('Internet do negócio', 'Operacional', 89.90, CURRENT_DATE - INTERVAL 1 DAY, 'pending', 2);

INSERT INTO cash_transactions (bank_account_id, type, category, description, amount, transaction_date, order_id) VALUES
  (2, 'income', 'Vendas', 'Recebimento de identidade visual', 850.00, CURRENT_DATE - INTERVAL 2 DAY, 1);
