// Documentos e formatos brasileiros (CPF, CNPJ, CEP). Usado na validação do front e do back.

export const onlyDigits = (value: string | null | undefined) => (value ?? '').replace(/\D/g, '');

// Dígitos verificadores: soma ponderada, resto 11 (resto < 2 vira 0).
function checkDigit(digits: string, weights: number[]): number {
  const sum = weights.reduce((total, weight, index) => total + Number(digits[index]) * weight, 0);
  const rest = sum % 11;
  return rest < 2 ? 0 : 11 - rest;
}

export function isValidCpf(value: string): boolean {
  const cpf = onlyDigits(value);
  if (cpf.length !== 11 || /^(\d)\1+$/.test(cpf)) return false;
  const first = checkDigit(cpf, [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(cpf, [11, 10, 9, 8, 7, 6, 5, 4, 3, 2]);
  return Number(cpf[9]) === first && Number(cpf[10]) === second;
}

export function isValidCnpj(value: string): boolean {
  const cnpj = onlyDigits(value);
  if (cnpj.length !== 14 || /^(\d)\1+$/.test(cnpj)) return false;
  const first = checkDigit(cnpj, [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  const second = checkDigit(cnpj, [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]);
  return Number(cnpj[12]) === first && Number(cnpj[13]) === second;
}

export function formatDocument(value: string | null | undefined): string {
  const digits = onlyDigits(value);
  if (digits.length === 11) return digits.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, '$1.$2.$3-$4');
  if (digits.length === 14) return digits.replace(/(\d{2})(\d{3})(\d{3})(\d{4})(\d{2})/, '$1.$2.$3/$4-$5');
  return value ?? '';
}

export const formatZip = (value: string | null | undefined) => {
  const digits = onlyDigits(value);
  return digits.length === 8 ? `${digits.slice(0, 5)}-${digits.slice(5)}` : (value ?? '');
};

interface AddressParts {
  zip?: string | null;
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
}

// Endereço em uma linha, sem separadores sobrando quando falta alguma parte.
export function formatAddress(address: AddressParts): string {
  return [
    [address.street, address.number].filter(Boolean).join(', '),
    address.complement,
    address.district,
    [address.city, address.state].filter(Boolean).join('/'),
    address.zip ? `CEP ${formatZip(address.zip)}` : null,
  ]
    .filter(Boolean)
    .join(' - ');
}

export const STATES = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
] as const;
