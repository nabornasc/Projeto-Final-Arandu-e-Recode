import { ResourcePage } from '../components/ResourcePage.tsx';
import { resources } from '../config/resources.ts';

export const ProductsPage = () => <ResourcePage config={resources.products} />;
export const ExpensesPage = () => <ResourcePage config={resources.expenses} />;
export const AccountsPage = () => <ResourcePage config={resources.accounts} />;
export const TransactionsPage = () => <ResourcePage config={resources.transactions} />;
