// Arredonda para centavos, evitando acúmulo de erro de ponto flutuante.
export const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
