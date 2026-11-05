const isDemo = import.meta.env.VITE_DEMO_MODE === 'true';

// Aviso da demonstração pública: os dados são compartilhados e voltam ao padrão a cada 12 horas.
export function DemoNotice({ credentials = false }: { credentials?: boolean }) {
  if (!isDemo) return null;
  return (
    <p className="notice demo-notice" role="note">
      <strong>Demonstração.</strong> Dados fictícios e compartilhados, que voltam ao padrão às 00h e às 12h
      (horário de Cuiabá). Não informe dados reais.
      {credentials && (
        <>
          {' '}
          Para testar, entre com <code>dono@conveniencia.test</code> e a senha <code>senha-demo-123</code>.
        </>
      )}
    </p>
  );
}
