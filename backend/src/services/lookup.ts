import { isValidCnpj, onlyDigits } from '@arandue/shared/br';
import { authorizeAny, type Ctx } from '../lib/context.ts';
import { AppError, badRequest, notFound } from '../lib/errors.ts';

// Consulta de CNPJ e CEP em serviços públicos gratuitos, feita pelo servidor: só o número sai do
// sistema. Falha ou demora não bloqueia o cadastro (a tela segue com preenchimento manual).
const TIMEOUT_MS = 5000;
const unavailable = () =>
  new AppError(502, 'Serviço de consulta indisponível no momento. Preencha manualmente.');

async function fetchJson(url: string): Promise<{ status: number; body: unknown }> {
  try {
    const response = await fetch(url, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // A BrasilAPI recusa (403) o User-Agent padrão do fetch do Node; identificamos o sistema.
      headers: {
        Accept: 'application/json',
        'User-Agent': 'AranduGestao/2.3 (+https://github.com/nabornasc/arandu-gestao)',
      },
    });
    return { status: response.status, body: response.ok ? await response.json() : null };
  } catch {
    throw unavailable();
  }
}

interface BrasilApiCnpj {
  razao_social?: string;
  nome_fantasia?: string;
  cep?: string;
  logradouro?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  municipio?: string;
  uf?: string;
  ddd_telefone_1?: string;
  email?: string | null;
  opcao_pelo_mei?: boolean | null;
  opcao_pelo_simples?: boolean | null;
}

const text = (value: string | null | undefined) => value?.trim() || null;

export async function lookupCnpj(ctx: Ctx, value: string) {
  authorizeAny(ctx, ['customers.create', 'customers.update', 'suppliers.create', 'suppliers.update']);
  const cnpj = onlyDigits(value);
  if (!isValidCnpj(cnpj)) throw badRequest('CNPJ inválido.');
  const { status, body } = await fetchJson(`https://brasilapi.com.br/api/cnpj/v1/${cnpj}`);
  if (status === 404) throw notFound('CNPJ não encontrado na Receita Federal.');
  if (status !== 200 || !body) throw unavailable();
  const data = body as BrasilApiCnpj;
  return {
    document: cnpj,
    legalName: text(data.razao_social),
    name: text(data.nome_fantasia) ?? text(data.razao_social),
    email: text(data.email)?.toLowerCase() ?? null,
    phone: text(data.ddd_telefone_1),
    zip: onlyDigits(data.cep) || null,
    street: text(data.logradouro),
    number: text(data.numero),
    complement: text(data.complemento),
    district: text(data.bairro),
    city: text(data.municipio),
    state: text(data.uf),
    taxRegime: data.opcao_pelo_mei ? 'mei' : data.opcao_pelo_simples ? 'simples' : null,
  };
}

interface ViaCep {
  erro?: boolean | string;
  logradouro?: string;
  complemento?: string;
  bairro?: string;
  localidade?: string;
  uf?: string;
}

export async function lookupZip(ctx: Ctx, value: string) {
  authorizeAny(ctx, ['customers.create', 'customers.update', 'suppliers.create', 'suppliers.update']);
  const zip = onlyDigits(value);
  if (zip.length !== 8) throw badRequest('CEP inválido.');
  const { status, body } = await fetchJson(`https://viacep.com.br/ws/${zip}/json/`);
  if (status !== 200 || !body) throw unavailable();
  const data = body as ViaCep;
  if (data.erro) throw notFound('CEP não encontrado.');
  return {
    zip,
    street: text(data.logradouro),
    complement: text(data.complemento),
    district: text(data.bairro),
    city: text(data.localidade),
    state: text(data.uf),
  };
}
